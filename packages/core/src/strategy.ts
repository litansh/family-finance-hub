import { loanPayment, type Baseline } from './forecast.ts';
import type { MonthTotals } from './trends.ts';

// The path to balance. A household that spends more than it earns has three
// questions: how big is the gap and where is it heading, how much must change
// each month to close it, and what is the cheapest way to carry the months in
// between. Everything here is arithmetic on the family's own numbers and its own
// stated assumptions; nothing is predicted that the family did not put in.

// ---- Trend -----------------------------------------------------------------------

export interface Trend {
  months: string[]; // the closed months it is fitted on
  incomeNow: number; // typical month today
  expensesNow: number;
  gapNow: number; // expenses − income; positive means the month ends short
  incomeSlope: number; // ILS per month, per month — of the recurring income only, when it is known
  steadyIncomeNow: number; // the recurring part of income (salaries), typical month; 0 when unknown
  irregularIncomePerMonth: number; // bonuses and other one-offs, averaged over the last six closed months
  expenseSlope: number;
  // Months until income meets expenses if both simply keep their slope; null when they never meet.
  monthsToBalanceOnTrend: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// Theil–Sen: the median of all pairwise slopes. One bonus month, or one month
// with a large one-off purchase, does not bend it the way least squares would.
export function robustSlope(ys: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) slopes.push((ys[j]! - ys[i]!) / (j - i));
  return median(slopes);
}

// One line per past income deposit; `fixed` marks the ones RiseUp files as recurring.
export interface IncomeLine { m: string; a: number; inc: boolean; fixed: boolean }

export function trend(months: MonthTotals[], currentMonth: string, base: Baseline, history: IncomeLine[] = []): Trend {
  const closed = months.filter((m) => m.month < currentMonth).slice(-12);
  // A bonus or a one-off sale a year ago says nothing about where the salary is
  // heading, and would read as "income is falling". The slope follows recurring
  // income; total income is only the fallback when that split is not available.
  const steady = closed.map((m) => history.filter((h) => h.inc && h.fixed && h.m === m.month).reduce((s, h) => s + h.a, 0));
  const knowsSteady = steady.filter((x) => x > 0).length >= 4;
  const series = knowsSteady ? steady : closed.map((m) => m.income);
  const incomeSlope = closed.length >= 4 ? robustSlope(series) : 0;
  const steadyIncomeNow = knowsSteady ? median(steady.slice(-3)) : 0;
  const recent = closed.map((m, i) => Math.max(m.income - steady[i]!, 0)).slice(-6);
  const irregularIncomePerMonth = knowsSteady && recent.length ? recent.reduce((s, x) => s + x, 0) / recent.length : 0;
  const expenseSlope = closed.length >= 4 ? robustSlope(closed.map((m) => m.expenses)) : 0;
  const incomeNow = base.income;
  const expensesNow = base.fixed + base.variable + base.installments.reduce((s, p) => s + p.monthly, 0);
  const gapNow = expensesNow - incomeNow;
  const closing = incomeSlope - expenseSlope; // how fast the gap shrinks
  return {
    months: closed.map((m) => m.month), incomeNow, expensesNow, gapNow, incomeSlope, expenseSlope, steadyIncomeNow, irregularIncomePerMonth,
    monthsToBalanceOnTrend: gapNow <= 0 ? 0 : closing > 1 ? Math.ceil(gapNow / closing) : null,
  };
}

// ---- The plan ----------------------------------------------------------------------

export interface ExistingLoan { label: string; monthly: number; remaining: number } // a loan RiseUp only shows as a fixed charge

export interface StrategyInputs {
  monthsToBalance: number; // the family's target, e.g. 12
  incomeUp: number; // extra monthly income reached by then
  expenseDown: number; // monthly spending cut reached by then
  followIncomeTrend: boolean; // also let income keep growing at its measured slope, for at most a year
  // Irregular income the family is willing to count on, averaged per month (bonuses, side work).
  // Nothing is assumed unless they say so: the typical month is a median, which leaves one-offs out.
  otherIncomePerMonth: number;
  startBalance: number; // in the account today
  overdraftLimit: number; // how far below zero the bank allows, as a positive number
  overdraftRatePct: number;
  loanAmount: number; // the bridge loan being considered
  loanRatePct: number;
  loanMonths: number;
  existingLoans: ExistingLoan[];
  consolidateInstallments: boolean; // fold open card installment plans into the consolidation too
}

