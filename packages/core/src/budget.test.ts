import { describe, expect, it } from 'vitest';
import { EVERYDAY, addMonth, shiftTotals, spendCheck, type BudgetShift, type Commitments } from './budget.ts';
import { buildEnvelopes } from './month.ts';
import type { RiseupBudget } from './riseup.ts';
import { buildDashboard } from './dashboard.ts';
import { sampleData } from './sample.ts';

const today = '2026-09-19';
const s = sampleData(today);
const build = (shifts: BudgetShift[] = []) => buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: null, source: 'sample', shifts });
const shift = (from: string, to: string, amount: number, month = s.current): BudgetShift => ({ id: `${from}>${to}`, month, from, to, amount, by: 'alex@example.com', at: `${today}T10:00:00Z` });

describe('budget shifts', () => {
  const d = build();
  const tracked = d.status.envelopes.filter((e) => e.kind === 'tracked');
  const [a, b] = [tracked[0]!, tracked[1]!];

  it('moves budget between two categories and leaves the month total alone', () => {
    const after = build([shift(a.label, b.label, 200)]);
    const find = (l: string) => after.status.envelopes.find((e) => e.kind === 'tracked' && e.label === l)!;
    expect(find(a.label).planned).toBeCloseTo(a.planned - 200);
    expect(find(b.label).planned).toBeCloseTo(b.planned + 200);
    expect(find(a.label).riseupPlanned).toBeCloseTo(a.planned); // RiseUp's own plan stays visible
    expect(after.status.flexible.trackedPlanned).toBeCloseTo(d.status.flexible.trackedPlanned);
    expect(after.status.flexible.left).toBeCloseTo(d.status.flexible.left);
    expect(after.shifts).toHaveLength(1);
  });

  it('everyday spending follows by itself', () => {
    const before = d.status.envelopes.find((e) => e.kind === 'everyday')!.planned;
    const after = build([shift(EVERYDAY, a.label, 150)]).status.envelopes.find((e) => e.kind === 'everyday')!.planned;
    expect(after).toBeCloseTo(Math.max(before - 150, 0));
  });

  it('ignores other months, and an undo cancels out', () => {
    expect(shiftTotals([shift(a.label, b.label, 100, '2020-01')], s.current).size).toBe(0);
    const net = shiftTotals([shift(a.label, b.label, 100), shift(b.label, a.label, 100)], s.current);
    expect(net.get(a.label)).toBe(0);
    expect(build([shift(a.label, b.label, 100, '2020-01')]).shifts).toHaveLength(0);
  });
});

describe('next month', () => {
  const n = build().nextMonth;
  it('is the month after, built from closed months only', () => {
    expect(n.month).toBe(addMonth(s.current, 1));
    expect(n.basisMonths.every((m) => m < s.current)).toBe(true);
    expect(n.basisMonths.length).toBeGreaterThan(0);
  });
  it('adds up', () => {
    expect(n.income.total).toBeGreaterThan(0);
    expect(n.fixed.total).toBeGreaterThan(0);
    const planned = n.planned.reduce((t, l) => t + l.amount, 0);
    expect(n.net).toBeCloseTo(n.income.total - n.fixed.total - n.variable.total + planned);
    expect(n.ifOnBudget).toBeGreaterThanOrEqual(n.net - 0.01); // keeping to budgets can only help
  });
  it('includes what the family planned for that month', () => {
    const plan = { id: 'p', name: 'p', startBalance: 0, floor: 0, events: [{ id: '1', kind: 'income-once' as const, label: 'בונוס', month: n.month, amount: 5000 }, { id: '2', kind: 'expense-once' as const, label: 'רחוק', month: addMonth(n.month, 3), amount: 900 }] };
    const withPlan = buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: null, plan }).nextMonth;
    expect(withPlan.planned).toEqual([{ label: 'בונוס', amount: 5000 }]);
    expect(withPlan.net).toBeCloseTo(n.net + 5000);
  });
});

describe('can I spend this?', () => {
  const st = build().status;
  const tracked = st.envelopes.filter((e) => e.kind === 'tracked');
  const roomy = [...tracked].sort((x, y) => y.remaining - x.remaining)[0]!;

  it('a small purchase inside a category with room fits', () => {
    const c = spendCheck(st, { amount: 1, category: roomy.label });
    expect(c.category).toBe(roomy.label);
    expect(c.shortfall).toBe(0);
    expect(c.verdict).toBe('fits');
    expect(c.monthIsShort).toBe(st.flexible.left < 1);
    expect(c.categoryBudget!.leftAfter).toBeCloseTo(roomy.remaining - 1);
  });

  it('says so when no budget can carry it, reports the month separately, and names who could help', () => {
    const c = spendCheck(st, { amount: 1_000_000, category: roomy.label });
    expect(c.verdict).toBe('over-budget');
    expect(c.monthIsShort).toBe(true);
    expect(c.month.leftAfter).toBeLessThan(0);
    expect(c.sources.every((x) => x.label !== roomy.label && x.available >= 1)).toBe(true);
  });

  it('an unknown category comes out of everyday spending', () => {
    expect(spendCheck(st, { amount: 50, category: 'אין קטגוריה כזו' }).category).toBe(EVERYDAY);
    expect(spendCheck(st, { amount: 50 }).category).toBe(EVERYDAY);
  });

  it('never suggests taking more than a category can spare', () => {
    const tight = [...tracked].sort((x, y) => x.remaining - y.remaining)[0]!;
    const c = spendCheck(st, { amount: Math.max(tight.remaining, 0) + 300, category: tight.label });
    const spare = new Map(c.sources.map((x) => [x.label, x.available]));
    for (const sh of c.suggestedShifts) expect(sh.amount).toBeLessThanOrEqual(spare.get(sh.from)!);
    const offered = c.suggestedShifts.reduce((t, sh) => t + sh.amount, 0);
    expect(c.verdict).toBe(offered >= c.shortfall - 1 ? 'fits-with-shift' : 'over-budget');
    expect(c.suggestedShifts.every((sh) => sh.to === tight.label)).toBe(true);
  });
});

