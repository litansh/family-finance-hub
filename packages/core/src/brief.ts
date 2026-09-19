import type { FreeToSpend, NextMonth } from './budget.ts';
import type { MonthStatus } from './month.ts';
import type { ViewTransaction } from './overlay.ts';

// The daily brief: what happened yesterday, what today allows, and what needs a
// look. Built from the same numbers as the screens, so it can never disagree
// with them. It is shown inside the hub only; the phone notification that
// announces it carries no figures at all.

export type BriefTone = 'good' | 'warn' | 'bad' | 'info';
export interface BriefLine { id: string; tone: BriefTone; title: string; detail?: string }

export interface DailyBrief {
  date: string; // YYYY-MM-DD it was built for
  month: string;
  live: boolean; // the viewed month is the current one
  yesterday: { date: string; spent: number; count: number; biggest: { name: string; amount: number }[] };
  perDayLeft: number;
  lines: BriefLine[];
}

const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const ils = (n: number) => `₪${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

export interface BriefInputs { status: MonthStatus; free: FreeToSpend; transactions: ViewTransaction[]; nextMonth: NextMonth; today: string; hoursSinceSync?: number }

export function dailyBrief(i: BriefInputs): DailyBrief {
  const { status: s, free, today } = i;
  const live = today.slice(0, 7) === s.month;
  const yDate = dayBefore(today);
  const yTx = i.transactions.filter((t) => !t.isIncome && t.transactionDate.slice(0, 10) === yDate);
  const yesterday = { date: yDate, spent: yTx.reduce((a, t) => a + t.amount, 0), count: yTx.length, biggest: [...yTx].sort((a, b) => b.amount - a.amount).slice(0, 3).map((t) => ({ name: t.businessName, amount: t.amount })) };
  const lines: BriefLine[] = [];

  if (i.hoursSinceSync !== undefined && i.hoursSinceSync > 30) lines.push({ id: 'stale', tone: 'warn', title: 'הנתונים לא התעדכנו מאתמול', detail: 'הסנכרון מול רייזאפ לא רץ. המספרים כאן נכונים לעדכון האחרון.' });

  if (live) {
    // Card charges reach RiseUp a day or two late, so "nothing yesterday" is said softly.
    lines.push(yesterday.count
      ? { id: 'yesterday', tone: 'info', title: `אתמול יצאו ${ils(yesterday.spent)} ב־${yesterday.count === 1 ? 'עסקה אחת' : `${yesterday.count} עסקאות`}`, detail: yesterday.biggest.map((b) => `${b.name} ${ils(b.amount)}`).join(' · ') }
      : { id: 'yesterday', tone: 'info', title: 'עדיין לא נרשמו הוצאות מאתמול', detail: 'חיובי אשראי מגיעים לרייזאפ באיחור של יום או יומיים.' });

    const days = s.daysLeft + 1;
    lines.push(free.restLeft >= 0
      ? { id: 'today', tone: 'good', title: `אפשר להוציא היום עד ${ils(free.restLeftPerDay)}`, detail: `נשארו ${ils(free.restLeft)} ל־${days} ימים, אחרי הקבועות והיעדים של הרובריקות.` }
      : { id: 'today', tone: 'bad', title: `החודש כבר בחריגה של ${ils(free.restLeft)}`, detail: `נשארו ${days} ימים. כל הוצאה שאפשר לדחות, כדאי לדחות.` });
  }

  const over = s.envelopes.filter((e) => e.kind === 'tracked' && e.planned > 0 && e.actual > e.planned).sort((a, b) => (b.actual - b.planned) - (a.actual - a.planned));
  if (over.length) lines.push({ id: 'over', tone: 'bad', title: over.length === 1 ? `${over[0]!.label} עברה את היעד` : `${over.length} רובריקות עברו את היעד`, detail: over.slice(0, 4).map((e) => `${e.label} +${ils(e.actual - e.planned)}`).join(' · ') });
  const near = s.envelopes.filter((e) => e.kind === 'tracked' && e.planned > 0 && e.actual <= e.planned && e.usedPct >= 0.85);
  if (near.length) lines.push({ id: 'near', tone: 'warn', title: near.length === 1 ? `${near[0]!.label} קרובה ליעד` : `${near.length} רובריקות קרובות ליעד`, detail: near.slice(0, 4).map((e) => `${e.label}: נשארו ${ils(e.remaining)}`).join(' · ') });

  if (live) {
    const soon = s.envelopes.filter((e) => e.kind === 'fixed' && !e.paid && e.due && daysBetween(today, e.due) >= 0 && daysBetween(today, e.due) <= 3);
    if (soon.length) lines.push({ id: 'due', tone: 'info', title: `${soon.length === 1 ? 'חיוב קבוע אחד צפוי' : `${soon.length} חיובים קבועים צפויים`} בימים הקרובים: ${ils(soon.reduce((a, e) => a + e.planned, 0))}`, detail: soon.slice(0, 4).map((e) => `${e.label} ${ils(e.planned)}`).join(' · ') });
    const waiting = s.envelopes.filter((e) => e.kind === 'income' && !e.paid && e.planned > 0);
    if (waiting.length) lines.push({ id: 'income', tone: 'info', title: `עוד ${ils(waiting.reduce((a, e) => a + e.planned, 0))} הכנסות צפויות החודש` });
    lines.push({ id: 'heading', tone: s.projectedNet >= 0 ? 'good' : 'bad', title: s.projectedNet >= 0 ? `בקצב הזה החודש יסתיים בפלוס של ${ils(s.projectedNet)}` : `בקצב הזה החודש יסתיים במינוס של ${ils(s.projectedNet)}`, detail: `החודש הבא צפוי להסתיים ${i.nextMonth.net >= 0 ? 'בפלוס' : 'במינוס'} של ${ils(i.nextMonth.net)}.` });
  }
  return { date: today, month: s.month, live, yesterday, perDayLeft: free.restLeftPerDay, lines };
}