export const defaultStrategy = (): StrategyInputs => ({
  monthsToBalance: 12, incomeUp: 5000, expenseDown: 5000, followIncomeTrend: false, otherIncomePerMonth: 0,
  startBalance: 0, overdraftLimit: 0, overdraftRatePct: 11, loanAmount: 100_000, loanRatePct: 8, loanMonths: 60,
  existingLoans: [], consolidateInstallments: false,
});

export type OptionId = 'overdraft' | 'loan' | 'consolidate' | 'consolidate+loan';

export interface StrategyRow { month: string; income: number; expenses: number; debtPayments: number; interest: number; net: number; balance: number }

export interface StrategyOption {
  id: OptionId;
  loanPrincipal: number; // 0 for the overdraft option
  loanPayment: number;
  paysOff: number; // existing debt the loan closes on day one
  freedMonthly: number; // monthly payments that disappear because of it
  cashIn: number; // what actually reaches the account
  rows: StrategyRow[];
  lowest: { balance: number; month: string };
  // First month from which income covers living costs and debt payments, and keeps doing so.
  // Overdraft interest is not part of it: it is the price of the road, and is reported as such.
  breakEvenMonth: string | null;
  holds: boolean; // the balance never goes below the overdraft limit
  loanInterest: number; // over the whole life of the loan
  overdraftInterest: number; // within the horizon
  totalCost: number;
  debtAtEnd: number; // still owed on the new loan when the horizon ends
  // Extra monthly improvement, on top of the plan, that would make this option hold. 0 when it holds.
  missingPerMonth: number;
}

export interface Strategy {
  trend: Trend;
  inputs: StrategyInputs;
  horizon: number;
  cutToBalanceToday: number; // close the whole gap at once
  // The cut that reaches balance in the target month, given the income the family expects by then.
  cutNeededByTarget: number;
  // The deepest the account goes with no loan and before any interest: the hole
  // the plan itself digs, which some form of credit has to carry.
  bridgeNeeded: number;
  options: StrategyOption[];
  recommended: OptionId | null; // cheapest option that holds; null when none does
}

const addM = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

interface Setup { principal: number; paysOff: number; closesLoans: boolean; closesInstallments: boolean }

function run(base: Baseline, t: Trend, q: StrategyInputs, s: Setup, horizon: number, extraCut = 0) {
  const pay = s.principal > 0 ? loanPayment(s.principal, q.loanRatePct, q.loanMonths) : 0;
  const rows: StrategyRow[] = [];
  let balance = q.startBalance + base.restOfMonth + (s.principal - s.paysOff);
  let overdraftInterest = 0;
  // The fixed charges already include the existing loans' payments.
  const fixedWithoutLoans = base.fixed - q.existingLoans.reduce((a, l) => a + l.monthly, 0);

  for (let i = 1; i <= horizon; i++) {
    const month = addM(base.month, i);
    const ramp = Math.min(i / Math.max(q.monthsToBalance, 1), 1);
    const income = t.incomeNow + q.otherIncomePerMonth + ramp * q.incomeUp + (q.followIncomeTrend ? Math.max(t.incomeSlope, 0) * Math.min(i, 12) : 0);
    const installments = s.closesInstallments ? 0 : base.installments.filter((p) => month <= p.lastMonth).reduce((a, p) => a + p.monthly, 0);
    // An existing loan ends when it is paid; without its schedule, remaining ÷ monthly is the closest honest estimate.
    const oldLoans = s.closesLoans ? 0 : q.existingLoans.filter((l) => l.monthly > 0 && i <= Math.ceil(l.remaining / l.monthly)).reduce((a, l) => a + l.monthly, 0);
    const living = Math.max(fixedWithoutLoans + base.variable - ramp * q.expenseDown - extraCut, 0);
    const newLoan = pay > 0 && i >= 2 && i <= q.loanMonths + 1 ? pay : 0;
    const interest = balance < 0 ? (-balance * q.overdraftRatePct) / 100 / 12 : 0;
    overdraftInterest += interest;
    const debtPayments = installments + oldLoans + newLoan;
    const net = income - living - debtPayments - interest;
    balance += net;
    rows.push({ month, income, expenses: living, debtPayments, interest, net, balance });
  }
  return { rows, pay, overdraftInterest };
}

