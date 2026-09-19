import { describe, expect, it } from 'vitest';
import { emptyPlan, loanBalance, loanPayment, maxDailySpend, simulate, type Baseline } from './forecast.ts';

const base: Baseline = {
  month: '2026-09', income: 40000, fixed: 20000, variable: 15000, restOfMonth: 0, basis: { incomeMonths: 6, variableMonths: 3 },
  installments: [
    { key: 'loanA', businessName: 'הלוואה א', monthly: 1000, paid: 4, total: 48, remainingPayments: 44, remainingAmount: 44000, lastMonth: '2030-05', fixed: true },
    { key: 'tv', businessName: 'טלוויזיה', monthly: 500, paid: 10, total: 12, remainingPayments: 2, remainingAmount: 1000, lastMonth: '2026-11', fixed: false },
  ],
};

describe('loanPayment', () => {
  it('matches the standard amortization formula', () => {
    expect(loanPayment(100000, 6, 60)).toBeCloseTo(1933.28, 1);
    expect(loanPayment(12000, 0, 12)).toBe(1000);
  });
});

describe('simulate', () => {
  it('drops an installment plan the month after it ends', () => {
    const f = simulate(base, emptyPlan(), 4);
    expect(f.rows.map((r) => r.installments)).toEqual([1500, 1500, 1000, 1000]);
    expect(f.rows[0]!.net).toBe(40000 - 20000 - 1500 - 15000);
    expect(f.rows[3]!.balance).toBe(3500 + 3500 + 4000 + 4000);
  });

  it('applies a bonus once and a raise from its month on', () => {
    const plan = { ...emptyPlan(), events: [
      { id: 'b', kind: 'income-once' as const, label: 'בונוס', month: '2027-01', amount: 30000 },
      { id: 'r', kind: 'income-monthly' as const, label: 'העלאה', month: '2026-12', amount: 2000 },
    ] };
    const f = simulate(base, plan, 6);
    expect(f.rows.map((r) => r.income)).toEqual([40000, 40000, 42000, 42000, 42000, 42000]);
    expect(f.rows.find((r) => r.month === '2027-01')!.oneOff).toBe(30000);
    expect(f.rows.find((r) => r.month === '2027-02')!.oneOff).toBe(0);
  });

  it('lets a loan close an existing plan: proceeds in, payoff out, old payment gone, new payment from the next month', () => {
    const plan = { ...emptyPlan(), events: [{ id: 'l', kind: 'loan' as const, label: 'איחוד', month: '2026-10', amount: 50000, loan: { annualRatePct: 6, months: 60, payoffKeys: ['loanA'], payoffOther: 5000 } }] };
    const f = simulate(base, plan, 3);
    expect(f.rows[0]!.oneOff).toBe(50000 - 44000 - 5000); // 44 payments still owed in the first forecast month
    expect(f.rows[0]!.installments).toBe(500);
    expect(f.rows[0]!.loanPayments).toBe(0);
    expect(f.rows[1]!.loanPayments).toBeCloseTo(loanPayment(50000, 6, 60));
    expect(f.totalInterest).toBeCloseTo(loanPayment(50000, 6, 60) * 60 - 50000);
    expect(f.freedMonthly).toBe(1000);
  });

  it('counts the rest of the current month and the starting balance', () => {
    const f = simulate({ ...base, restOfMonth: -2000 }, { ...emptyPlan(), startBalance: 10000 }, 1);
    expect(f.rows[0]!.balance).toBe(10000 - 2000 + 3500);
  });
});

describe('maxDailySpend', () => {
  it('does not treat a loan that outlives the forecast as free money', () => {
    const loan = { id: 'l', kind: 'loan' as const, label: 'x', month: '2026-10', amount: 100000, loan: { annualRatePct: 7, months: 60, payoffKeys: [], payoffOther: 0 } };
    const without = maxDailySpend(base, emptyPlan(), 12);
    const withLoan = maxDailySpend(base, { ...emptyPlan(), events: [loan] }, 12);
    // The loan may ease the tight early months, but it must not read as ₪100,000
    // of spending money: that would be about ₪274 more per day over a year.
    expect(withLoan - without).toBeLessThan(40);
    const f = simulate(base, { ...emptyPlan(), events: [loan], dailySpend: withLoan }, 12);
    expect(f.endBalance - f.loanOutstanding).toBeGreaterThanOrEqual(0);
    expect(loanBalance(100000, 7, 60, 0)).toBe(100000);
    expect(loanBalance(100000, 7, 60, 60)).toBe(0);
    expect(loanBalance(100000, 7, 60, 12)).toBeGreaterThan(80000);
  });

  it('finds the daily amount that just keeps the balance at the floor', () => {
    const plan = { ...emptyPlan(), startBalance: 0, floor: 0 };
    const daily = maxDailySpend(base, plan, 12);
    expect(simulate(base, { ...plan, dailySpend: daily }, 12).minBalance).toBeGreaterThanOrEqual(0);
    expect(simulate(base, { ...plan, dailySpend: daily + 5 }, 12).minBalance).toBeLessThan(0);
  });

  it('rises with a bonus, a raise and an overdraft line, and is zero when nothing is affordable', () => {
    const plain = maxDailySpend(base, emptyPlan(), 12);
    const richer = maxDailySpend(base, { ...emptyPlan(), floor: -10000, events: [{ id: 'r', kind: 'income-monthly', label: 'העלאה', month: '2026-10', amount: 3000 }] }, 12);
    expect(richer).toBeGreaterThan(plain);
    expect(maxDailySpend({ ...base, income: 10000 }, emptyPlan(), 12)).toBe(0);
  });
});
