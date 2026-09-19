import { deriveBaseline, type Baseline } from './forecast.ts';
import { buildAlerts, businessKey, detectRecurring, type Alert, type Recurring } from './insights.ts';
import { cleanCategory, monthStatus, type MonthStatus } from './month.ts';
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
  categoryNames: string[];
  history: HistoryLine[];
  previous?: MonthTotals;
  availableMonths: string[];
}

export interface DashboardInputs {
  budget: RiseupBudget;
  transactions: StoredTransaction[]; // every stored month
  overrides?: Overrides;
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
    categoryLabels: { ...learned, ...i.categoryLabels },
    previousFixed: history.filter((t) => t.cashflowDate === last && !t.isIncome && isFixed(t)).map((t) => ({ businessName: t.businessName, amount: t.amount })),
  });
  const recurring = detectRecurring(upTo, month);
  const totals = monthlyTotals(upTo);
  const installments = installmentPlans(upTo, month);
  const hoursSinceSync = i.lastSyncAt ? (Date.parse(`${i.today}T12:00:00Z`) - Date.parse(i.lastSyncAt)) / 3_600_000 : undefined;
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
    baseline: deriveBaseline(totals, status, installments),
    categoryNames: [...new Set(upTo.filter((t) => !t.isIncome).map((t) => t.categoryLabel ?? 'אחר'))].sort((a, b) => a.localeCompare(b, 'he')),
    history: upTo.map((t) => ({ id: t.transactionId, k: t.commitmentId ?? businessKey(t.businessName), name: t.businessName, m: t.cashflowDate, d: t.transactionDate.slice(0, 10), a: t.amount, inc: t.isIncome, cat: t.categoryLabel ?? 'אחר', fixed: isFixed(t) })),
    previous: totals.filter((m) => m.month < month).at(-1),
    availableMonths: [...new Set(i.transactions.map((t) => t.cashflowDate))].sort().reverse(),
  };
}
