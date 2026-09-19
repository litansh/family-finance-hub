import { emptyPlan, EVERYDAY, loanPayment, maxDailySpend, simulate, spendCheck, strategy, type Dashboard, type PlanEvent, type StrategyInputs } from '@hub/core';

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
    tracked_categories: s.envelopes.filter((e) => e.kind === 'tracked').map((e) => ({ category: e.label, budget: r(e.planned), spent: r(e.actual), committed_by_the_family: !!e.committed, budget_in_riseup: e.riseupPlanned === undefined ? undefined : r(e.riseupPlanned) })),
    // Every rubric's target is set aside before anything is called free; a rubric over its target counts at what was spent.
    after_fixed_and_rubrics: { set_aside_for_rubrics: r(d.free.committedTotal), free_for_all_other_variable_spending: r(d.free.freeForRest), spent_on_other_variable: r(d.free.restSpent), left_for_other_variable: r(d.free.restLeft), left_per_day: r(d.free.restLeftPerDay) },
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

// What next month is expected to look like, from the same payload the screen shows.
export function nextMonthView(d: Dashboard) {
  const n = d.nextMonth;
  return {
    month: n.month, averages_taken_from: n.basisMonths,
    expected_income: { total: r(n.income.total), lines: n.income.lines.map((l) => ({ name: l.label, amount: r(l.amount) })) },
    fixed_charges: { total: r(n.fixed.total), largest: n.fixed.lines.slice(0, 12).map((l) => ({ name: l.label, amount: r(l.amount) })), ending_this_month: n.fixed.ending.map((l) => ({ name: l.label, amount: r(l.amount) })) },
    variable_spending: { predicted_total: r(n.variable.total), by_category: n.variable.categories.slice(0, 20).map((c) => ({ category: c.label, predicted: r(c.predicted), budget: c.budget === undefined ? null : r(c.budget), last_months: c.lastMonths.map(r), trend: c.trend })) },
    already_planned_by_the_family: n.planned.map((l) => ({ name: l.label, amount: r(l.amount) })),
    expected_left_at_month_end: r(n.net), left_if_every_tracked_category_keeps_its_budget: r(n.ifOnBudget),
    this_month_is_heading_to: r(n.carriedFromThisMonth),
  };
}

// "Can we afford this, and out of which budget?" Deterministic; the model only
// picks the category and explains the result.
export function checkPurchase(d: Dashboard, q: { amount: number; category?: string }) {
  const c = spendCheck(d.status, q, d.nextMonth.net);
  const tracked = d.status.envelopes.filter((e) => e.kind === 'tracked');
  return {
    amount: r(c.amount),
    charged_to: c.category === EVERYDAY ? 'everyday spending (no tracked category matched)' : c.category,
    verdict: c.verdict,
    month_as_a_whole_is_short: c.monthIsShort,
    that_budget: c.categoryBudget && { budget: r(c.categoryBudget.planned), spent_so_far: r(c.categoryBudget.spent), left_before: r(c.categoryBudget.leftBefore), left_after: r(c.categoryBudget.leftAfter) },
    whole_month: { left_before: r(c.month.leftBefore), left_after: r(c.month.leftAfter), per_day_before: r(c.month.perDayBefore), per_day_after: r(c.month.perDayAfter), days_left: c.month.daysLeft },
    short_by_in_that_budget: r(c.shortfall),
    budgets_with_room_to_give: c.sources.map((s) => ({ category: s.label, can_give: r(s.available) })),
    suggested_shifts: c.suggestedShifts.map((s) => ({ from: s.from, to: s.to === EVERYDAY ? 'everyday' : s.to, amount: r(s.amount) })),
    next_month_expected_left: r(d.nextMonth.net),
    tracked_categories: tracked.map((e) => e.label),
    shifts_already_made_this_month: d.shifts.map((s) => ({ from: s.from, to: s.to, amount: s.amount, reason: s.reason ?? null })),
  };
}

// The path to balance: trend, the cut it takes, and the cheapest way to carry the
// months in between. `saved` is what the family entered on the planning screen;
// anything the model passes overrides it for this one calculation only.
export function pathToBalance(d: Dashboard, saved: Partial<StrategyInputs> | null | undefined, q: Partial<StrategyInputs>) {
  const s = strategy(d.months, d.baseline, { ...(saved ?? {}), ...q }, d.history);
  const t = s.trend;
  return {
    assumptions_used: { ...s.inputs, note: 'Values the family did not state come from the planning screen or from defaults (8% loan over 60 months, 11% overdraft, no overdraft line, balance 0). Say which ones you assumed.' },
    trend: { fitted_on_closed_months: t.months.length, typical_income_now: r(t.incomeNow), typical_expenses_now: r(t.expensesNow), monthly_gap_now: r(t.gapNow), recurring_income_now: r(t.steadyIncomeNow), irregular_income_per_month_on_average: r(t.irregularIncomePerMonth), recurring_income_change_per_month: r(t.incomeSlope), expenses_change_per_month: r(t.expenseSlope), months_until_the_trend_alone_closes_the_gap: t.monthsToBalanceOnTrend },
    // How the shortfall has been covered so far: money RiseUp keeps out of the cashflow (transfers from savings, loans received).
    money_brought_in_from_outside_the_cashflow: d.outside.map((o) => ({ month: o.month, amount: r(o.moneyIn) })),
    cut_needed_to_balance_today: r(s.cutToBalanceToday),
    cut_needed_per_month_to_balance_by_target: r(s.cutNeededByTarget),
    hole_the_plan_digs_before_interest: r(s.bridgeNeeded),
    cheapest_option_that_holds: s.recommended,
    options: s.options.map((o) => ({
      option: o.id, new_loan: r(o.loanPrincipal), monthly_payment: r(o.loanPayment), closes_existing_debt: r(o.paysOff), monthly_payments_freed: r(o.freedMonthly), cash_reaching_the_account: r(o.cashIn),
      stays_within_the_overdraft_line: o.holds, extra_monthly_improvement_needed_to_hold: r(o.missingPerMonth),
      lowest_balance: { amount: r(o.lowest.balance), month: o.lowest.month }, balanced_from: o.breakEvenMonth,
      loan_interest_over_its_life: r(o.loanInterest), overdraft_interest: r(o.overdraftInterest), total_cost: r(o.totalCost), still_owed_at_end_of_horizon: r(o.debtAtEnd),
    })),
    horizon_months: s.horizon,
  };
}
