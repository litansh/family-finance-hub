import { median } from './insights.ts';
import { daysInMonth, type MonthStatus } from './month.ts';
import type { InstallmentPlan } from './overlay.ts';
import type { MonthTotals } from './trends.ts';

// A what-if planner. Deterministic arithmetic on the family's own numbers and
// assumptions — every figure it shows can be recomputed by hand.

export type PlanEventKind = 'income-once' | 'expense-once' | 'income-monthly' | 'expense-monthly' | 'loan';

export interface PlanEvent {
  id: string;
  kind: PlanEventKind;
  label: string;
  month: string; // YYYY-MM it happens or starts
  amount: number; // for a loan: the principal
  until?: string; // monthly events: last month, inclusive; open-ended when absent
  loan?: {
    annualRatePct: number;
    months: number;
    payoffKeys: string[]; // installment plans this loan closes in full
    payoffOther: number; // anything else it covers at once (overdraft, a debt RiseUp cannot see)
  };
}

export interface Plan {
  id: string;
  name: string;
  events: PlanEvent[];
  startBalance: number; // what is in the account today
  floor: number; // the lowest balance we accept, e.g. -10000 for an overdraft line
  dailySpend?: number; // variable spending per day; the historical average when absent
}

export interface Baseline {
  month: string; // the current cashflow month
  income: number; // typical monthly income
  fixed: number; // fixed charges, without installment plans
  variable: number; // variable spending, without installment plans
  restOfMonth: number; // what the rest of the current month is expected to add or take
  installments: InstallmentPlan[];
  basis: { incomeMonths: number; variableMonths: number };
}

export interface ForecastRow {
  month: string;
  income: number;
  fixed: number;
  installments: number;
  variable: number;
  loanPayments: number;
  oneOff: number; // signed: + in, − out (includes loan proceeds and what they close)
  net: number;
  balance: number;
}

export interface Forecast {
  rows: ForecastRow[];
  endBalance: number;
  minBalance: number;
  minMonth: string;
  monthsBelowFloor: number;
  totalInterest: number;
  loanPayment: number; // combined monthly payment of the plan's loans
  freedMonthly: number; // monthly payments the plan's loans make disappear
  loanOutstanding: number; // still owed on the plan's loans when the horizon ends
}

const addM = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Equal monthly payments (Spitzer), the usual Israeli consumer loan.
export function loanPayment(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months);
}

// Principal still owed after k equal payments.
export function loanBalance(principal: number, annualRatePct: number, months: number, k: number): number {
  if (k >= months) return 0;
  if (k <= 0) return principal;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal * (1 - k / months);
  const g = (1 + r) ** k;
  return principal * g - loanPayment(principal, annualRatePct, months) * ((g - 1) / r);
}

// `notRepeating`: fixed charges in this month's figure that no future month will carry: a plan whose
// last installment was just paid, and a charge RiseUp keeps expecting that never comes. The planner, the
// path to balance and next month's forecast all start from the same fixed figure because of it.
export function deriveBaseline(months: MonthTotals[], status: MonthStatus, installments: InstallmentPlan[], notRepeating = 0, endedVariable = 0): Baseline {
  const closed = months.filter((m) => m.month < status.month);
  const incomeFrom = closed.slice(-6);
  const variableFrom = closed.slice(-3);
  const instFixed = installments.filter((p) => p.fixed).reduce((s, p) => s + p.monthly, 0);
  const instVariable = installments.filter((p) => !p.fixed).reduce((s, p) => s + p.monthly, 0);
  // Median, so one bonus month does not pass for a salary.
  const income = incomeFrom.length ? median(incomeFrom.map((m) => m.income)) : status.income.expected;
  const variableAvg = variableFrom.length ? variableFrom.reduce((s, m) => s + m.variable, 0) / variableFrom.length : status.flexible.spent;
  const live = status.dayOfMonth > 0 && status.daysLeft > 0;
  const pace = live ? status.flexible.spent / status.dayOfMonth : 0;
  return {
    month: status.month,
    income,
    fixed: Math.max(status.fixed.planned - instFixed - notRepeating, 0),
    // `endedVariable`: the part of that average made of installment plans that have just finished.
    variable: Math.max(variableAvg - instVariable - endedVariable, 0),
    restOfMonth: live ? status.income.expected - status.income.received - status.fixed.pending - pace * status.daysLeft : 0,
    installments,
    basis: { incomeMonths: incomeFrom.length, variableMonths: variableFrom.length },
  };
}

