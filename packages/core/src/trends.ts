import { cleanCategory } from './month.ts';
import { counts, isFixed, type StoredTransaction } from './overlay.ts';

export interface MonthTotals {
  month: string;
  income: number;
  fixed: number;
  variable: number;
  expenses: number;
  net: number;
  savingsRate: number; // net / income
}

export interface CategoryTrend {
  category: string;
  latest: number;
  average: number; // prior months
  changePct: number;
  series: { month: string; amount: number }[];
}

export function monthlyTotals(txns: StoredTransaction[]): MonthTotals[] {
  const by = new Map<string, MonthTotals>();
  for (const t of txns) {
    if (!counts(t)) continue;
    const m =
      by.get(t.cashflowDate) ??
      { month: t.cashflowDate, income: 0, fixed: 0, variable: 0, expenses: 0, net: 0, savingsRate: 0 };
    if (t.isIncome) m.income += t.amount;
    else {
      m.expenses += t.amount;
      if (isFixed(t)) m.fixed += t.amount;
      else m.variable += t.amount;
    }
    by.set(t.cashflowDate, m);
  }
  return [...by.values()]
    .map((m) => ({ ...m, net: m.income - m.expenses, savingsRate: m.income > 0 ? (m.income - m.expenses) / m.income : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function categoryTrends(txns: StoredTransaction[], latestMonth: string, lookback = 6): CategoryTrend[] {
  const months = [...new Set(txns.map((t) => t.cashflowDate))]
    .filter((m) => m <= latestMonth)
    .sort()
    .slice(-(lookback + 1));
  const table = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (!counts(t) || t.isIncome || !months.includes(t.cashflowDate)) continue;
    const cat = cleanCategory(t.categoryLabel);
    const row = table.get(cat) ?? new Map<string, number>();
    row.set(t.cashflowDate, (row.get(t.cashflowDate) ?? 0) + t.amount);
    table.set(cat, row);
  }
  const prior = months.filter((m) => m !== latestMonth);
  return [...table.entries()]
    .map(([category, row]) => {
      const latest = row.get(latestMonth) ?? 0;
      const average = prior.length ? prior.reduce((s, m) => s + (row.get(m) ?? 0), 0) / prior.length : 0;
      return {
        category,
        latest,
        average,
        changePct: average > 0 ? (latest - average) / average : 0,
        series: months.map((month) => ({ month, amount: row.get(month) ?? 0 })),
      };
    })
    .sort((a, b) => b.latest - a.latest);
}

export function spendByAccount(txns: StoredTransaction[]): { account: string; amount: number; count: number }[] {
  const by = new Map<string, { account: string; amount: number; count: number }>();
  for (const t of txns) {
    if (!counts(t) || t.isIncome) continue;
    const account = t.accountNickname ?? t.source ?? t.accountNumberHash ?? 'Unknown';
    const row = by.get(account) ?? { account, amount: 0, count: 0 };
    row.amount += t.amount;
    row.count += 1;
    by.set(account, row);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

// Cumulative flexible spend per day against a straight-line budget.
export function dailyBurn(txns: StoredTransaction[], month: string, daysInMonth: number, budget: number) {
  const perDay = new Array<number>(daysInMonth).fill(0);
  for (const t of txns) {
    if (!counts(t) || t.isIncome || t.cashflowDate !== month || isFixed(t)) continue;
    // Card charges from the previous calendar month can land in this cashflow
    // month; they count from day one.
    const d = t.transactionDate.slice(0, 7) === month ? Number(t.transactionDate.slice(8, 10)) : 1;
    perDay[Math.min(Math.max(d, 1), daysInMonth) - 1]! += t.amount;
  }
  let run = 0;
  return perDay.map((amount, i) => {
    run += amount;
    return { day: i + 1, spent: amount, cumulative: run, ideal: (budget / daysInMonth) * (i + 1) };
  });
}
