import type { Baseline, Plan } from './forecast.ts';
import type { EnvelopeStatus, MonthStatus } from './month.ts';
import type { InstallmentPlan } from './overlay.ts';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// ---- Budget shifts -----------------------------------------------------------
// RiseUp's API is read-only, so moving money between this month's budgets
// happens here, on top of RiseUp's plan. A shift is a line in a log: nothing is
// edited or removed, and undoing one is another line in the other direction.

export const EVERYDAY = 'everyday'; // the money left after fixed charges and tracked categories

export interface BudgetShift {
  id: string;
  month: string; // YYYY-MM
  from: string; // tracked category label, or EVERYDAY
  to: string;
  amount: number; // ILS, positive
  reason?: string;
  by: string;
  at: string;
}

// Net change per category label for one month. EVERYDAY needs no entry: its
// budget is whatever the tracked categories leave, so it follows by itself.
export function shiftTotals(shifts: BudgetShift[], month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shifts) {
    if (s.month !== month || !(s.amount > 0)) continue;
    if (s.from !== EVERYDAY) out.set(s.from, (out.get(s.from) ?? 0) - s.amount);
    if (s.to !== EVERYDAY) out.set(s.to, (out.get(s.to) ?? 0) + s.amount);
  }
  return out;
}

// ---- Commitments -----------------------------------------------------------------
// Some variable categories are fixed in all but name: groceries, the pharmacy.
// The family names a monthly amount for one and commits to it. From then on it
// is that category's budget in the hub, and it is set aside before anything is
// called free. RiseUp's own budget for the category is kept next to it.

export type Commitments = Record<string, number>; // tracked category label → ILS per month

export interface FreeToSpend {
  income: number;
  fixed: number;
  goals: number;
  committed: { label: string; amount: number; spent: number; counted: number; riseupBudget?: number }[];
  committedTotal: number; // what is set aside for them: the commitment, or what was spent when that is more
  freeForRest: number; // income − fixed − goals − committed: all other variable spending lives here
  restSpent: number; // variable spending outside the committed categories
  restLeft: number;
  restLeftPerDay: number;
}

export function freeToSpend(status: MonthStatus): FreeToSpend {
  const committed = status.envelopes.filter((e) => e.kind === 'tracked' && e.committed).map((e) => ({ label: e.label, amount: e.planned, spent: e.actual, counted: Math.max(e.planned, e.actual), riseupBudget: e.riseupPlanned }));
  const committedTotal = sum(committed.map((c) => c.counted));
  const income = status.income.expected, fixed = status.fixed.planned, goals = status.goals.planned;
  const freeForRest = income - fixed - goals - committedTotal;
  const restSpent = status.flexible.spent - sum(committed.map((c) => c.spent));
  const restLeft = freeForRest - restSpent;
  const days = Math.max(status.daysLeft + (status.dayOfMonth > 0 && status.daysLeft >= 0 && status.dayOfMonth <= status.daysInMonth ? 1 : 0), 1);
  return { income, fixed, goals, committed, committedTotal, freeForRest, restSpent, restLeft, restLeftPerDay: restLeft / days };
}

// ---- Next month ----------------------------------------------------------------

export interface NextMonthLine { label: string; amount: number; note?: string }

export interface NextMonthCategory {
  label: string;
  predicted: number; // average of the last closed months
  budget?: number; // RiseUp's tracked budget, when there is one
  lastMonths: number[]; // oldest first
  trend: 'up' | 'down' | 'flat';
}

export interface NextMonth {
  month: string;
  basisMonths: string[]; // the closed months the averages come from
  income: { total: number; lines: NextMonthLine[] };
  fixed: { total: number; lines: NextMonthLine[]; ending: NextMonthLine[] };
  variable: { total: number; categories: NextMonthCategory[] };
  planned: NextMonthLine[]; // one-off and monthly events from the saved what-if plan; signed
  net: number; // what the month is expected to leave
  ifOnBudget: number; // the same, if every tracked category kept to its budget
  carriedFromThisMonth: number; // where the current month is heading, for context
}

interface HistoryRow { name: string; m: string; a: number; inc: boolean; cat: string; fixed: boolean }