export function simulate(base: Baseline, plan: Plan, horizon = 24): Forecast {
  const loans = plan.events.filter((e) => e.kind === 'loan' && e.loan);
  const closedBy = new Map<string, string>(); // installment key → month a loan closes it
  for (const l of loans) for (const k of l.loan!.payoffKeys) if (!closedBy.has(k) || l.month < closedBy.get(k)!) closedBy.set(k, l.month);

  const rows: ForecastRow[] = [];
  let balance = plan.startBalance + base.restOfMonth;
  let totalInterest = 0;
  let freed = 0;

  for (let i = 1; i <= horizon; i++) {
    const month = addM(base.month, i);
    const active = (e: PlanEvent) => e.month <= month && (!e.until || month <= e.until);
    const sumOf = (k: PlanEventKind, once: boolean) => plan.events.filter((e) => e.kind === k && (once ? e.month === month : active(e))).reduce((s, e) => s + e.amount, 0);

    const income = base.income + sumOf('income-monthly', false);
    const fixed = base.fixed + sumOf('expense-monthly', false);
    const running = base.installments.filter((p) => month <= p.lastMonth && !(closedBy.has(p.key) && month >= closedBy.get(p.key)!));
    const installments = running.reduce((s, p) => s + p.monthly, 0);
    const variable = plan.dailySpend !== undefined ? plan.dailySpend * daysInMonth(month) : base.variable;

    let oneOff = sumOf('income-once', true) - sumOf('expense-once', true);
    let loanPayments = 0;
    for (const l of loans) {
      const { annualRatePct, months: n, payoffKeys, payoffOther } = l.loan!;
      const pay = loanPayment(l.amount, annualRatePct, n);
      if (month === l.month) {
        // What the loan closes is paid at today's remaining balance, less what
        // will have been paid by then.
        const closes = base.installments.filter((p) => payoffKeys.includes(p.key)).reduce((s, p) => {
          const left = Math.max(0, p.remainingPayments - (i - 1));
          freed += left > 0 ? p.monthly : 0;
          return s + left * p.monthly;
        }, 0);
        oneOff += l.amount - closes - payoffOther;
        totalInterest += pay * n - l.amount;
      }
      const first = addM(l.month, 1);
      if (month >= first && month <= addM(l.month, n)) loanPayments += pay;
    }

    const net = income - fixed - installments - variable - loanPayments + oneOff;
    balance += net;
    rows.push({ month, income, fixed, installments, variable, loanPayments, oneOff, net, balance });
  }

  const min = rows.reduce((a, b) => (b.balance < a.balance ? b : a), rows[0]!);
  return {
    rows,
    endBalance: rows.at(-1)!.balance,
    minBalance: min.balance,
    minMonth: min.month,
    monthsBelowFloor: rows.filter((r) => r.balance < plan.floor).length,
    totalInterest,
    loanPayment: loans.reduce((s, l) => s + loanPayment(l.amount, l.loan!.annualRatePct, l.loan!.months), 0),
    freedMonthly: freed,
    loanOutstanding: loans.reduce((s, l) => {
      const start = (Number(l.month.slice(0, 4)) - Number(base.month.slice(0, 4))) * 12 + Number(l.month.slice(5)) - Number(base.month.slice(5));
      return s + (start > horizon ? 0 : loanBalance(l.amount, l.loan!.annualRatePct, l.loan!.months, horizon - start));
    }, 0),
  };
}

// The most we can spend per day on variable expenses without the balance ever
// dropping below the floor within the horizon. 0 when even nothing is too much.
export function maxDailySpend(base: Baseline, plan: Plan, horizon = 24): number {
  // Borrowed money is not income: what is still owed when the window closes
  // must be covered too, or a long loan would make any spending look safe.
  const ok = (daily: number) => {
    const f = simulate(base, { ...plan, dailySpend: daily }, horizon);
    return f.minBalance >= plan.floor && f.endBalance - f.loanOutstanding >= plan.floor;
  };
  if (!ok(0)) return 0;
  let lo = 0, hi = 5000;
  if (ok(hi)) return hi;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo);
}

export const emptyPlan = (name = 'התוכנית שלנו'): Plan => ({ id: 'default', name, events: [], startBalance: 0, floor: 0 });
