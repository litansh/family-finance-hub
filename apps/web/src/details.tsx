import type { EnvelopeStatus, HistoryLine, InstallmentPlan, ViewTransaction } from '@hub/core';
import { useState, type ReactNode } from 'react';
import { Sheet } from './components/ui.tsx';
import type { HubData } from './lib/data.ts';
import { fullDate, money, moneyExact, monthLabel, pct, plural, shortDate } from './lib/format.ts';

// What can be opened. Everything on screen is tappable and lands here.
export type Detail =
  | { kind: 'txn'; t: ViewTransaction }
  | { kind: 'envelope'; e: EnvelopeStatus }
  | { kind: 'business'; key: string; name: string }
  | { kind: 'installment'; p: InstallmentPlan };

// Hebrew names for RiseUp's fields. A field that is not listed is still shown,
// under its original name — nothing RiseUp returns is hidden.
const FIELD: Record<string, string> = {
  transactionId: 'מזהה עסקה', transactionDate: 'תאריך העסקה', billingDate: 'תאריך החיוב', cashflowDate: 'חודש תזרים', businessName: 'שם בית העסק',
  isIncome: 'הכנסה?', amount: 'סכום', accountNickname: 'כינוי החשבון / הכרטיס', accountNumberHash: 'מזהה חשבון (מוצפן)', isInstallment: 'עסקת תשלומים?',
  installmentNumber: 'מספר תשלום', totalNumberOfInstallments: 'סך התשלומים', totalNumberOfPayments: 'סך התשלומים', isPostponed: 'נדחה לחודש הבא?',
  sourceType: 'סוג מקור', source: 'מקור (בנק / חברת אשראי)', commitmentId: 'מזהה התחייבות קבועה', actualType: 'סיווג ברייזאפ', categoryLabel: 'קטגוריה',
  categoryType: 'סוג קטגוריה', excluded: 'מחוץ לתזרים ברייזאפ?', envelopeType: 'סוג מעטפה בתקציב', envelopeId: 'מזהה מעטפה בתקציב', firstSeenAt: 'נקלט אצלנו לראשונה',
  removedFromSourceAt: 'הוסר ברייזאפ בתאריך', previousCategory: 'קטגוריה קודמת ברייזאפ', sourceCategory: 'קטגוריה ברייזאפ', note: 'הערה שלנו',
  originalAmount: 'סכום מקורי (לפני המרה / פריסה)', placement: 'שיוך בתקציב', monthsInterval: 'חוזר כל (חודשים)', transactionBudgetDate: 'חודש התקציב', sequenceId: 'מזהה סדרה',
  expense: 'תווית מערכת ברייזאפ', paymentNumber: 'מספר תשלום', balancedAmount: 'סכום מתוכנן (balancedAmount)', balanceDate: 'תאריך איזון',
};
const VALUE: Record<string, string> = {
  fixed: 'קבוע', variable: 'משתנה', trackingCategory: 'קטגוריה במעקב', variableIncome: 'הכנסה משתנה', riseupGoal: 'יעד חיסכון',
  creditCard: 'כרטיס אשראי', checkingAccount: 'חשבון עו״ש', default: 'קטגוריית מערכת', custom: 'קטגוריה שיצרתם', other: 'לא מסווג',
};

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  if (typeof v === 'number') return /amount/i.test(key) ? moneyExact(v) : String(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fullDate(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)) return monthLabel(v);
  return VALUE[String(v)] ?? String(v);
}

function AllFields({ title, data }: { title: string; data: Record<string, unknown> }) {
  const rows = Object.entries(data).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>) : [[k, v] as [string, unknown]]));
  return (
    <details className="raw">
      <summary>{title} ({rows.length} שדות)</summary>
      <dl className="dl">{rows.map(([k, v], i) => (<div key={`${k}${i}`} style={{ display: 'contents' }}><dt>{FIELD[k] ?? k}</dt><dd>{show(k, v)}</dd></div>))}</dl>
    </details>
  );
}

