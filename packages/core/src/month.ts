import { shiftTotals, type BudgetShift } from './budget.ts';
import type { Overrides, StoredTransaction } from './overlay.ts';
import type { RiseupActual, RiseupBudget, RiseupEnvelope } from './riseup.ts';

// Everything below works on absolute amounts. Direction comes from the
// transaction (isIncome), never from a sign: RiseUp's signs are not consistent
// between fields, and on fixed envelopes they are the reverse of its docs.

export type EnvelopeKind = 'income' | 'fixed' | 'tracked' | 'everyday' | 'goal';

export interface EnvelopeItem {
  transactionId: string;
  date: string;
  businessName: string;
  amount: number;
}

export interface EnvelopeStatus {
  id: string;
  kind: EnvelopeKind;
  type: RiseupEnvelope['type'];
  label: string;
  isIncome: boolean;
  planned: number;
  actual: number;
  remaining: number; // planned - actual; negative when over
  usedPct: number;
  count: number;
  paid: boolean; // fixed items: has the charge/deposit happened
  guessed?: boolean; // label of a pending fixed item inferred from last month
  customPlan?: boolean; // the family set this amount in RiseUp themselves
  riseupPlanned?: number; // RiseUp's own plan, when the family shifted budget in the hub
  weeks?: { index: number; until: string; planned: number; actual: number }[];
  items: EnvelopeItem[];
  raw: { ids: string[]; balancedAmount: (number | null)[]; originalAmount: (number | null | undefined)[]; balanceDate: (string | undefined)[] };
}

export interface MonthStatus {
  month: string;
  lastUpdatedAt: string;
  income: { expected: number; received: number };
  fixed: { planned: number; paid: number; pending: number };
  // Money for everything that is not fixed: expected income minus fixed minus
  // savings goals. RiseUp gives the everyday envelope no budget of its own.
  flexible: { planned: number; spent: number; left: number; trackedPlanned: number; trackedSpent: number; everydaySpent: number };
  goals: { planned: number; saved: number };
  excluded: { count: number; expenses: number; income: number };
  envelopes: EnvelopeStatus[];
  daysInMonth: number;
  dayOfMonth: number;
  daysLeft: number;
  leftPerDay: number;
  projectedNet: number; // where the month lands at the current daily pace
}

export const actualAmount = (a: RiseupActual): number => Math.abs((a.isIncome ? a.incomeAmount : a.billingAmount) ?? 0);

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const HIDDEN_SAVING = '__saving-hidden-category__';
export const cleanCategory = (label?: string | null) => (!label ? 'אחר' : label === HIDDEN_SAVING ? 'חיסכון והשקעה' : label);

const mostCommon = (xs: string[]) => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface StatusContext {
  // This month's transactions, already carrying the family's category moves.
  transactions?: StoredTransaction[];
  overrides?: Overrides;
  // Tracked-category id → label, learned from every stored month, for a
  // category with no spending yet this month.
  categoryLabels?: Record<string, string>;
  // Last month's fixed charges, to put a probable name on a pending one.
  previousFixed?: { businessName: string; amount: number }[];
  // Money the family moved between this month's budgets in the hub.
  shifts?: BudgetShift[];
}

const plan = (e: RiseupEnvelope) => Math.abs(e.balancedAmount || e.originalAmount || 0);
const item = (a: RiseupActual): EnvelopeItem => ({ transactionId: a.transactionId, date: a.transactionDate, businessName: a.businessName, amount: actualAmount(a) });

function finish(e: Omit<EnvelopeStatus, 'remaining' | 'usedPct' | 'count'>): EnvelopeStatus {
  return { ...e, remaining: e.planned - e.actual, usedPct: e.planned > 0 ? e.actual / e.planned : e.actual > 0 ? Infinity : 0, count: e.items.length };
}