export interface NextMonthInputs {
  status: MonthStatus;
  baseline: Baseline;
  installments: InstallmentPlan[];
  history: HistoryRow[];
  plan?: Plan;
}

export const addMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function nextMonth(i: NextMonthInputs): NextMonth {
  const { status, baseline, installments, history } = i;
  const month = addMonth(status.month, 1);

  // Income: what RiseUp expects every month, plus the usual variable income.
  const fixedIncome = status.envelopes.filter((e) => e.kind === 'income' && e.type === 'fixed');
  const incomeLines: NextMonthLine[] = fixedIncome.map((e) => ({ label: e.label, amount: Math.max(e.planned, e.actual) }));
  const steady = sum(incomeLines.map((l) => l.amount));
  // The baseline is a median of whole months, so whatever it holds beyond the
  // steady lines is the family's usual variable income.
  const extra = Math.max(baseline.income - steady, 0);
  if (extra > 1) incomeLines.push({ label: 'הכנסות משתנות (לפי החודשים האחרונים)', amount: extra });

  // Fixed charges repeat, except installment plans whose last payment is this month.
  const endingKeys = new Set(installments.filter((p) => p.fixed && p.lastMonth <= status.month).map((p) => p.businessName));
  const charges = status.envelopes.filter((e) => e.kind === 'fixed');
  const fixedLines: NextMonthLine[] = [];
  const ending: NextMonthLine[] = [];
  for (const e of charges) {
    const amount = e.paid ? e.actual : e.planned;
    if (amount <= 0) continue;
    (endingKeys.has(e.label) ? ending : fixedLines).push({ label: e.label, amount, note: e.guessed ? 'שם משוער' : undefined });
  }
  fixedLines.sort((a, b) => b.amount - a.amount);

  // Variable spending, per category, from the last three closed months.
  const closed = [...new Set(history.filter((h) => h.m < status.month).map((h) => h.m))].sort().slice(-3);
  const budgets = new Map(status.envelopes.filter((e) => e.kind === 'tracked').map((e) => [e.label, e.planned]));
  const perCat = new Map<string, number[]>();
  for (const h of history) {
    if (h.inc || h.fixed) continue;
    const at = closed.indexOf(h.m);
    if (at < 0) continue;
    const row = perCat.get(h.cat) ?? closed.map(() => 0);
    row[at]! += h.a;
    perCat.set(h.cat, row);
  }
  // Installments that end this month stop weighing on their category.
  const endingVariable = sum(installments.filter((p) => !p.fixed && p.lastMonth <= status.month).map((p) => p.monthly));
  const categories: NextMonthCategory[] = [...perCat.entries()].map(([label, row]) => {
    const predicted = closed.length ? sum(row) / closed.length : 0;
    const first = row[0] ?? 0, last = row.at(-1) ?? 0;
    const trend: NextMonthCategory['trend'] = row.length < 2 || Math.abs(last - first) <= Math.max(50, predicted * 0.15) ? 'flat' : last > first ? 'up' : 'down';
    return { label, predicted, budget: budgets.get(label), lastMonths: row, trend };
  }).filter((c) => c.predicted >= 1).sort((a, b) => b.predicted - a.predicted);
  const variableTotal = Math.max(sum(categories.map((c) => c.predicted)) - endingVariable, 0);

  // What the family already told the planner about next month.
  const planned: NextMonthLine[] = [];
  for (const e of i.plan?.events ?? []) {
    const monthly = e.kind === 'income-monthly' || e.kind === 'expense-monthly';
    const active = monthly ? e.month <= month && (!e.until || e.until >= month) : e.month === month;
    if (!active || e.kind === 'loan') continue;
    planned.push({ label: e.label || (e.kind.startsWith('income') ? 'הכנסה מתוכננת' : 'הוצאה מתוכננת'), amount: e.kind.startsWith('income') ? e.amount : -e.amount });
  }

  const incomeTotal = sum(incomeLines.map((l) => l.amount));
  const fixedTotal = sum(fixedLines.map((l) => l.amount));
  const plannedTotal = sum(planned.map((l) => l.amount));
  const onBudget = sum(categories.map((c) => (c.budget !== undefined && c.budget > 0 ? Math.min(c.predicted, c.budget) : c.predicted)));
  return {
    month, basisMonths: closed,
    income: { total: incomeTotal, lines: incomeLines },
    fixed: { total: fixedTotal, lines: fixedLines, ending },
    variable: { total: variableTotal, categories },
    planned,
    net: incomeTotal - fixedTotal - variableTotal + plannedTotal,
    ifOnBudget: incomeTotal - fixedTotal - Math.max(onBudget - endingVariable, 0) + plannedTotal,
    carriedFromThisMonth: status.projectedNet,
  };
}