describe('committed categories', () => {
  const plain = build();
  const e = plain.status.envelopes.filter((x) => x.kind === 'tracked')[0]!;
  const withC = (c: Commitments) => buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: null, commitments: c });

  const tracked = plain.status.envelopes.filter((x) => x.kind === 'tracked');
  const setAside = (d: typeof plain) => d.status.envelopes.filter((x) => x.kind === 'tracked').reduce((t, x) => t + Math.max(x.planned, x.actual), 0);

  it('sets every rubric aside at RiseUp\'s own target, with nothing typed in', () => {
    expect(plain.free.committed.map((c) => c.label).sort()).toEqual(tracked.map((x) => x.label).sort());
    expect(plain.free.committed.every((c) => !c.own)).toBe(true);
    expect(plain.free.committedTotal).toBeCloseTo(setAside(plain));
    expect(plain.free.freeForRest).toBeCloseTo(plain.status.flexible.planned - setAside(plain));
    const everyday = plain.status.envelopes.find((x) => x.kind === 'everyday')!;
    expect(plain.free.restSpent).toBeCloseTo(everyday.actual);
    // a target not yet used up is not free money
    expect(plain.free.restLeft).toBeLessThanOrEqual(plain.status.flexible.left + 0.01);
  });

  it('an amount of our own replaces RiseUp\'s target for that rubric, and RiseUp\'s stays visible', () => {
    const amount = Math.round(e.actual) + 500; // more than was spent
    const d = withC({ [e.label]: amount });
    const env = d.status.envelopes.find((x) => x.kind === 'tracked' && x.label === e.label)!;
    expect(env).toMatchObject({ planned: amount, committed: true });
    expect(env.riseupPlanned).toBeCloseTo(e.planned);
    expect(d.free.committed.find((c) => c.label === e.label)).toMatchObject({ amount, counted: amount, own: true });
    expect(d.free.freeForRest).toBeCloseTo(plain.free.freeForRest - (amount - Math.max(e.planned, e.actual)));
  });

  it('an overrun eats into the rest, never hides', () => {
    const d = withC({ [e.label]: 1 });
    expect(d.free.committed.find((c) => c.label === e.label)!.counted).toBeCloseTo(Math.max(e.actual, 1));
    expect(d.free.committedTotal).toBeCloseTo(setAside(d));
  });

  it('a shift moves on top of the commitment', () => {
    const other = plain.status.envelopes.filter((x) => x.kind === 'tracked')[1]!;
    const d = buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: null, commitments: { [e.label]: 1000 }, shifts: [shift(other.label, e.label, 100)] });
    expect(d.status.envelopes.find((x) => x.label === e.label)!.planned).toBe(1100);
  });
});

describe('naming a fixed charge RiseUp has not named yet', () => {
  const env = (id: string, amount: number, date?: string) => ({ id: `2026-09#fixed#${id}`, type: 'fixed' as const, balancedAmount: amount, originalAmount: amount, balanceDate: date, actuals: [] });
  const paid = { id: '2026-09#fixed#p', type: 'fixed' as const, balancedAmount: 100, originalAmount: 100, actuals: [{ transactionId: 't', transactionDate: '2026-09-02', businessName: 'ארנונה', isIncome: false, billingAmount: 100, incomeAmount: null }] };
  const budget = (es: RiseupBudget['envelopes']): RiseupBudget => ({ budgetDate: '2026-09', lastUpdatedAt: '', envelopes: [paid, ...es] });
  const previousFixed = [{ businessName: 'חשמל', amount: 300, day: 12 }, { businessName: 'מים', amount: 62, day: 5 }, { businessName: 'גז', amount: 62.5, day: 28 }, { businessName: 'ארנונה', amount: 100, day: 2 }];

  it('one fit gives a name; several give candidates, and the expected day breaks the tie', () => {
    const [ , one, tie, byDay, none] = buildEnvelopes(budget([env('a', 300), env('b', 62), env('c', 62, '2026-09-28'), env('d', 999)]), { previousFixed });
    expect(one).toMatchObject({ label: 'חשמל', guessed: true });
    expect(tie!.maybe).toEqual(expect.arrayContaining(['מים', 'גז']));
    expect(byDay!.maybe![0]).toBe('גז');
    expect(byDay!.due).toBe('2026-09-28');
    expect(none).toMatchObject({ label: 'חיוב קבוע צפוי', guessed: false });
    expect(none!.maybe).toBeUndefined();
  });

  it('never offers a charge that was already paid this month, nor the same name twice', () => {
    const [, a, b] = buildEnvelopes(budget([env('a', 100), env('b', 300), env('c', 300)]), { previousFixed });
    expect(a!.label).toBe('חיוב קבוע צפוי'); // ארנונה is paid
    expect(b!.label).toBe('חשמל');
    expect(buildEnvelopes(budget([env('b', 300), env('c', 300)]), { previousFixed })[2]!.label).toBe('חיוב קבוע צפוי');
  });

  it('notices a charge that has been expected for months and never came', () => {
    const [, x, y] = buildEnvelopes(budget([env('a', 25), env('b', 40)]), { previousUnpaid: [[25, 7], [25], [80]] });
    expect(x!.pendingMonths).toBe(2);
    expect(y!.pendingMonths).toBeUndefined();
  });
});
