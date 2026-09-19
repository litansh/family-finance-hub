import { freeToSpend, nextMonth, type BudgetShift, type Commitments, type FreeToSpend, type NextMonth } from './budget.ts';
import { deriveBaseline, type Baseline, type Plan } from './forecast.ts';
import { buildAlerts, businessKey, detectRecurring, type Alert, type Recurring } from './insights.ts';
import { actualAmount, cleanCategory, monthStatus, type MonthStatus } from './month.ts';
import { annotateWithBudget, applyOverrides, counts, installmentPlans, isFixed, type InstallmentPlan, type Overrides, type StoredTransaction, type ViewTransaction } from './overlay.ts';
import { buildRecommendations, type Recommendation } from './recommendations.ts';
import type { RiseupBudget } from './riseup.ts';
import { categoryTrends, dailyBurn, monthlyTotals, spendByAccount, type CategoryTrend, type MonthTotals } from './trends.ts';

// A compact line per past transaction, so any item can show its own history
// without shipping every field of every month.
export interface HistoryLine { id: string; k: string; name: string; m: string; d: string; a: number; inc: boolean; cat: string; fixed: boolean }

// The one payload the UI renders. Built by the API from stored RiseUp data, and
// by the dev fixture from generated data — the same function either way.
export interface Dashboard {
  generatedAt: string;
  sync: { lastSyncAt: string | null; tokenExpiresInDays?: number; source: 'riseup' | 'sample' };
  status: MonthStatus;
  alerts: Alert[];
  burn: ReturnType<typeof dailyBurn>;
  months: MonthTotals[];
  categories: CategoryTrend[];
  recurring: Recurring[];
  accounts: ReturnType<typeof spendByAccount>;
  transactions: ViewTransaction[]; // counted in this month's cashflow
  // In RiseUp's feed but kept out of the cashflow by RiseUp itself (transfers,
  // the card bill seen from the bank, one-offs the family excluded). Never summed.
  excluded: ViewTransaction[];
  // Held by the hub although RiseUp no longer returns them. Never summed.
  removed: ViewTransaction[];
  installments: InstallmentPlan[];
  recommendations: Recommendation[];
  baseline: Baseline; // what the planner starts from
  nextMonth: NextMonth; // what the month after the viewed one is expected to look like
  shifts: BudgetShift[]; // budget the family moved between categories this month
  // Money RiseUp keeps out of the cashflow, per month, newest first: transfers in from savings or a
  // loan, the card bill seen from the bank. Money coming in here is how a monthly shortfall gets covered.
  outside: { month: string; moneyIn: number; moneyOut: number }[];
  free: FreeToSpend; // what is left for variable spending once fixed charges and commitments are set aside
  categoryNames: string[];
  history: HistoryLine[];
  previous?: MonthTotals;
  availableMonths: string[];
}

export interface DashboardInputs {
  budget: RiseupBudget;
  // The months before it, newest first. Only used to notice a fixed charge that
  // RiseUp keeps expecting and that never comes.
  previousBudgets?: RiseupBudget[];
  transactions: StoredTransaction[]; // every stored month
  overrides?: Overrides;
  shifts?: BudgetShift[];
  commitments?: Commitments;
  plan?: Plan; // the saved what-if plan, so next month includes what the family already expects
  categoryLabels?: Record<string, string>;
  today: string; // YYYY-MM-DD
  lastSyncAt: string | null;
  tokenExpiresInDays?: number;
  source?: 'riseup' | 'sample';
}

