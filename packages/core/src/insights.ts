import type { MonthStatus } from './month.ts';
import { counts, isFixed, type StoredTransaction } from './overlay.ts';

export type Severity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: Severity;
  kind:
    | 'projection-negative'
    | 'envelope-over'
    | 'envelope-near'
    | 'income-missing'
    | 'duplicate-charge'
    | 'large-transaction'
    | 'new-business'
    | 'price-increase'
    | 'token-expiring'
    | 'sync-stale';
  title: string;
  detail: string;
  amount?: number;
  transactionIds?: string[];
}

export interface Recurring {
  key: string;
  businessName: string;
  category?: string;
  monthsSeen: number;
  lastAmount: number;
  typicalAmount: number; // median of prior months
  annualized: number;
  lastMonth: string;
  changePct: number; // last vs typical
  // Earlier months were all close to the typical amount. Only then is a jump a
  // price change; a card bill or an electricity bill moves every month anyway.
  steady: boolean;
  isNew: boolean; // first seen in the latest month
  stopped: boolean; // seen before, missing from the latest month
}

const day = (t: StoredTransaction) => t.transactionDate.slice(0, 10);

// Bank descriptors vary in whitespace, punctuation and trailing branch numbers.
export const businessKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[\d"'.,\-_/\\()*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const daysBetween = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// Same business, same amount, within `windowDays`. Installments legitimately
// repeat, so they are skipped.
export function findDuplicates(txns: StoredTransaction[], windowDays = 3): StoredTransaction[][] {
  const groups = new Map<string, StoredTransaction[]>();
  for (const t of txns) {
    if (!counts(t) || t.isIncome || t.isInstallment) continue;
    const k = `${businessKey(t.businessName)}|${t.amount.toFixed(2)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: StoredTransaction[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => day(a).localeCompare(day(b)));
    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(day(sorted[i - 1]!), day(sorted[i]!)) <= windowDays) {
        out.push([sorted[i - 1]!, sorted[i]!]);
      }
    }
  }
  return out;
}

// A charge is recurring exactly when RiseUp's budget files it under `fixed`.
// Nothing is guessed from repetition: groceries repeat too, and they are variable.
export function detectRecurring(history: StoredTransaction[], latestMonth: string): Recurring[] {
  const byBiz = new Map<string, StoredTransaction[]>();
  for (const t of history) {
    if (!counts(t) || t.isIncome || t.isInstallment) continue;
    const k = t.commitmentId ?? businessKey(t.businessName);
    byBiz.set(k, [...(byBiz.get(k) ?? []), t]);
  }

  const out: Recurring[] = [];
  for (const [key, txns] of byBiz) {
    const perMonth = new Map<string, number>();
    for (const t of txns) perMonth.set(t.cashflowDate, (perMonth.get(t.cashflowDate) ?? 0) + t.amount);
    const months = [...perMonth.keys()].sort();
    const flagged = txns.some(isFixed);

    if (!flagged) continue;

    const lastMonth = months[months.length - 1]!;
    const lastAmount = perMonth.get(lastMonth)!;
    const prior = months.slice(0, -1).map((mo) => perMonth.get(mo)!);
    const typicalAmount = prior.length ? median(prior) : lastAmount;
    const newest = [...txns].sort((a, b) => day(b).localeCompare(day(a)))[0]!;

    out.push({
      key,
      businessName: newest.businessName,
      category: newest.categoryLabel,
      monthsSeen: months.length,
      lastAmount,
      typicalAmount,
      annualized: lastAmount * 12,
      lastMonth,
      changePct: typicalAmount > 0 ? (lastAmount - typicalAmount) / typicalAmount : 0,
      steady: prior.length >= 2 && prior.filter((v) => Math.abs(v - typicalAmount) <= typicalAmount * 0.05).length / prior.length >= 0.75,
      isNew: months.length === 1 && lastMonth === latestMonth,
      stopped: lastMonth < latestMonth,
    });
  }
  return out.sort((a, b) => b.lastAmount - a.lastAmount);
}

export interface AlertInputs {
  status: MonthStatus;
  monthTxns: StoredTransaction[];
  history: StoredTransaction[]; // earlier months, excluding monthTxns
  recurring: Recurring[];
  largeTransactionMin?: number;
  newBusinessMin?: number;
  tokenExpiresInDays?: number;
  hoursSinceSync?: number;
}

export const ils = (n: number) => `${n < 0 ? '−' : ''}₪${Math.abs(Math.round(n)).toLocaleString('en-IL')}`;

// Business and category names are usually Hebrew inside English sentences.
// First-strong isolates keep the sentence order intact in any renderer.
export const iso = (name: string) => `\u2068${name}\u2069`;

const niceDay = (t: StoredTransaction) => `${Number(day(t).slice(8, 10))}.${Number(day(t).slice(5, 7))}`;

export function buildAlerts(i: AlertInputs): Alert[] {
  const { status, monthTxns, history, recurring } = i;
  const largeMin = i.largeTransactionMin ?? 1500;
  const newBizMin = i.newBusinessMin ?? 1000;
  const alerts: Alert[] = [];

  if (status.projectedNet < 0 && status.dayOfMonth > 0 && status.daysLeft > 0) {
    alerts.push({
      id: 'projection',
      severity: 'critical',
      kind: 'projection-negative',
      title: 'בקצב הנוכחי החודש יסתיים במינוס',
      detail: `אם תמשיכו להוציא באותו קצב יומי, החודש ייסגר ב־${ils(status.projectedNet)}.`,
      amount: status.projectedNet,
    });
  }

  for (const e of status.envelopes) {
    if (e.kind !== 'tracked' || e.planned <= 0) continue;
    if (e.usedPct >= 1) {
      alerts.push({
        id: `over-${e.id}`,
        severity: 'critical',
        kind: 'envelope-over',
        title: `חריגה מהתקציב: ${iso(e.label)}`,
        detail: `הוצאתם ${ils(e.actual)} מתוך ${ils(e.planned)} שתוכננו — חריגה של ${ils(e.actual - e.planned)}.`,
        amount: -e.remaining,
      });
    } else if (e.usedPct >= 0.8 && status.daysLeft > 5) {
      alerts.push({
        id: `near-${e.id}`,
        severity: 'warning',
        kind: 'envelope-near',
        title: `${iso(e.label)}: נוצלו ${Math.round(e.usedPct * 100)}% מהתקציב`,
        detail: `נשארו ${ils(e.remaining)} ועוד ${status.daysLeft} ימים עד סוף החודש.`,
        amount: e.remaining,
      });
    }
  }

  const missing = status.income.expected - status.income.received;
  if (missing > 0 && status.daysLeft <= 10 && status.dayOfMonth > 0) {
    alerts.push({
      id: 'income-missing',
      severity: status.daysLeft <= 3 ? 'critical' : 'warning',
      kind: 'income-missing',
      title: 'הכנסה צפויה עדיין לא התקבלה',
      detail: `${ils(missing)} מההכנסה המתוכננת עדיין לא נכנסו לחשבון.`,
      amount: missing,
    });
  }

  for (const [a, b] of findDuplicates(monthTxns)) {
    alerts.push({
      id: `dup-${a!.transactionId}-${b!.transactionId}`,
      severity: 'warning',
      kind: 'duplicate-charge',
      title: `חשד לחיוב כפול: ${iso(a!.businessName)}`,
      detail: `אותו סכום, ${ils(a!.amount)}, חויב ב־${niceDay(a!)} וגם ב־${niceDay(b!)}. כדאי לוודא שזו לא טעות.`,
      amount: a!.amount,
      transactionIds: [a!.transactionId, b!.transactionId],
    });
  }

  const seen = new Map<string, number[]>();
  for (const t of history) {
    if (!counts(t) || t.isIncome) continue;
    const k = businessKey(t.businessName);
    seen.set(k, [...(seen.get(k) ?? []), t.amount]);
  }
  for (const t of monthTxns) {
    if (!counts(t) || t.isIncome || isFixed(t) || t.isInstallment) continue;
    const prior = seen.get(businessKey(t.businessName));
    if (!prior) {
      // Without history every business looks new.
      if (history.length > 0 && t.amount >= newBizMin) {
        alerts.push({
          id: `new-${t.transactionId}`,
          severity: 'info',
          kind: 'new-business',
          title: `חיוב ראשון מבית עסק חדש: ${iso(t.businessName)}`,
          detail: `${ils(t.amount)} בתאריך ${niceDay(t)}. אם אתם לא מזהים — כדאי לבדוק.`,
          amount: t.amount,
          transactionIds: [t.transactionId],
        });
      }
    } else if (t.amount >= largeMin && t.amount > median(prior) * 2.5) {
      alerts.push({
        id: `large-${t.transactionId}`,
        severity: 'warning',
        kind: 'large-transaction',
        title: `חיוב גבוה מהרגיל: ${iso(t.businessName)}`,
        detail: `${ils(t.amount)}, לעומת ${ils(median(prior))} בדרך כלל.`,
        amount: t.amount,
        transactionIds: [t.transactionId],
      });
    }
  }

  for (const r of recurring) {
    if (r.steady && r.lastMonth === status.month && r.monthsSeen >= 3 && r.changePct >= 0.08 && r.lastAmount - r.typicalAmount >= 5) {
      alerts.push({
        id: `price-${r.key}`,
        severity: 'warning',
        kind: 'price-increase',
        title: `${iso(r.businessName)} התייקר ב־${Math.round(r.changePct * 100)}%`,
        detail: `מ־${ils(r.typicalAmount)} ל־${ils(r.lastAmount)} בחודש — תוספת של ${ils((r.lastAmount - r.typicalAmount) * 12)} בשנה.`,
        amount: r.lastAmount - r.typicalAmount,
      });
    }
  }

  if (i.tokenExpiresInDays !== undefined && i.tokenExpiresInDays <= 7) {
    alerts.push({
      id: 'token',
      severity: i.tokenExpiresInDays <= 2 ? 'critical' : 'warning',
      kind: 'token-expiring',
      title: `החיבור לרייזאפ יפוג בעוד ${Math.max(i.tokenExpiresInDays, 0)} ימים`,
      detail: 'צריך ליצור מפתח גישה חדש ברייזאפ ולעדכן אותו, אחרת הנתונים יפסיקו להתעדכן.',
    });
  }
  if (i.hoursSinceSync !== undefined && i.hoursSinceSync > 36) {
    alerts.push({
      id: 'stale',
      severity: 'warning',
      kind: 'sync-stale',
      title: 'הנתונים לא התעדכנו לאחרונה',
      detail: `הסנכרון המוצלח האחרון היה לפני ${Math.round(i.hoursSinceSync)} שעות.`,
    });
  }

  // A long list gets ignored. Keep every critical alert, and the largest few of the rest.
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  const sorted = alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0));
  const keep = (sev: Severity, n: number) => sorted.filter((a) => a.severity === sev).slice(0, n);
  return [...keep('critical', 99), ...keep('warning', 6), ...keep('info', 3)];
}