function evaluate(id: OptionId, base: Baseline, t: Trend, q: StrategyInputs, s: Setup, horizon: number): StrategyOption {
  const { rows, pay, overdraftInterest } = run(base, t, q, s, horizon);
  const lowest = rows.reduce((a, b) => (b.balance < a.balance ? b : a), rows[0]!);
  const holdsWith = (r: StrategyRow[]) => r.every((x) => x.balance >= -q.overdraftLimit - 0.5);
  let breakEvenMonth: string | null = null;
  for (let i = 0; i < rows.length; i++) if (rows.slice(i).every((x) => x.net + x.interest >= -0.5)) { breakEvenMonth = rows[i]!.month; break; }

  let missingPerMonth = 0;
  if (!holdsWith(rows)) {
    let lo = 0, hi = 100_000;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (holdsWith(run(base, t, q, s, horizon, mid).rows)) hi = mid; else lo = mid; }
    missingPerMonth = Math.ceil(hi / 50) * 50;
  }
  const paidSoFar = Math.min(Math.max(horizon - 1, 0), q.loanMonths);
  const r = q.loanRatePct / 100 / 12;
  const debtAtEnd = s.principal <= 0 || paidSoFar >= q.loanMonths ? 0 : r === 0 ? s.principal * (1 - paidSoFar / q.loanMonths) : s.principal * (1 + r) ** paidSoFar - pay * (((1 + r) ** paidSoFar - 1) / r);
  const loanInterest = s.principal > 0 ? pay * q.loanMonths - s.principal : 0;
  const freedMonthly = (s.closesLoans ? q.existingLoans.reduce((a, l) => a + l.monthly, 0) : 0) + (s.closesInstallments ? base.installments.reduce((a, p) => a + p.monthly, 0) : 0);
  return {
    id, loanPrincipal: s.principal, loanPayment: pay, paysOff: s.paysOff, freedMonthly, cashIn: s.principal - s.paysOff, rows,
    lowest: { balance: lowest.balance, month: lowest.month }, breakEvenMonth, holds: holdsWith(rows),
    loanInterest, overdraftInterest, totalCost: loanInterest + overdraftInterest, debtAtEnd, missingPerMonth,
  };
}

export function strategy(months: MonthTotals[], base: Baseline, inputs: Partial<StrategyInputs> = {}, history: IncomeLine[] = []): Strategy {
  const q: StrategyInputs = { ...defaultStrategy(), ...inputs, existingLoans: (inputs.existingLoans ?? []).filter((l) => l.monthly > 0 && l.remaining > 0) };
  const t = trend(months, base.month, base, history);
  const horizon = Math.max(q.monthsToBalance + 24, 36);

  const loansOwed = q.existingLoans.reduce((a, l) => a + l.remaining, 0);
  const installmentsOwed = q.consolidateInstallments ? base.installments.reduce((a, p) => a + p.remainingAmount, 0) : 0;
  const owed = loansOwed + installmentsOwed;
  const none: Setup = { principal: 0, paysOff: 0, closesLoans: false, closesInstallments: false };
  const setups: [OptionId, Setup][] = [['overdraft', none]];
  if (q.loanAmount > 0) setups.push(['loan', { ...none, principal: q.loanAmount }]);
  if (owed > 0) {
    const closes = { closesLoans: loansOwed > 0, closesInstallments: q.consolidateInstallments };
    setups.push(['consolidate', { principal: owed, paysOff: owed, ...closes }]);
    if (q.loanAmount > 0) setups.push(['consolidate+loan', { principal: owed + q.loanAmount, paysOff: owed, ...closes }]);
  }
  const options = setups.map(([id, s]) => evaluate(id, base, t, q, s, horizon));

  // What the target month looks like with the income the family expects and no cut at all.
  const atTarget = run(base, t, { ...q, expenseDown: 0 }, none, q.monthsToBalance).rows.at(-1)!;
  const holding = options.filter((o) => o.holds).sort((a, b) => a.totalCost - b.totalCost);
  return {
    trend: t, inputs: q, horizon,
    cutToBalanceToday: Math.max(t.gapNow, 0),
    // Overdraft interest is left out: it is a cost of the road, not of the month that is reached.
    cutNeededByTarget: Math.max(atTarget.expenses + atTarget.debtPayments - atTarget.income, 0),
    bridgeNeeded: Math.max(-Math.min(...run(base, t, { ...q, overdraftRatePct: 0 }, none, horizon).rows.map((r) => r.balance)), 0),
    options,
    recommended: holding[0]?.id ?? null,
  };
}