// Month-by-month history of one business or one category.
function History({ lines, currentMonth, onOpenTxn, d }: { lines: HistoryLine[]; currentMonth: string; onOpenTxn: (id: string) => void; d: HubData }) {
  const [all, setAll] = useState(false);
  if (lines.length === 0) return <p className="explain">אין היסטוריה קודמת.</p>;
  const byMonth = new Map<string, number>();
  for (const l of lines) byMonth.set(l.m, (byMonth.get(l.m) ?? 0) + l.a);
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const max = Math.max(...months.map(([, a]) => a), 1);
  const total = lines.reduce((s, l) => s + l.a, 0);
  const sorted = [...lines].sort((a, b) => b.d.localeCompare(a.d));
  const inMonth = new Set(d.transactions.map((t) => t.transactionId));
  return (
    <>
      <dl className="dl">
        <dt>סך הכול בתקופה</dt><dd><span className="num">{money(total)}</span></dd>
        <dt>מספר חיובים</dt><dd>{lines.length}</dd>
        <dt>ממוצע לחודש פעיל</dt><dd><span className="num">{money(total / byMonth.size)}</span></dd>
        <dt>ממוצע לחיוב</dt><dd><span className="num">{money(total / lines.length)}</span></dd>
      </dl>
      <h3>לפי חודש</h3>
      <div className="mini-bars" role="list">
        {months.map(([m, a]) => (<div className="mb" role="listitem" key={m}><span>{monthLabel(m, 'short')} {m.slice(2, 4)}</span><i style={{ width: `${(a / max) * 100}%`, opacity: m === currentMonth ? 1 : 0.55 }} /><span>{money(a)}</span></div>))}
      </div>
      <h3>כל החיובים</h3>
      <div className="rows">
        {sorted.slice(0, all ? 200 : 8).map((l) => {
          const body = (<><span className="name">{l.name}</span><span className="amt">{moneyExact(l.a)}</span><div className="meta"><span>{shortDate(l.d)} {l.d.slice(0, 4)}</span><span>{l.cat}</span></div></>);
          return inMonth.has(l.id) ? <button type="button" className="row tap" key={l.id} onClick={() => onOpenTxn(l.id)}>{body}</button> : <div className="row" key={l.id}>{body}</div>;
        })}
      </div>
      {sorted.length > 8 && !all && <button className="more" onClick={() => setAll(true)}>הצגת כל {sorted.length} החיובים</button>}
    </>
  );
}