const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function buildDashboard(i: DashboardInputs): Dashboard {
  const month = i.budget.budgetDate;
  const overrides = i.overrides ?? {};
  // The viewed month is stamped from its budget here as well, so data stored
  // before the sync learned to do it still adds up.
  const stamped = i.transactions;
  const thisMonth = annotateWithBudget(stamped.filter((t) => t.cashflowDate === month), i.budget);
  const others = stamped.filter((t) => t.cashflowDate !== month);
  const all = applyOverrides([...others, ...thisMonth], overrides).map((t) => ({ ...t, categoryLabel: cleanCategory(t.categoryLabel) }));

  const upToAll = all.filter((t) => t.cashflowDate <= month);
  const upTo = upToAll.filter(counts);
  const monthAll = upToAll.filter((t) => t.cashflowDate === month);
  const monthTxns = monthAll.filter(counts);
  const history = upTo.filter((t) => t.cashflowDate < month);
  const last = prevMonth(month);

  // Tracked-category id → the label the family sees, learned from every month,
  // so a category with nothing spent yet this month still has its name.
  const labelVotes = new Map<string, Map<string, number>>();
  for (const t of upTo) {
    const cat = t.envelopeType === 'trackingCategory' && !t.sourceCategory ? t.envelopeId?.split('#')[2] : undefined;
    if (!cat || !t.categoryLabel) continue;
    const v = labelVotes.get(cat) ?? new Map<string, number>();
    v.set(t.categoryLabel, (v.get(t.categoryLabel) ?? 0) + 1);
    labelVotes.set(cat, v);
  }
  const learned = Object.fromEntries([...labelVotes].map(([cat, v]) => [cat, [...v].sort((a, b) => b[1] - a[1])[0]![0]]));

  const status = monthStatus(i.budget, i.today, {
    transactions: monthAll,
    overrides,
    shifts: i.shifts,
    commitments: i.commitments,
    categoryLabels: { ...learned, ...i.categoryLabels },
    previousFixed: history.filter((t) => t.cashflowDate >= prevMonth(prevMonth(last)) && !t.isIncome && isFixed(t)).map((t) => ({ businessName: t.businessName, amount: t.amount, day: Number(t.transactionDate.slice(8, 10)) || undefined })),
    previousUnpaid: (i.previousBudgets ?? []).map((b) => b.envelopes.filter((e) => e.type === 'fixed' && e.actuals.length === 0).map((e) => Math.abs(e.balancedAmount || e.originalAmount || 0))),
  });
  const recurring = detectRecurring(upTo, month);
  const totals = monthlyTotals(upTo);
  const installments = installmentPlans(upTo, month);
  const hoursSinceSync = i.lastSyncAt ? (Date.parse(`${i.today}T12:00:00Z`) - Date.parse(i.lastSyncAt)) / 3_600_000 : undefined;
  const baseline = deriveBaseline(totals, status, installments);
  const historyLines: HistoryLine[] = upTo.map((t) => ({ id: t.transactionId, k: t.commitmentId ?? businessKey(t.businessName), name: t.businessName, m: t.cashflowDate, d: t.transactionDate.slice(0, 10), a: t.amount, inc: t.isIncome, cat: t.categoryLabel ?? 'אחר', fixed: isFixed(t) }));
  const byDate = (a: ViewTransaction, b: ViewTransaction) => b.transactionDate.localeCompare(a.transactionDate);

  return {
    generatedAt: new Date().toISOString(),
    sync: { lastSyncAt: i.lastSyncAt, tokenExpiresInDays: i.tokenExpiresInDays, source: i.source ?? 'riseup' },
    status,
    alerts: buildAlerts({ status, monthTxns, history, recurring, tokenExpiresInDays: i.tokenExpiresInDays, hoursSinceSync }),
    burn: dailyBurn(monthTxns, month, status.daysInMonth, Math.max(status.flexible.planned, 0)),
    months: totals.slice(-12),
    categories: categoryTrends(upTo, month),
    recurring,
    accounts: spendByAccount(monthTxns),
    transactions: [...monthTxns].sort(byDate),
    excluded: monthAll.filter((t) => t.excluded && !t.removedFromSourceAt).sort(byDate),
    removed: monthAll.filter((t) => t.removedFromSourceAt).sort(byDate),
    installments,
    recommendations: buildRecommendations({ status, recurring, installments, months: totals, history: upTo }),
    baseline,
    nextMonth: nextMonth({ status, baseline, installments, history: historyLines, plan: i.plan }),
    shifts: (i.shifts ?? []).filter((s) => s.month === month),
    free: freeToSpend(status),
    outside: [i.budget, ...(i.previousBudgets ?? [])].map((b) => ({ month: b.budgetDate, moneyIn: (b.excluded ?? []).filter((a) => a.isIncome).reduce((s, a) => s + actualAmount(a), 0), moneyOut: (b.excluded ?? []).filter((a) => !a.isIncome).reduce((s, a) => s + actualAmount(a), 0) })),
    categoryNames: [...new Set(upTo.filter((t) => !t.isIncome).map((t) => t.categoryLabel ?? 'אחר'))].sort((a, b) => a.localeCompare(b, 'he')),
    history: historyLines,
    previous: totals.filter((m) => m.month < month).at(-1),
    availableMonths: [...new Set(i.transactions.map((t) => t.cashflowDate))].sort().reverse(),
  };
}
