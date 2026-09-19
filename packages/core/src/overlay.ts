import type { EnvelopeType, RiseupActual, RiseupBudget, RiseupTransaction } from './riseup.ts';

// ---- What the family changes in the hub -------------------------------------
// Kept apart from RiseUp's data and applied on top of it at read time, so a
// sync can never undo it and nothing RiseUp does can overwrite it.

export interface TransactionOverride {
  category?: string; // move to this category
  note?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type Overrides = Record<string, TransactionOverride>; // by transactionId

// ---- What the hub remembers about RiseUp's data ------------------------------

export interface StoredTransaction extends RiseupTransaction {
  // Where RiseUp's own budget puts this transaction. RiseUp's transaction feed
  // also returns what it keeps OUT of the cashflow — transfers between accounts,
  // the card bill as seen from the bank, one-offs the customer excluded — so
  // without this every total roughly doubles.
  excluded?: boolean;
  envelopeType?: EnvelopeType;
  envelopeId?: string;
  // Fields RiseUp only returns on the budget side of the same transaction.
  budget?: Pick<RiseupActual, 'originalAmount' | 'placement' | 'monthsInterval' | 'transactionBudgetDate' | 'sequenceId' | 'isPostponed' | 'expense' | 'paymentNumber' | 'totalNumberOfPayments'>;
  firstSeenAt?: string;
  // Set when RiseUp stops returning a transaction we already hold. The record
  // stays; it is only marked.
  removedFromSourceAt?: string;
  // RiseUp's category the first time it differed from the current one.
  previousCategory?: string;
}

const budgetSide = (a: RiseupActual): StoredTransaction['budget'] => ({
  originalAmount: a.originalAmount, placement: a.placement, monthsInterval: a.monthsInterval, transactionBudgetDate: a.transactionBudgetDate,
  sequenceId: a.sequenceId, isPostponed: a.isPostponed, expense: a.expense, paymentNumber: a.paymentNumber, totalNumberOfPayments: a.totalNumberOfPayments,
});

// Stamp each transaction with its place in that month's budget.
export function annotateWithBudget<T extends RiseupTransaction>(txns: T[], budget: RiseupBudget): (T & StoredTransaction)[] {
  const place = new Map<string, Partial<StoredTransaction>>();
  for (const e of budget.envelopes) for (const a of e.actuals) place.set(a.transactionId, { excluded: false, envelopeType: e.type, envelopeId: e.id, budget: budgetSide(a) });
  for (const a of budget.excluded ?? []) place.set(a.transactionId, { excluded: true, envelopeType: undefined, envelopeId: undefined, budget: budgetSide(a) });
  return txns.map((t) => ({ ...t, ...(place.get(t.transactionId) ?? {}) }));
}

// Counted in the household's cashflow: not excluded by RiseUp, not dropped by it.
export const counts = (t: StoredTransaction) => !t.excluded && !t.removedFromSourceAt;
export const isFixed = (t: StoredTransaction) => (t.envelopeType ? t.envelopeType === 'fixed' : t.actualType === 'fixed' || !!t.commitmentId);

// Merge a fresh pull of one month into what is stored. Nothing is dropped.
export function mergeTransactions(stored: StoredTransaction[], fresh: RiseupTransaction[], now: string): StoredTransaction[] {
  const byId = new Map(stored.map((t) => [t.transactionId, t]));
  const seen = new Set<string>();
  for (const f of fresh) {
    seen.add(f.transactionId);
    const old = byId.get(f.transactionId);
    const merged: StoredTransaction = { ...old, ...f, firstSeenAt: old?.firstSeenAt ?? now };
    delete merged.removedFromSourceAt; // it came back
    if (old?.categoryLabel && old.categoryLabel !== f.categoryLabel) merged.previousCategory = old.categoryLabel;
    byId.set(f.transactionId, merged);
  }
  // An empty pull is far more likely an outage than a month truly emptied.
  if (fresh.length > 0) {
    for (const t of byId.values()) {
      if (!seen.has(t.transactionId) && !t.removedFromSourceAt) t.removedFromSourceAt = now;
    }
  }
  return [...byId.values()];
}

export interface ViewTransaction extends StoredTransaction {
  sourceCategory?: string; // RiseUp's own category, when the family moved it
  note?: string;
}

export function applyOverrides(txns: StoredTransaction[], overrides: Overrides): ViewTransaction[] {
  return txns.map((t) => {
    const o = overrides[t.transactionId];
    if (!o) return t;
    const moved = o.category && o.category !== t.categoryLabel;
    return { ...t, ...(moved ? { categoryLabel: o.category, sourceCategory: t.categoryLabel } : {}), note: o.note };
  });
}

// ---- Installments ------------------------------------------------------------

export interface InstallmentPlan {
  key: string;
  businessName: string;
  monthly: number;
  paid: number;
  total: number;
  remainingPayments: number;
  remainingAmount: number;
  lastMonth: string; // cashflow month of the final payment
  fixed: boolean; // RiseUp files it under fixed charges rather than variable spending
}

const addMonthsTo = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Money already committed to future months through installment plans.
//
// A plan is recognised by who, how many payments, which account, and the month
// it started (payment number counted back from the charge). The amount is NOT
// part of it: a loan repaid in installments changes by a few shekels every
// month, and the first payment of a card plan is often rounded differently, so
// keying on the amount showed one loan as three.
export function installmentPlans(txns: StoredTransaction[], month: string): InstallmentPlan[] {
  const monthsApart = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5));
  const groups = new Map<string, StoredTransaction[]>();
  for (const t of txns) {
    if (!counts(t) || !t.isInstallment || t.isIncome || !t.totalNumberOfInstallments || !t.installmentNumber) continue;
    const started = addMonthsTo(t.cashflowDate, -(t.installmentNumber - 1));
    const key = `${t.businessName}|${t.totalNumberOfInstallments}|${t.accountNumberHash ?? ''}|${started}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const plans: { key: string; latest: StoredTransaction }[] = [];
  for (const [key, ts] of groups) {
    // Two purchases at the same shop, in the same month, over the same number of
    // payments are two plans: each month then carries two charges. They are told
    // apart by amount, which within one month is a fair identity.
    const perMonth = new Map<string, StoredTransaction[]>();
    for (const t of ts) perMonth.set(t.cashflowDate, [...(perMonth.get(t.cashflowDate) ?? []), t]);
    const lastMonth = [...perMonth.keys()].sort().at(-1)!;
    const seeds = [...perMonth.get(lastMonth)!].sort((a, b) => a.amount - b.amount);
    seeds.forEach((latest, n) => plans.push({ key: seeds.length > 1 ? `${key}|${n}` : key, latest }));
  }
  return plans
    .map(({ key, latest: t }) => {
      const total = t.totalNumberOfInstallments!;
      // Payments between the last one we saw and the viewed month have happened too.
      const paid = Math.min(total, t.installmentNumber! + Math.max(0, monthsApart(t.cashflowDate, month)));
      const remainingPayments = total - paid;
      return { key, businessName: t.businessName, monthly: t.amount, paid, total, remainingPayments, fixed: isFixed(t),
        remainingAmount: remainingPayments * t.amount, lastMonth: addMonthsTo(t.cashflowDate, total - t.installmentNumber!) };
    })
    .filter((p) => p.remainingPayments > 0)
    .sort((a, b) => b.remainingAmount - a.remainingAmount);
}
