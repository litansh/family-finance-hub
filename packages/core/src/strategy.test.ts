import { describe, expect, it } from 'vitest';
import type { Baseline } from './forecast.ts';
import { loanPayment } from './forecast.ts';
import { robustSlope, strategy, trend } from './strategy.ts';
import type { MonthTotals } from './trends.ts';

const month = (i: number) => `2026-${String(i).padStart(2, '0')}`;
const totals = (income: (i: number) => number, expenses: (i: number) => number): MonthTotals[] =>
  Array.from({ length: 8 }, (_, k) => { const i = k + 1; const inc = income(i), exp = expenses(i); return { month: month(i), income: inc, fixed: exp / 2, variable: exp / 2, expenses: exp, net: inc - exp, savingsRate: 0 }; });
const base = (over: Partial<Baseline> = {}): Baseline => ({ month: '2026-09', income: 30_000, fixed: 20_000, variable: 20_000, restOfMonth: 0, installments: [], basis: { incomeMonths: 6, variableMonths: 3 }, ...over });

describe('trend', () => {
  it('one bonus month does not bend the slope', () => {
    expect(robustSlope([100, 110, 120, 900, 140, 150])).toBeCloseTo(10);
  });
  it('follows the salary, not a bonus from a year ago', () => {
    // half of the fitted months carried a one-off, more than any robust fit can shrug off
    const months = totals((i) => 28_000 + 100 * i + (i <= 4 ? 90_000 - 15_000 * i : 0), () => 40_000);
    const history = months.flatMap((m, k) => [{ m: m.month, a: 28_000 + 100 * (k + 1), inc: true, fixed: true }, ...(m.income > 40_000 ? [{ m: m.month, a: m.income - 28_000 - 100 * (k + 1), inc: true, fixed: false }] : [])]);
    expect(trend(months, '2026-09', base()).incomeSlope).toBeLessThan(0); // total income looks like it is falling
    const t = trend(months, '2026-09', base(), history);
    expect(t.incomeSlope).toBeCloseTo(100);
    expect(t.steadyIncomeNow).toBeCloseTo(28_700);
    expect(t.irregularIncomePerMonth).toBeGreaterThan(10_000);
  });
  it('says when income catches up on its own, and when it never will', () => {
    const rising = trend(totals((i) => 25_000 + 1000 * i, () => 40_000), '2026-09', base());
    expect(rising.gapNow).toBe(10_000);
    expect(rising.incomeSlope).toBeCloseTo(1000);
    expect(rising.monthsToBalanceOnTrend).toBe(10);
    expect(trend(totals(() => 30_000, (i) => 40_000 + 500 * i), '2026-09', base()).monthsToBalanceOnTrend).toBeNull();
  });
});

describe('the path to balance', () => {
  const flat = totals(() => 30_000, () => 40_000);

  it('states the gap, the cut needed by the target month, and what has to be carried', () => {
    const s = strategy(flat, base(), { incomeUp: 5000, expenseDown: 5000, monthsToBalance: 12, loanAmount: 0 });
    expect(s.cutToBalanceToday).toBe(10_000);
    expect(s.cutNeededByTarget).toBeCloseTo(5000); // income grows by 5,000, the other 5,000 has to be cut
    // the gap shrinks evenly from 10,000 to 0 over 12 months: 55,000 before any interest
    expect(s.bridgeNeeded).toBeCloseTo(55_000);
    // carried in overdraft, interest makes the hole deeper than the plan alone
    expect(-s.options[0]!.lowest.balance).toBeGreaterThan(s.bridgeNeeded);
    expect(s.options[0]!.breakEvenMonth).toBe('2027-09');
    expect(s.options.map((o) => o.id)).toEqual(['overdraft']);
    expect(s.options[0]!.breakEvenMonth).not.toBeNull();
  });

  it('counts irregular income only when the family says it may', () => {
    expect(strategy(flat, base(), { loanAmount: 0 }).cutNeededByTarget).toBeCloseTo(5000);
    expect(strategy(flat, base(), { loanAmount: 0, otherIncomePerMonth: 3000 }).cutNeededByTarget).toBeCloseTo(2000);
  });

  it('a loan that covers the road holds; one that does not says how much more must change', () => {
    const big = strategy(flat, base(), { loanAmount: 100_000, loanRatePct: 8, loanMonths: 60 });
    const loan = big.options.find((o) => o.id === 'loan')!;
    expect(loan.loanPayment).toBeCloseTo(loanPayment(100_000, 8, 60));
    expect(loan.loanInterest).toBeCloseTo(loan.loanPayment * 60 - 100_000);
    // Balanced on living costs after a year, but the loan's own payment keeps the month short.
    expect(loan.holds).toBe(false);
    expect(loan.missingPerMonth).toBeGreaterThan(0);
    expect(big.recommended).toBeNull();

    const enough = strategy(flat, base(), { loanAmount: 100_000, incomeUp: 8000, expenseDown: 6000 });
    expect(enough.options.find((o) => o.id === 'loan')!.holds).toBe(true);
    expect(enough.recommended).toBe('loan');
    expect(enough.options.find((o) => o.id === 'overdraft')!.holds).toBe(false); // no overdraft line was stated
  });

  it('with an overdraft line, compares the cost of carrying it there against a loan', () => {
    const s = strategy(flat, base(), { loanAmount: 100_000, incomeUp: 8000, expenseDown: 6000, overdraftLimit: 80_000, overdraftRatePct: 12, loanRatePct: 8 });
    const [od, loan] = [s.options.find((o) => o.id === 'overdraft')!, s.options.find((o) => o.id === 'loan')!];
    expect(od.holds && loan.holds).toBe(true);
    expect(od.overdraftInterest).toBeGreaterThan(0);
    expect(s.recommended).toBe(od.totalCost <= loan.totalCost ? 'overdraft' : 'loan');
  });

  it('consolidation closes the old loans, frees their payments, and is sized to what is owed', () => {
    const existingLoans = [{ label: 'א', monthly: 3000, remaining: 60_000 }, { label: 'ב', monthly: 2000, remaining: 30_000 }];
    const s = strategy(flat, base(), { existingLoans, loanAmount: 50_000 });
    const c = s.options.find((o) => o.id === 'consolidate')!;
    expect(c).toMatchObject({ loanPrincipal: 90_000, paysOff: 90_000, cashIn: 0, freedMonthly: 5000 });
    const both = s.options.find((o) => o.id === 'consolidate+loan')!;
    expect(both).toMatchObject({ loanPrincipal: 140_000, cashIn: 50_000 });
    // The old payments are gone from month one; the new one starts a month later.
    expect(c.rows[0]!.debtPayments).toBe(0);
    expect(c.rows[1]!.debtPayments).toBeCloseTo(c.loanPayment);
    // Without consolidating, an old loan stops when it is paid off: 30,000 ÷ 2,000 = 15 months.
    const od = s.options.find((o) => o.id === 'overdraft')!;
    expect(od.rows[14]!.debtPayments).toBe(5000);
    expect(od.rows[15]!.debtPayments).toBe(3000);
  });
});
