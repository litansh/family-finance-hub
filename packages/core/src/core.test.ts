import { describe, expect, it } from 'vitest';
import { buildDashboard } from './dashboard.ts';
import { businessKey, findDuplicates, median } from './insights.ts';
import { daysInMonth, monthStatus } from './month.ts';
import { annotateWithBudget, type StoredTransaction } from './overlay.ts';
import type { RiseupBudget } from './riseup.ts';
import { addMonths, sampleData } from './sample.ts';
import { monthlyTotals } from './trends.ts';

const txn = (p: Partial<StoredTransaction>): StoredTransaction => ({
  transactionId: Math.random().toString(36).slice(2), transactionDate: '2026-09-10T00:00:00.000Z', cashflowDate: '2026-09', businessName: 'Shop', isIncome: false, amount: 100, ...p,
});
const exp = (id: string, amount: number, extra = {}) => ({ transactionId: id, transactionDate: '2026-09-05', businessName: id, isIncome: false, billingAmount: amount, incomeAmount: null, ...extra });

// The shape real accounts return: fixed expenses POSITIVE, incomes negative,
// tracked plans in originalAmount, weekly splits, an amount-less everyday envelope.
const budget: RiseupBudget = {
  budgetDate: '2026-09',
  lastUpdatedAt: '2026-09-15T06:00:00.000Z',
  envelopes: [
    { id: '2026-09#fixed#s1', type: 'fixed', balancedAmount: -20000, originalAmount: -20000, actuals: [{ transactionId: 's', transactionDate: '2026-09-09', businessName: 'Salary', isIncome: true, billingAmount: null, incomeAmount: 20000 }] },
    { id: '2026-09#fixed#r1', type: 'fixed', balancedAmount: 6000, originalAmount: 6000, actuals: [] },
    { id: '2026-09#fixed#n1', type: 'fixed', balancedAmount: 70, originalAmount: 70, actuals: [exp('Netflix', 79.9)] },
    { id: '2026-09#trackingCategory#food#0', type: 'trackingCategory', balancedAmount: 0, originalAmount: 1500, balanceDate: '2026-09-07', actuals: [exp('f1', 1500, { expense: 'כלכלה' })] },
    { id: '2026-09#trackingCategory#food#1', type: 'trackingCategory', balancedAmount: 0, originalAmount: 1500, balanceDate: '2026-09-14', actuals: [exp('f2', -1200, { expense: 'כלכלה' })] },
    { id: '2026-09#trackingCategory#pets', type: 'trackingCategory', balancedAmount: 0, originalAmount: 200, isCustomPrediction: true, actuals: [] },
    { id: '2026-09#variable', type: 'variable', balancedAmount: null, originalAmount: null, actuals: [exp('o1', 1800)] },
    { id: '2026-09#variableIncome', type: 'variableIncome', balancedAmount: null, originalAmount: null, actuals: [] },
  ],
  excluded: [exp('card-bill', 14000), { ...exp('transfer-in', 0), isIncome: true, incomeAmount: 40000, billingAmount: null }],
};

describe('monthStatus on the real RiseUp shape', () => {
  const s = monthStatus(budget, '2026-09-15', { categoryLabels: { pets: 'חיות מחמד' }, previousFixed: [{ businessName: 'Rent Ltd', amount: 6050 }, { businessName: 'Netflix', amount: 70 }] });

  it('reads a positive fixed amount as an expense, never as expected income', () => {
    expect(s.income).toEqual({ expected: 20000, received: 20000 });
    expect(s.fixed).toEqual({ planned: 6079.9, paid: 79.9, pending: 6000 });
  });

  it('names a pending fixed charge from last month when the amount matches one candidate', () => {
    const rent = s.envelopes.find((e) => e.id.endsWith('r1'))!;
    expect(rent).toMatchObject({ label: 'Rent Ltd', guessed: true, paid: false, kind: 'fixed' });
  });

  it('merges weekly envelopes into one category and takes the plan from originalAmount', () => {
    const food = s.envelopes.filter((e) => e.kind === 'tracked' && e.label === 'כלכלה');
    expect(food).toHaveLength(1);
    expect(food[0]).toMatchObject({ planned: 3000, actual: 2700, count: 2 });
    expect(food[0]!.weeks).toHaveLength(2);
  });

  it('keeps the name of a category with nothing spent yet', () => {
    expect(s.envelopes.find((e) => e.id.endsWith('pets'))!.label).toBe('חיות מחמד');
  });

  it('gives flexible spending what income leaves after fixed charges', () => {
    expect(s.flexible.planned).toBeCloseTo(20000 - 6079.9);
    expect(s.flexible.spent).toBe(4500);
    expect(s.envelopes.find((e) => e.kind === 'everyday')!.planned).toBeCloseTo(20000 - 6079.9 - 3200);
  });

  it('reports excluded items without ever adding them to a total', () => {
    expect(s.excluded).toEqual({ count: 2, expenses: 14000, income: 40000 });
    expect(s.income.received).toBe(20000);
  });

  it('stops owing a fixed charge that never came once the month has closed', () => {
    const closed = monthStatus(budget, '2026-10-03');
    expect(closed.fixed.pending).toBe(0);
    expect(closed.daysLeft).toBe(0);
    expect(monthStatus(budget, '2026-08-20').dayOfMonth).toBe(0);
  });

  it('knows month lengths', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-09')).toBe(30);
  });
});