export function buildEnvelopes(budget: RiseupBudget, ctx: StatusContext = {}): EnvelopeStatus[] {
  const txById = new Map((ctx.transactions ?? []).map((t) => [t.transactionId, t]));
  const out: EnvelopeStatus[] = [];

  // Which sign means "expense" on fixed envelopes is learned from the paid
  // ones, so a pending charge is never mistaken for expected income.
  const fixed = budget.envelopes.filter((e) => e.type === 'fixed');
  const votes = fixed.filter((e) => e.actuals[0] && e.balancedAmount).map((e) => (e.balancedAmount! > 0) !== e.actuals[0]!.isIncome);
  const positiveIsExpense = votes.filter(Boolean).length >= votes.length / 2;

  const paidNames = new Set(fixed.flatMap((e) => e.actuals.map((a) => a.businessName)));
  const candidates = (ctx.previousFixed ?? []).filter((p) => !paidNames.has(p.businessName));

  for (const e of fixed) {
    const a = e.actuals[0];
    const isIncome = a ? a.isIncome : (e.balancedAmount ?? e.originalAmount ?? 0) > 0 !== positiveIsExpense;
    const planned = plan(e);
    let label = a?.businessName;
    let guessed = false;
    if (!label && !isIncome) {
      const near = candidates.filter((p) => Math.abs(p.amount - planned) <= Math.max(1, planned * 0.03));
      if (near.length === 1) { label = near[0]!.businessName; guessed = true; }
    }
    out.push(finish({
      id: e.id, kind: isIncome ? 'income' : 'fixed', type: e.type, isIncome, label: label ?? (isIncome ? 'הכנסה קבועה צפויה' : 'חיוב קבוע צפוי'), guessed,
      planned, actual: sum(e.actuals.map(actualAmount)), paid: e.actuals.length > 0, items: e.actuals.map(item),
      raw: { ids: [e.id], balancedAmount: [e.balancedAmount], originalAmount: [e.originalAmount], balanceDate: [e.balanceDate] },
    }));
  }

  // Tracked categories: RiseUp may split one into weekly envelopes
  // (month#trackingCategory#<category>#<week>). The family thinks in categories.
  const groups = new Map<string, RiseupEnvelope[]>();
  for (const e of budget.envelopes) if (e.type === 'trackingCategory') {
    const cat = e.id.split('#')[2] ?? e.id;
    groups.set(cat, [...(groups.get(cat) ?? []), e]);
  }
  // A transaction the family moved leaves its envelope and joins the category
  // it was moved to — or everyday spending when that category is not tracked.
  const labelOfGroup = new Map<string, string>();
  for (const [cat, es] of groups) {
    // RiseUp's own label for each transaction, so a category keeps its name even
    // when the family has moved everything out of it.
    const labels = es.flatMap((e) => e.actuals).map((a) => { const t = txById.get(a.transactionId) as (StoredTransaction & { sourceCategory?: string }) | undefined; return cleanCategory(t?.sourceCategory ?? t?.categoryLabel ?? a.expense); });
    labelOfGroup.set(cat, mostCommon(labels) ?? ctx.categoryLabels?.[cat] ?? 'קטגוריה במעקב');
  }
  const groupByLabel = new Map([...labelOfGroup].map(([cat, label]) => [label, cat]));
  const flexActuals = budget.envelopes.filter((e) => e.type === 'trackingCategory' || e.type === 'variable').flatMap((e) => e.actuals.map((a) => ({ a, home: e.type === 'variable' ? null : (e.id.split('#')[2] ?? e.id), env: e })));
  const landed = new Map<string | null, { a: RiseupActual; env: RiseupEnvelope }[]>();
  for (const x of flexActuals) {
    const moved = ctx.overrides?.[x.a.transactionId]?.category;
    const target = moved ? (groupByLabel.get(cleanCategory(moved)) ?? null) : x.home;
    landed.set(target, [...(landed.get(target) ?? []), x]);
  }

  const shifted = shiftTotals(ctx.shifts ?? [], budget.budgetDate);
  for (const [cat, es] of groups) {
    const acts = landed.get(cat) ?? [];
    const riseupPlanned = sum(es.map((e) => Math.abs(e.originalAmount || e.balancedAmount || 0)));
    const delta = shifted.get(labelOfGroup.get(cat)!) ?? 0;
    const weekly = es.length > 1 || es[0]!.id.split('#').length > 3;
    out.push(finish({
      id: `${budget.budgetDate}#trackingCategory#${cat}`, kind: 'tracked', type: 'trackingCategory', isIncome: false, label: labelOfGroup.get(cat)!,
      planned: Math.max(riseupPlanned + delta, 0), riseupPlanned: delta ? riseupPlanned : undefined, actual: sum(acts.map((x) => actualAmount(x.a))), paid: false,
      customPlan: es.some((e) => e.isCustomPrediction),
      weeks: weekly ? es.map((e) => ({ index: Number(e.id.split('#')[3] ?? 0), until: (e.balanceDate ?? '').slice(0, 10), planned: Math.abs(e.originalAmount || 0), actual: sum(e.actuals.map(actualAmount)) })).sort((a, b) => a.index - b.index) : undefined,
      items: acts.map((x) => item(x.a)),
      raw: { ids: es.map((e) => e.id), balancedAmount: es.map((e) => e.balancedAmount), originalAmount: es.map((e) => e.originalAmount), balanceDate: es.map((e) => e.balanceDate) },
    }));
  }

  for (const e of budget.envelopes) {
    if (e.type === 'variable') {
      const acts = landed.get(null) ?? [];
      out.push(finish({ id: e.id, kind: 'everyday', type: e.type, isIncome: false, label: 'הוצאות שוטפות (ללא קטגוריה במעקב)', planned: 0, actual: sum(acts.map((x) => actualAmount(x.a))), paid: false, items: acts.map((x) => item(x.a)),
        raw: { ids: [e.id], balancedAmount: [e.balancedAmount], originalAmount: [e.originalAmount], balanceDate: [e.balanceDate] } }));
    } else if (e.type === 'variableIncome') {
      const actual = sum(e.actuals.map(actualAmount));
      out.push(finish({ id: e.id, kind: 'income', type: e.type, isIncome: true, label: 'הכנסות משתנות', planned: Math.max(plan(e), actual), actual, paid: e.actuals.length > 0, items: e.actuals.map(item),
        raw: { ids: [e.id], balancedAmount: [e.balancedAmount], originalAmount: [e.originalAmount], balanceDate: [e.balanceDate] } }));
    } else if (e.type === 'riseupGoal') {
      out.push(finish({ id: e.id, kind: 'goal', type: e.type, isIncome: false, label: 'יעד חיסכון', planned: plan(e), actual: sum(e.actuals.map(actualAmount)), paid: e.actuals.length > 0, items: e.actuals.map(item),
        raw: { ids: [e.id], balancedAmount: [e.balancedAmount], originalAmount: [e.originalAmount], balanceDate: [e.balanceDate] } }));
    }
  }
  return out;
}