// ---- "Can I spend this?" -------------------------------------------------------

// Judged against the budget it belongs to first, the way the family thinks
// about it. Whether the month as a whole is short is reported next to it, not
// folded in: a household that runs a monthly deficit would otherwise be told
// "no" to everything, which helps nobody decide anything.
export type SpendVerdict =
  | 'fits' // inside the budget it belongs to
  | 'fits-with-shift' // that budget is short, but categories that are under budget can cover it
  | 'over-budget'; // no budget has room for it: only if it is really needed

export interface SpendSource { label: string; available: number }

export interface SpendCheck {
  amount: number;
  category: string; // tracked category label, or EVERYDAY
  verdict: SpendVerdict;
  monthIsShort: boolean; // the month as a whole is, or would become, negative
  categoryBudget?: { planned: number; spent: number; leftBefore: number; leftAfter: number };
  month: { leftBefore: number; leftAfter: number; perDayBefore: number; perDayAfter: number; daysLeft: number };
  shortfall: number; // what the category lacks for this purchase
  sources: SpendSource[]; // tracked categories with room to give, largest first
  suggestedShifts: { from: string; to: string; amount: number }[];
  nextMonthNet?: number; // so "wait until next month" can be weighed honestly
}

// Room a category can give without itself running short: what is left, scaled
// by how much of the month is still ahead (money left on day 28 is really free;
// money left on day 3 is mostly already spoken for).
function spare(e: EnvelopeStatus, s: MonthStatus): number {
  if (e.remaining <= 0) return 0;
  const elapsed = s.daysInMonth > 0 ? s.dayOfMonth / s.daysInMonth : 1;
  const expectedSpendAhead = elapsed > 0 ? (e.actual / Math.max(elapsed, 0.05)) * (1 - elapsed) : e.planned;
  return Math.max(Math.floor(e.remaining - expectedSpendAhead), 0);
}

export function spendCheck(status: MonthStatus, q: { amount: number; category?: string }, nextMonthNet?: number): SpendCheck {
  const amount = Math.max(q.amount, 0);
  const tracked = status.envelopes.filter((e) => e.kind === 'tracked');
  const target = q.category ? tracked.find((e) => e.label === q.category) : undefined;
  const category = target?.label ?? EVERYDAY;
  const everyday = status.envelopes.find((e) => e.kind === 'everyday');
  const home = target ?? everyday;

  const days = Math.max(status.daysLeft + 1, 1);
  const leftBefore = status.flexible.left;
  const leftAfter = leftBefore - amount;
  const month = { leftBefore, leftAfter, perDayBefore: leftBefore / days, perDayAfter: leftAfter / days, daysLeft: status.daysLeft };

  const categoryBudget = home ? { planned: home.planned, spent: home.actual, leftBefore: home.remaining, leftAfter: home.remaining - amount } : undefined;
  const shortfall = categoryBudget ? Math.max(-categoryBudget.leftAfter, 0) : amount;

  const sources = tracked.filter((e) => e.label !== category).map((e) => ({ label: e.label, available: spare(e, status) })).filter((s) => s.available >= 1).sort((a, b) => b.available - a.available);
  const suggestedShifts: SpendCheck['suggestedShifts'] = [];
  let need = shortfall;
  for (const s of sources) {
    if (need < 1) break;
    const take = Math.min(s.available, Math.ceil(need));
    suggestedShifts.push({ from: s.label, to: category, amount: take });
    need -= take;
  }
  const covered = need < 1;

  const verdict: SpendVerdict = shortfall < 1 ? 'fits' : covered ? 'fits-with-shift' : 'over-budget';
  return { amount, category, verdict, monthIsShort: leftAfter < 0, categoryBudget, month, shortfall, sources, suggestedShifts, nextMonthNet };
}