describe('totals', () => {
  it('skip what RiseUp excludes and split fixed from variable by the budget, not by guesswork', () => {
    const stamped = annotateWithBudget([
      txn({ transactionId: 's', isIncome: true, amount: 20000 }), txn({ transactionId: 'Netflix', amount: 79.9, actualType: 'variable' }),
      txn({ transactionId: 'f1', amount: 1500, actualType: 'fixed' }), txn({ transactionId: 'o1', amount: 1800 }),
      txn({ transactionId: 'card-bill', amount: 14000 }), txn({ transactionId: 'transfer-in', amount: 40000, isIncome: true }),
    ], budget);
    const [m] = monthlyTotals(stamped);
    expect(m).toMatchObject({ income: 20000, fixed: 79.9, variable: 3300, expenses: 3379.9 });
  });
});

describe('insights', () => {
  it('normalizes bank descriptors', () => expect(businessKey('SHUFERSAL  DEAL #123')).toBe(businessKey('Shufersal Deal 77')));
  it('computes medians', () => { expect(median([3, 1, 2])).toBe(2); expect(median([4, 1, 2, 3])).toBe(2.5); expect(median([])).toBe(0); });
  it('flags same-amount charges close together, but not installments or excluded items', () => {
    const a = txn({ businessName: 'Wolt', amount: 186, transactionDate: '2026-09-11T00:00:00.000Z' });
    const b = txn({ businessName: 'Wolt', amount: 186, transactionDate: '2026-09-12T00:00:00.000Z' });
    expect(findDuplicates([a, b, txn({ businessName: 'Wolt', amount: 186, transactionDate: '2026-09-25T00:00:00.000Z' })])).toHaveLength(1);
    expect(findDuplicates([{ ...a, isInstallment: true }, { ...b, isInstallment: true }])).toHaveLength(0);
    expect(findDuplicates([{ ...a, excluded: true }, b])).toHaveLength(0);
  });
});

describe('sample dashboard', () => {
  const today = '2026-09-18';
  const { transactions, budgets, current } = sampleData(today);
  const d = buildDashboard({ budget: budgets.get(current)!, transactions, today, lastSyncAt: '2026-09-18T04:00:00Z', tokenExpiresInDays: 5, source: 'sample' });

  it('is deterministic', () => expect(sampleData(today).transactions).toEqual(transactions));

  it('covers twelve months and stops at today', () => {
    expect(d.months).toHaveLength(12);
    expect(d.months[0]!.month).toBe(addMonths(current, -11));
    expect(d.transactions.every((t) => t.transactionDate.slice(0, 10) <= today)).toBe(true);
  });

  it('never counts the card bill or transfers, in any month', () => {
    expect(d.excluded.length).toBe(4);
    expect(d.transactions.some((t) => t.excluded)).toBe(false);
    for (const m of d.months.slice(0, -1)) expect(m.expenses, m.month).toBeLessThan(60000);
    const raw = transactions.filter((t) => t.cashflowDate === d.months[0]!.month && !t.isIncome).reduce((s, t) => s + t.amount, 0);
    expect(raw - d.months[0]!.expenses).toBe(14200 + 9800 + 5000);
  });

  it('agrees with RiseUp\'s own envelopes to the shekel', () => {
    const spent = d.transactions.filter((t) => !t.isIncome).reduce((s, t) => s + t.amount, 0);
    expect(d.status.fixed.paid + d.status.flexible.spent).toBeCloseTo(spent);
    expect(d.months.at(-1)!.fixed).toBeCloseTo(d.status.fixed.paid);
    expect(d.months.at(-1)!.variable).toBeCloseTo(d.status.flexible.spent);
  });

  it('lists as recurring exactly what RiseUp files under fixed', () => {
    expect(d.recurring.every((r) => transactions.some((t) => t.businessName === r.businessName && t.envelopeType === 'fixed'))).toBe(true);
    expect(d.recurring.some((r) => r.businessName === 'שופרסל דיל')).toBe(false);
  });

  it('surfaces each seeded incident without flooding', () => {
    const kinds = new Set(d.alerts.map((a) => a.kind));
    for (const k of ['duplicate-charge', 'large-transaction', 'price-increase', 'token-expiring'] as const) expect(kinds, k).toContain(k);
    expect(d.alerts.filter((a) => a.severity !== 'critical').length).toBeLessThanOrEqual(9);
  });
});
