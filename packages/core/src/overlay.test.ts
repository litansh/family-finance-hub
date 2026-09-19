import { describe, expect, it } from 'vitest';
import { buildDashboard } from './dashboard.ts';
import { applyOverrides, installmentPlans, mergeTransactions, type StoredTransaction } from './overlay.ts';
import { monthStatus } from './month.ts';
import type { RiseupBudget, RiseupTransaction } from './riseup.ts';
import { sampleData } from './sample.ts';

const t = (id: string, p: Partial<RiseupTransaction> = {}): RiseupTransaction => ({
  transactionId: id, transactionDate: '2026-09-10T00:00:00.000Z', cashflowDate: '2026-09', businessName: 'Shop', isIncome: false, amount: 100, categoryLabel: 'סופר', ...p,
});

describe('mergeTransactions', () => {
  it('never drops a transaction RiseUp stops returning', () => {
    const first = mergeTransactions([], [t('a'), t('b')], 'T1');
    const second = mergeTransactions(first, [t('a')], 'T2');
    expect(second.map((x) => x.transactionId).sort()).toEqual(['a', 'b']);
    expect(second.find((x) => x.transactionId === 'b')!.removedFromSourceAt).toBe('T2');
    expect(second.find((x) => x.transactionId === 'a')!.firstSeenAt).toBe('T1');
  });

  it('clears the mark when the transaction comes back', () => {
    const gone = mergeTransactions(mergeTransactions([], [t('a'), t('b')], 'T1'), [t('a')], 'T2');
    const back = mergeTransactions(gone, [t('a'), t('b')], 'T3');
    expect(back.find((x) => x.transactionId === 'b')!.removedFromSourceAt).toBeUndefined();
  });

  it('treats an empty pull as an outage, not as a wipe', () => {
    const stored = mergeTransactions([], [t('a')], 'T1');
    expect(mergeTransactions(stored, [], 'T2')[0]!.removedFromSourceAt).toBeUndefined();
  });

  it('follows RiseUp edits but remembers the earlier category', () => {
    const out = mergeTransactions(mergeTransactions([], [t('a')], 'T1'), [t('a', { categoryLabel: 'מסעדות', amount: 120 })], 'T2');
    expect(out[0]).toMatchObject({ categoryLabel: 'מסעדות', previousCategory: 'סופר', amount: 120 });
  });
});

describe('overrides', () => {
  it('survive a sync that changes the same transaction in RiseUp', () => {
    const overrides = { a: { category: 'ילדים', note: 'מתנה' } };
    const synced = mergeTransactions(mergeTransactions([], [t('a')], 'T1'), [t('a', { categoryLabel: 'מסעדות' })], 'T2');
    expect(applyOverrides(synced, overrides)[0]).toMatchObject({ categoryLabel: 'ילדים', sourceCategory: 'מסעדות', note: 'מתנה' });
  });

  it('move spending between budget categories, never losing or doubling it', () => {
    const actual = (id: string, expense: string) => ({ transactionId: id, transactionDate: '2026-09-03', businessName: 'x', isIncome: false, billingAmount: 100, incomeAmount: null, expense });
    const budget: RiseupBudget = { budgetDate: '2026-09', lastUpdatedAt: '', envelopes: [
      { id: '2026-09#trackingCategory#food#0', type: 'trackingCategory', balancedAmount: 0, originalAmount: 250, actuals: [actual('a', 'סופר')] },
      { id: '2026-09#trackingCategory#food#1', type: 'trackingCategory', balancedAmount: 0, originalAmount: 250, actuals: [actual('b', 'סופר')] },
      { id: '2026-09#trackingCategory#kids', type: 'trackingCategory', balancedAmount: 0, originalAmount: 300, actuals: [actual('c', 'ילדים')] },
      { id: '2026-09#variable', type: 'variable', balancedAmount: null, actuals: [] },
    ] };
    const moved = monthStatus(budget, '2026-09-15', { overrides: { a: { category: 'ילדים' }, b: { category: 'לא קיים' } } });
    const by = Object.fromEntries(moved.envelopes.map((e) => [e.label.split(' ')[0], e.actual]));
    expect(by).toMatchObject({ סופר: 0, ילדים: 200, הוצאות: 100 });
    expect(moved.flexible.spent).toBe(300);
  });
});

describe('installments', () => {
  it('counts payments that passed since the last one seen', () => {
    const plans = installmentPlans([t('i', { isInstallment: true, installmentNumber: 3, totalNumberOfInstallments: 10, amount: 200, cashflowDate: '2026-07' })], '2026-09');
    expect(plans[0]).toMatchObject({ paid: 5, remainingPayments: 5, remainingAmount: 1000, lastMonth: '2027-02' });
  });
});

describe('recommendations on the sample household', () => {
  const today = '2026-09-18';
  const { transactions, budgets, current } = sampleData(today);
  const d = buildDashboard({ budget: budgets.get(current)!, transactions, today, lastSyncAt: null, source: 'sample' });
  const ids = d.recommendations.map((r) => r.id);

  it('finds the price rise, the parallel loans, insurance, subscriptions and installments', () => {
    expect(ids).toContain('loans:consolidate');
    expect(ids).toContain('insurance:overlap');
    expect(ids).toContain('subscriptions:stack');
    expect(ids.some((i) => i.startsWith('price:'))).toBe(true);
  });

  it('never suggests consolidating the mortgage with the loans', () => {
    const loans = d.recommendations.find((r) => r.id === 'loans:consolidate')!;
    expect(loans.evidence!.every((e) => !e.label.includes('משכנתא'))).toBe(true);
    expect(loans.evidence).toHaveLength(2);
  });

  it('gives every recommendation evidence and at least two concrete steps', () => {
    for (const r of d.recommendations) {
      expect(r.why.length, r.id).toBeGreaterThan(40);
      expect(r.steps.length, r.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps ids stable between months so a status set by the family sticks', () => {
    const prev = buildDashboard({ budget: budgets.get('2026-08')!, transactions, today, lastSyncAt: null });
    expect(prev.recommendations.map((r) => r.id)).toContain('loans:consolidate');
  });

  it('excludes transactions RiseUp removed from totals but still lists them', () => {
    const stored: StoredTransaction[] = transactions.map((x, i) => (x.cashflowDate === current && i % 50 === 0 ? { ...x, removedFromSourceAt: 'T' } : x));
    const d2 = buildDashboard({ budget: budgets.get(current)!, transactions: stored, today, lastSyncAt: null });
    expect(d2.removed.length).toBeGreaterThan(0);
    expect(d2.transactions.length + d2.removed.length).toBe(d.transactions.length);
  });
});