const KIND: Record<EnvelopeStatus['kind'], string> = { income: 'הכנסה', fixed: 'הוצאה קבועה', tracked: 'קטגוריה במעקב (משתנה)', everyday: 'הוצאות שוטפות (משתנה)', goal: 'יעד חיסכון' };
const bkey = (name: string) => name.toLowerCase().replace(/[\d"'.,\-_/\\()*#]+/g, ' ').replace(/\s+/g, ' ').trim();

export function DetailSheet({ detail, d, open, onClose, editor }: { detail: Detail; d: HubData; open: (x: Detail) => void; onClose: () => void; editor: (t: ViewTransaction) => ReactNode }) {
  const openTxnId = (id: string) => { const t = [...d.transactions, ...d.excluded, ...d.removed].find((x) => x.transactionId === id); if (t) open({ kind: 'txn', t }); };
  const month = d.status.month;

  if (detail.kind === 'txn') {
    const t = detail.t;
    const key = t.commitmentId ?? bkey(t.businessName);
    const lines = d.history.filter((l) => l.k === key && l.inc === t.isIncome);
    return (
      <Sheet title={t.businessName} onClose={onClose}>
        <p className="big">{t.isIncome ? '+' : ''}{moneyExact(t.amount)}</p>
        {t.excluded && <p className="banner">רייזאפ מחזיק את העסקה הזו <b>מחוץ לתזרים</b> (למשל העברה בין חשבונות, או חיוב הכרטיס כפי שהוא נראה בבנק). היא מוצגת כאן, אבל לא נספרת באף סיכום.</p>}
        {editor(t)}
        <h3>ההיסטוריה שלכם מול {t.businessName}</h3>
        <History lines={lines} currentMonth={month} onOpenTxn={openTxnId} d={d} />
        <AllFields title="כל הנתונים שרייזאפ מחזיק על העסקה" data={t as unknown as Record<string, unknown>} />
      </Sheet>
    );
  }

  if (detail.kind === 'envelope') {
    const e = detail.e;
    const lines = e.kind === 'tracked' ? d.history.filter((l) => !l.inc && !l.fixed && l.cat === e.label)
      : e.kind === 'everyday' ? d.history.filter((l) => !l.inc && !l.fixed && l.cat === 'אחר')
      : e.items[0] ? d.history.filter((l) => l.k === (d.transactions.find((t) => t.transactionId === e.items[0]!.transactionId)?.commitmentId ?? bkey(e.items[0]!.businessName)) && l.inc === e.isIncome)
      : e.guessed ? d.history.filter((l) => l.name === e.label) : [];
    return (
      <Sheet title={e.label} onClose={onClose}>
        <dl className="dl">
          <dt>סוג</dt><dd>{KIND[e.kind]}</dd>
          {e.kind !== 'everyday' && <><dt>{e.kind === 'tracked' ? 'התקציב שהוגדר' : 'הסכום הצפוי'}</dt><dd><span className="num">{moneyExact(e.planned)}</span>{e.customPlan ? ' (הגדרתם בעצמכם ברייזאפ)' : e.kind === 'tracked' ? ' (חושב על ידי רייזאפ)' : ''}</dd></>}
          <dt>{e.isIncome ? 'התקבל בפועל' : 'יצא בפועל'}</dt><dd><span className="num">{moneyExact(e.actual)}</span></dd>
          {e.kind === 'tracked' && <><dt>{e.remaining >= 0 ? 'נשאר' : 'חריגה'}</dt><dd><span className="num">{moneyExact(Math.abs(e.remaining))}</span> ({pct(Math.min(e.usedPct, 9.99))} נוצלו)</dd></>}
          {(e.kind === 'fixed' || e.kind === 'income') && <><dt>מצב</dt><dd>{e.paid ? (e.isIncome ? 'התקבל החודש' : 'שולם החודש') : 'עדיין לא הגיע החודש'}</dd></>}
          {e.guessed && <><dt>שימו לב</dt><dd>רייזאפ לא מוסר שם לחיוב שעוד לא ירד. השם זוהה לפי חיוב בסכום זהה בחודש שעבר.</dd></>}
          <dt>מספר עסקאות החודש</dt><dd>{e.items.length}</dd>
        </dl>
        {e.kind === 'everyday' && <p className="explain">להוצאות השוטפות אין תקציב ברייזאפ. מה ש"מותר" כאן הוא מה שנשאר מההכנסה אחרי הקבועות והקטגוריות במעקב: <b className="num">{money(e.planned)}</b>.</p>}
        {e.weeks && (
          <>
            <h3>חלוקה שבועית (כך רייזאפ מנהל את הקטגוריה)</h3>
            <div className="table-wrap"><table className="data"><thead><tr><th scope="col">שבוע עד</th><th scope="col" className="n">תקציב</th><th scope="col" className="n">הוצאה</th></tr></thead>
              <tbody>{e.weeks.map((w) => <tr key={w.index}><th scope="row">{w.until ? shortDate(w.until) : w.index + 1}</th><td className="n">{money(w.planned)}</td><td className="n">{money(w.actual)}</td></tr>)}</tbody></table></div>
          </>
        )}
        {e.items.length > 0 && (
          <>
            <h3>{plural(e.items.length, 'עסקה אחת החודש', 'עסקאות החודש')}</h3>
            <div className="rows">
              {[...e.items].sort((a, b) => b.date.localeCompare(a.date)).map((it) => (
                <button type="button" className="row tap" key={it.transactionId} onClick={() => openTxnId(it.transactionId)}>
                  <span className="name">{it.businessName}</span><span className="amt">{moneyExact(it.amount)}</span><div className="meta"><span>{shortDate(it.date)}</span></div>
                </button>
              ))}
            </div>
          </>
        )}
        <h3>היסטוריה</h3>
        <History lines={lines} currentMonth={month} onOpenTxn={openTxnId} d={d} />
        <AllFields title="הנתונים הגולמיים מרייזאפ על המעטפה" data={{ envelopeId: e.raw.ids.join(' , '), envelopeType: e.type, balancedAmount: e.raw.balancedAmount.map((v) => (v === null ? 'null' : v)).join(' , '), originalAmount: e.raw.originalAmount.map((v) => v ?? 'null').join(' , '), balanceDate: e.raw.balanceDate.map((v) => (v ?? '').slice(0, 10)).join(' , ') }} />
      </Sheet>
    );
  }

  if (detail.kind === 'business') {
    const lines = d.history.filter((l) => l.k === detail.key && !l.inc);
    const r = d.recurring.find((x) => x.key === detail.key);
    return (
      <Sheet title={detail.name} onClose={onClose}>
        {r && (
          <dl className="dl">
            <dt>חיוב אחרון</dt><dd><span className="num">{moneyExact(r.lastAmount)}</span> · {monthLabel(r.lastMonth)}</dd>
            <dt>סכום רגיל (חציון)</dt><dd><span className="num">{moneyExact(r.typicalAmount)}</span></dd>
            <dt>עלות שנתית בקצב הזה</dt><dd><span className="num">{money(r.annualized)}</span></dd>
            <dt>מספר חודשים שזוהה</dt><dd>{r.monthsSeen}</dd>
            {r.category && <><dt>קטגוריה</dt><dd>{r.category}</dd></>}
          </dl>
        )}
        <History lines={lines} currentMonth={month} onOpenTxn={openTxnId} d={d} />
      </Sheet>
    );
  }

  const p = detail.p;
  const lines = d.history.filter((l) => l.name === p.businessName && Math.abs(l.a - p.monthly) < 0.01);
  return (
    <Sheet title={p.businessName} onClose={onClose}>
      <dl className="dl">
        <dt>תשלום חודשי</dt><dd><span className="num">{moneyExact(p.monthly)}</span></dd>
        <dt>שולמו</dt><dd>{p.paid} מתוך {p.total} תשלומים</dd>
        <dt>מחיר העסקה כולה</dt><dd><span className="num">{money(p.monthly * p.total)}</span></dd>
        <dt>נותר לשלם</dt><dd><span className="num">{money(p.remainingAmount)}</span> ({p.remainingPayments} תשלומים)</dd>
        <dt>התשלום האחרון</dt><dd>{monthLabel(p.lastMonth)}</dd>
      </dl>
      <History lines={lines} currentMonth={month} onOpenTxn={openTxnId} d={d} />
    </Sheet>
  );
}