// `today` is YYYY-MM-DD. Past months count as fully elapsed, future ones as not started.
export function monthStatus(budget: RiseupBudget, today: string, ctx: StatusContext = {}): MonthStatus {
  const month = budget.budgetDate;
  const envelopes = buildEnvelopes(budget, ctx);
  const of = (k: EnvelopeKind) => envelopes.filter((e) => e.kind === k);
  // Once a month has closed, income and fixed charges that never came are no longer expected in it.
  const closed = today.slice(0, 7) > month;

  const income = {
    // Income that beat the plan counts in full; a salary not yet in counts as planned.
    expected: sum(of('income').map((e) => (closed ? e.actual : Math.max(e.planned, e.actual)))),
    received: sum(of('income').map((e) => e.actual)),
  };
  // A paid fixed charge counts at what was really charged, a pending one at its plan.
  const fixedPaid = sum(of('fixed').map((e) => e.actual));
  const fixedPending = closed ? 0 : sum(of('fixed').filter((e) => !e.paid).map((e) => e.planned));
  const fixed = { planned: fixedPaid + fixedPending, paid: fixedPaid, pending: fixedPending };
  const goals = { planned: sum(of('goal').map((e) => e.planned)), saved: sum(of('goal').map((e) => e.actual)) };

  const trackedPlanned = sum(of('tracked').map((e) => e.planned));
  const trackedSpent = sum(of('tracked').map((e) => e.actual));
  const everydaySpent = sum(of('everyday').map((e) => e.actual));
  const flexPlanned = income.expected - fixed.planned - goals.planned;
  const flexSpent = trackedSpent + everydaySpent;
  const flexible = { planned: flexPlanned, spent: flexSpent, left: flexPlanned - flexSpent, trackedPlanned, trackedSpent, everydaySpent };

  // The everyday envelope's "budget" is whatever the plan leaves after the tracked categories.
  const everyday = envelopes.find((e) => e.kind === 'everyday');
  if (everyday) Object.assign(everyday, finish({ ...everyday, planned: Math.max(flexPlanned - trackedPlanned, 0) }));

  const dim = daysInMonth(month);
  const todayMonth = today.slice(0, 7);
  const dayOfMonth = todayMonth === month ? Number(today.slice(8, 10)) : todayMonth > month ? dim : 0;
  const daysLeft = dim - dayOfMonth;
  const projectedFlex = dayOfMonth > 0 ? (flexSpent / dayOfMonth) * dim : flexSpent;
  const ex = budget.excluded ?? [];

  return {
    month, lastUpdatedAt: budget.lastUpdatedAt, income, fixed, flexible, goals,
    excluded: { count: ex.length, expenses: sum(ex.filter((a) => !a.isIncome).map(actualAmount)), income: sum(ex.filter((a) => a.isIncome).map(actualAmount)) },
    envelopes, daysInMonth: dim, dayOfMonth, daysLeft,
    // On the last day there is still today to spend in.
    leftPerDay: flexible.left / Math.max(daysLeft + (todayMonth === month ? 1 : 0), 1),
    projectedNet: income.expected - fixed.planned - goals.planned - projectedFlex,
  };
}
