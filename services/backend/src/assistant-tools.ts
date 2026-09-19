import { emptyPlan, loanPayment, maxDailySpend, simulate, type Dashboard, type PlanEvent } from '@hub/core';

// What the assistant can look up. Plain functions over the same dashboard the
// UI renders, so an answer can never disagree with the screen.

const r = (n: number) => Math.round(n);

export function overview(d: Dashboard) {
  const s = d.status;
  return {
    month: s.month,
    day_of_month: s.dayOfMonth,
    days_left: s.daysLeft,
    income: { expected: r(s.income.expected), received: r(s.income.received) },
    fixed_expenses: { total: r(s.fixed.planned), already_charged: r(s.fixed.paid), still_pending: r(s.fixed.pending) },
    variable_expenses: { spent: r(s.flexible.spent), available_for_them: r(s.flexible.planned), left: r(s.flexible.left), left_per_day: r(s.leftPerDay) },
    projected_month_end: r(s.projectedNet),
    tracked_categories: s.envelopes.filter((e) => e.kind === 'tracked').map((e) => ({ category: e.label, budget: r(e.planned), spent: r(e.actual) })),
    everyday_spending_without_category: r(s.flexible.everydaySpent),
    excluded_from_cashflow_by_riseup: s.excluded,
    last_12_months: d.months.map((m) => ({ month: m.month, income: r(m.income), fixed: r(m.fixed), variable: r(m.variable), net: r(m.net) })),
    open_installment_plans: d.installments.map((p) => ({ name: p.businessName, monthly: r(p.monthly), paid: p.paid, of: p.total, remaining: r(p.remainingAmount), ends: p.lastMonth })),
    alerts: d.alerts.map((a) => `${a.title} — ${a.detail}`),
    planner_baseline: { typical_monthly_income: r(d.baseline.income), fixed_without_installments: r(d.baseline.fixed), variable_without_installments: r(d.baseline.variable) },
  };
}

export interface SearchInput {
  text?: string;
  category?: string;
  kind?: 'fixed' | 'variable' | 'income';
  month_from?: string;
  month_to?: string;
  min_amount?: number;
  group_by?: 'month' | 'business' | 'category';
  limit?: number;
}

// Searches every counted transaction the hub holds (excluded transfers and the
// card bill seen from the bank are never included, so sums are safe to quote).
export interface SearchResult {
  matched: number;
  total: number;
  months_covered: string[];
  groups?: Record<string, string | number>[];
  showing?: number;
  transactions?: { date: string; business: string; amount: number; category: string; kind: string }[];
}

export function searchTransactions(d: Dashboard, q: SearchInput): SearchResult {
  const text = q.text?.trim().toLowerCase();
  const rows = d.history.filter((l) =>
    (!text || l.name.toLowerCase().includes(text)) &&
    (!q.category || l.cat === q.category) &&
    (!q.kind || (q.kind === 'income' ? l.inc : !l.inc && l.fixed === (q.kind === 'fixed'))) &&
    (!q.month_from || l.m >= q.month_from) && (!q.month_to || l.m <= q.month_to) &&
    (!q.min_amount || l.a >= q.min_amount));
  const total = rows.reduce((s, l) => s + l.a, 0);
  const base = { matched: rows.length, total: r(total), months_covered: [...new Set(rows.map((l) => l.m))].sort() };
  if (q.group_by) {
    const key = (l: (typeof rows)[number]) => (q.group_by === 'month' ? l.m : q.group_by === 'business' ? l.name : l.cat);
    const groups = new Map<string, { total: number; count: number }>();
    for (const l of rows) { const g = groups.get(key(l)) ?? { total: 0, count: 0 }; g.total += l.a; g.count++; groups.set(key(l), g); }
    const sorted = [...groups.entries()].map(([k, g]) => ({ [q.group_by!]: k, total: r(g.total), count: g.count }));
    sorted.sort((a, b) => (q.group_by === 'month' ? String(a.month).localeCompare(String(b.month)) : (b.total as number) - (a.total as number)));
    return { ...base, groups: sorted.slice(0, 60) };
  }
  const limit = Math.min(q.limit ?? 25, 60);
  return { ...base, showing: Math.min(limit, rows.length), transactions: [...rows].sort((a, b) => b.d.localeCompare(a.d)).slice(0, limit).map((l) => ({ date: l.d, business: l.name, amount: l.a, category: l.cat, kind: l.inc ? 'income' : l.fixed ? 'fixed' : 'variable' })) };
}

export interface ForecastInput {
  start_balance?: number;
  floor?: number;
  horizon_months?: number;
  daily_spend?: number;
  events?: { kind: PlanEvent['kind']; label?: string; month: string; amount: number; until?: string; annual_rate_pct?: number; months?: number; closes_installments?: string[]; also_covers?: number }[];
}

// The same arithmetic as the planner screen.
export function runForecast(d: Dashboard, q: ForecastInput) {
  const events: PlanEvent[] = (q.events ?? []).map((e, i) => ({
    id: String(i), kind: e.kind, label: e.label ?? '', month: e.month, amount: e.amount, until: e.until,
    loan: e.kind === 'loan' ? {
      annualRatePct: e.annual_rate_pct ?? 7, months: e.months ?? 60, payoffOther: e.also_covers ?? 0,
      payoffKeys: d.installments.filter((p) => (e.closes_installments ?? []).some((n) => p.businessName.includes(n))).map((p) => p.key),
    } : undefined,
  }));
  const plan = { ...emptyPlan(), startBalance: q.start_balance ?? 0, floor: q.floor ?? 0, events, dailySpend: q.daily_spend };
  const horizon = Math.min(Math.max(q.horizon_months ?? 24, 3), 60);
  const f = simulate(d.baseline, plan, horizon);
  const base = simulate(d.baseline, { ...plan, events: [], dailySpend: undefined }, horizon);
  return {
    assumptions: { ...overview(d).planner_baseline, start_balance: plan.startBalance, floor: plan.floor, horizon_months: horizon, note: 'RiseUp does not report account balances; start_balance is whatever the family stated, 0 if they did not.' },
    max_safe_daily_variable_spend: maxDailySpend(d.baseline, { ...plan, dailySpend: undefined }, horizon),
    current_daily_variable_spend: r(d.baseline.variable / 30.4),
    lowest_balance: { amount: r(f.minBalance), month: f.minMonth }, end_balance: r(f.endBalance), months_below_floor: f.monthsBelowFloor,
    without_these_events: { lowest_balance: r(base.minBalance), end_balance: r(base.endBalance) },
    loans: events.filter((e) => e.loan).map((e) => ({ label: e.label, monthly_payment: r(loanPayment(e.amount, e.loan!.annualRatePct, e.loan!.months)), closes: e.loan!.payoffKeys.length })),
    total_interest: r(f.totalInterest), monthly_payments_freed: r(f.freedMonthly), loan_still_owed_at_end: r(f.loanOutstanding),
    by_month: f.rows.map((x) => ({ month: x.month, net: r(x.net), balance: r(x.balance) })),
  };
}

export const recommendations = (d: Dashboard) => d.recommendations.map((x) => ({ topic: x.topic, priority: x.priority, title: x.title, why: x.why, steps: x.steps, yearly_saving: x.yearlySaving ? r(x.yearlySaving) : null }));
