import { emptyPlan, loanPayment, maxDailySpend, simulate, type Plan, type PlanEvent, type PlanEventKind } from '@hub/core';
import { useMemo, useState } from 'react';
import { baseOption, categoryAxis, Chart, valueAxis } from './components/Chart.tsx';
import { Section, Tile } from './components/ui.tsx';
import type { HubData } from './lib/data.ts';
import { compact, money, monthLabel, signedMoney } from './lib/format.ts';

const KIND_LABEL: Record<PlanEventKind, string> = {
  'income-once': 'הכנסה חד־פעמית (בונוס, מענק, החזר מס)',
  'income-monthly': 'הכנסה חודשית נוספת (העלאה בשכר, עבודה חדשה)',
  'expense-once': 'הוצאה חד־פעמית (חופשה, רכב, שיפוץ)',
  'expense-monthly': 'הוצאה חודשית נוספת (שכר דירה, גן, מנוי)',
  loan: 'הלוואה חדשה',
};
const SHORT: Record<PlanEventKind, string> = { 'income-once': 'הכנסה חד־פעמית', 'income-monthly': 'הכנסה חודשית', 'expense-once': 'הוצאה חד־פעמית', 'expense-monthly': 'הוצאה חודשית', loan: 'הלוואה' };

const addM = (month: string, n: number) => { const [y, m] = month.split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const num = (v: string) => { const n = Number(v.replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

export function Planner({ d, theme, onSave }: { d: HubData; theme: string; onSave: (plans: Plan[]) => void }) {
  const base = d.baseline;
  const [plan, setPlan] = useState<Plan>(() => d.user.plans?.plans?.[0] ?? emptyPlan());
  const [horizon, setHorizon] = useState(24);
  const [adding, setAdding] = useState<PlanEventKind>();
  const update = (p: Plan) => { setPlan(p); onSave([p]); };

  const months = useMemo(() => Array.from({ length: 36 }, (_, i) => addM(base.month, i + 1)), [base.month]);
  const before = useMemo(() => simulate(base, { ...plan, events: [], dailySpend: undefined }, horizon), [base, plan.startBalance, horizon]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => simulate(base, plan, horizon), [base, plan, horizon]);
  const safeDaily = useMemo(() => maxDailySpend(base, { ...plan, dailySpend: undefined }, horizon), [base, plan, horizon]);
  const todayDaily = base.variable / 30.4;
  const hasEvents = plan.events.length > 0;

  const verdict = (() => {
    if (!hasEvents) return after.minBalance < plan.floor
      ? `בלי שום שינוי, היתרה תרד מתחת לרצפה שקבעתם ב${monthLabel(after.minMonth)} (${money(after.minBalance)}). אפשר לנסות כאן צעדים שונים ולראות מה משנה את התמונה.`
      : `בלי שום שינוי, היתרה נשארת מעל הרצפה בכל התקופה. הנקודה הנמוכה ביותר: ${money(after.minBalance)} ב${monthLabel(after.minMonth)}.`;
    const parts: string[] = [];
    const dMin = after.minBalance - before.minBalance, dEnd = after.endBalance - before.endBalance;
    parts.push(`עם התוכנית, הנקודה הנמוכה ביותר ${dMin >= 0 ? 'משתפרת' : 'מחמירה'} ב־${money(Math.abs(dMin))} (${money(after.minBalance)} ב${monthLabel(after.minMonth)}), והיתרה בסוף התקופה ${dEnd >= 0 ? 'גבוהה' : 'נמוכה'} ב־${money(Math.abs(dEnd))}.`);
    if (after.loanPayment > 0) {
      const delta = after.loanPayment - after.freedMonthly;
      parts.push(`ההלוואה מוסיפה החזר של ${money(after.loanPayment)} בחודש${after.freedMonthly > 0 ? ` ומבטלת תשלומים של ${money(after.freedMonthly)}, כלומר ${delta > 0 ? `תוספת נטו של ${money(delta)}` : `הקלה נטו של ${money(-delta)}`} בחודש` : ''}, ועולה ${money(after.totalInterest)} ריבית לאורך כל חייה.`);
      if (after.freedMonthly > 0 && delta > 0) parts.push('שימו לב: ההחזר החדש גבוה מהתשלומים שהוא מחליף. איחוד כזה משתלם רק אם הריבית החדשה נמוכה מהריבית של ההלוואות שנסגרות.');
    }
    if (after.loanOutstanding > 0) parts.push(`בסוף התקופה עדיין נשארים ${money(after.loanOutstanding)} לפירעון על ההלוואה; הסכום ״אפשר להוציא ביום״ כבר מביא את זה בחשבון.`);
    parts.push(after.monthsBelowFloor === 0 ? 'היתרה לא יורדת מתחת לרצפה באף חודש. ✓' : `היתרה יורדת מתחת לרצפה ב־${after.monthsBelowFloor} חודשים — התוכנית עדיין לא מחזיקה.`);
    return parts.join(' ');
  })();

  return (
    <Section title="מה אם? תכנון ותחזית" term="planner" note="כאן מוסיפים הנחות על העתיד — בונוס, העלאה, הכנסה חדשה, הלוואה — ורואים מה קורה ליתרה חודש אחרי חודש, וכמה אפשר להוציא ביום. ההנחות משותפות לשניכם ונשמרות.">
      <div className="tiles">
        <Tile caption="אפשר להוציא ביום" term="safeDaily" value={<span className={`delta ${safeDaily >= todayDaily ? 'good' : 'bad'}`}>{money(safeDaily)}</span>}
          sub={<>היום אתם מוציאים בערך <span className="num">{money(todayDaily)}</span> ביום</>} explain="הסכום היומי הגבוה ביותר להוצאות משתנות, שבו היתרה לא יורדת מתחת לרצפה באף חודש בתקופה." />
        <Tile caption="הנקודה הנמוכה ביותר" value={<span className={`delta ${after.minBalance >= plan.floor ? 'good' : 'bad'}`}>{signedMoney(after.minBalance)}</span>} sub={monthLabel(after.minMonth)} />
        <Tile caption={`היתרה בעוד ${horizon} חודשים`} value={signedMoney(after.endBalance)} sub={hasEvents ? <>בלי התוכנית: <span className="num">{signedMoney(before.endBalance)}</span></> : 'בקצב הנוכחי'} />
        <Tile caption="ריבית על ההלוואות בתוכנית" value={money(after.totalInterest)} sub={after.loanPayment > 0 ? <>החזר חודשי <span className="num">{money(after.loanPayment)}</span></> : 'אין הלוואה בתוכנית'} />
      </div>

      <p className="banner" role="status" style={{ marginTop: '0.75rem' }}>{verdict}</p>

      <h3 className="group-title" style={{ marginTop: '1rem' }}>נקודת המוצא</h3>
      <div className="cols">
        <div className="field"><label htmlFor="bal">כמה יש בחשבון היום (₪)</label><span className="hint">רייזאפ לא מוסר יתרות, אז מזינים ידנית. מינוס מסמנים עם −.</span>
          <input id="bal" inputMode="numeric" defaultValue={plan.startBalance || ''} placeholder="0" onBlur={(e) => update({ ...plan, startBalance: num(e.target.value) })} /></div>
        <div className="field"><label htmlFor="floor">הרצפה: היתרה הנמוכה ביותר שמקובלת עליכם (₪)</label><span className="hint">0 = לעולם לא במינוס. אם יש מסגרת אשראי שאתם מוכנים לנצל, למשל ‎−10000.</span>
          <input id="floor" inputMode="numeric" defaultValue={plan.floor || ''} placeholder="0" onBlur={(e) => update({ ...plan, floor: num(e.target.value) })} /></div>
      </div>
      <p className="explain">ההנחות שלנו, מתוך הנתונים שלכם: הכנסה חודשית טיפוסית <b className="num">{money(base.income)}</b> (חציון {base.basis.incomeMonths} חודשים), הוצאות קבועות <b className="num">{money(base.fixed)}</b>, הוצאות משתנות <b className="num">{money(base.variable)}</b> (ממוצע {base.basis.variableMonths} חודשים), ועוד {base.installments.length} עסקאות תשלומים שכל אחת מהן יורדת מהחישוב בחודש שבו היא מסתיימת.</p>

      <h3 className="group-title" style={{ marginTop: '1rem' }}>ההנחות שלכם על העתיד</h3>
      {plan.events.length === 0 && <div className="empty">עדיין לא הוספתם הנחות. למשל: "בונוס בינואר", "העלאה בשכר מדצמבר", "חזרה לעבודה במרץ", "הלוואה של 100,000 ₪ לסגירת ההלוואות הקיימות".</div>}
      <div className="rows">
        {plan.events.map((e) => (
          <div className="row" key={e.id}>
            <span className="name">{e.label || SHORT[e.kind]}</span>
            <span className={`amt ${e.kind.startsWith('income') ? 'in' : ''}`}>{money(e.amount)}</span>
            <div className="meta">
              <span>{SHORT[e.kind]}</span><span>{e.kind.endsWith('monthly') ? `מ${monthLabel(e.month)}${e.until ? ` עד ${monthLabel(e.until)}` : ' והלאה'}` : monthLabel(e.month)}</span>
              {e.loan && <span>{e.loan.months} חודשים · {e.loan.annualRatePct}% · החזר <span className="num">{money(loanPayment(e.amount, e.loan.annualRatePct, e.loan.months))}</span></span>}
              <button className="link-btn" onClick={() => update({ ...plan, events: plan.events.filter((x) => x.id !== e.id) })}>הסרה</button>
            </div>
          </div>
        ))}
      </div>

      {adding ? <EventForm kind={adding} months={months} d={d} onCancel={() => setAdding(undefined)} onAdd={(e) => { update({ ...plan, events: [...plan.events, e] }); setAdding(undefined); }} /> : (
        <div className="field" style={{ marginTop: '0.75rem' }}>
          <label htmlFor="add">הוספת הנחה</label>
          <select id="add" value="" onChange={(e) => e.target.value && setAdding(e.target.value as PlanEventKind)}>
            <option value="">בחרו מה להוסיף…</option>
            {(Object.keys(KIND_LABEL) as PlanEventKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
      )}

      <h3 className="group-title" style={{ marginTop: '1rem' }}>היתרה הצפויה, חודש אחרי חודש</h3>
      <div className="chips" role="group" aria-label="אורך התחזית">
        {[12, 24, 36].map((h) => <button key={h} className="chip" aria-pressed={horizon === h} onClick={() => setHorizon(h)}>{h} חודשים</button>)}
      </div>
      <div className="legend" style={{ marginTop: '0.5rem' }}>
        <span><i style={{ background: 'var(--series-1)' }} />{hasEvents ? 'עם התוכנית' : 'בקצב הנוכחי'}</span>
        {hasEvents && <span><i style={{ background: 'var(--series-2)' }} />בלי התוכנית</span>}
        <span><i className="dash" />הרצפה</span>
      </div>
      <Chart theme={theme} deps={[after, before, hasEvents, plan.floor]} label="גרף: היתרה הצפויה בחשבון בכל חודש, עם התוכנית ובלעדיה"
        build={(t) => ({
          ...baseOption(t),
          tooltip: { ...(baseOption(t).tooltip as object), formatter: (ps: { dataIndex: number }[]) => {
            const r = after.rows[ps[0]!.dataIndex]!, b = before.rows[ps[0]!.dataIndex]!;
            return `<b>${monthLabel(r.month)}</b><div>יתרה: <b dir="ltr">${money(r.balance)}</b></div>${hasEvents ? `<div>בלי התוכנית: <b dir="ltr">${money(b.balance)}</b></div>` : ''}<div>נטו באותו חודש: <b dir="ltr">${signedMoney(r.net)}</b></div>`;
          } },
          xAxis: categoryAxis(t, after.rows.map((r) => `${monthLabel(r.month, 'short')} ${r.month.slice(2, 4)}`)),
          yAxis: valueAxis(t, compact),
          series: [
            ...(hasEvents ? [{ type: 'line', data: before.rows.map((r) => Math.round(r.balance)), symbol: 'none', lineStyle: { color: t.s2, width: 2 } }] : []),
            { type: 'line', data: after.rows.map((r) => Math.round(r.balance)), symbol: 'none', lineStyle: { color: t.s1, width: 2 }, areaStyle: { color: t.s1, opacity: 0.1 },
              markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: t.muted, width: 2, type: 'dashed' }, data: [{ yAxis: plan.floor }] } },
          ],
        })} />

      <details className="raw">
        <summary>הטבלה המלאה: כל חודש וכל רכיב</summary>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{['חודש', 'הכנסות', 'קבועות', 'תשלומים', 'משתנות', 'החזר הלוואה', 'חד־פעמי', 'נטו', 'יתרה'].map((h, i) => <th key={h} scope="col" className={i ? 'n' : ''}>{h}</th>)}</tr></thead>
            <tbody>{after.rows.map((r) => (<tr key={r.month}><th scope="row">{monthLabel(r.month)}</th>{[r.income, r.fixed, r.installments, r.variable, r.loanPayments, r.oneOff, r.net, r.balance].map((v, i) => <td key={i} className="n">{money(v)}</td>)}</tr>))}</tbody>
          </table>
        </div>
      </details>
      <p className="explain" style={{ marginTop: '0.75rem' }}>זו תחזית חשבונית שמבוססת על ההנחות שלמעלה, ולא ייעוץ פיננסי. לפני לקיחת הלוואה כדאי לקבל הצעות ריבית אמיתיות ולהתייעץ עם איש מקצוע.</p>
    </Section>
  );
}

function EventForm({ kind, months, d, onAdd, onCancel }: { kind: PlanEventKind; months: string[]; d: HubData; onAdd: (e: PlanEvent) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('');
  const [month, setMonth] = useState(months[0]!);
  const [until, setUntil] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('7');
  const [n, setN] = useState('60');
  const [keys, setKeys] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const isLoan = kind === 'loan', monthly = kind.endsWith('monthly');
  const closing = d.installments.filter((p) => keys.includes(p.key));
  const closeSum = closing.reduce((s, p) => s + p.remainingAmount, 0);
  const pay = isLoan ? loanPayment(num(amount), num(rate), num(n)) : 0;

  return (
    <div className="reco" style={{ marginTop: '0.75rem' }}>
      <h3>{KIND_LABEL[kind]}</h3>
      <div className="field" style={{ marginTop: '0.75rem' }}><label htmlFor="pl">שם (כדי שתזכרו מה זה)</label><input id="pl" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder={isLoan ? 'למשל: הלוואה לאיחוד' : kind === 'income-once' ? 'למשל: בונוס שנתי' : ''} /></div>
      <div className="field"><label htmlFor="pa">{isLoan ? 'סכום ההלוואה (₪)' : monthly ? 'סכום בחודש (₪)' : 'סכום (₪)'}</label><input id="pa" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="field"><label htmlFor="pm">{isLoan ? 'באיזה חודש לוקחים אותה' : monthly ? 'מאיזה חודש' : 'באיזה חודש'}</label>
        <select id="pm" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></div>
      {monthly && <div className="field"><label htmlFor="pu">עד מתי</label><select id="pu" value={until} onChange={(e) => setUntil(e.target.value)}><option value="">ללא תאריך סיום</option>{months.filter((m) => m >= month).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></div>}
      {isLoan && (
        <>
          <div className="cols">
            <div className="field"><label htmlFor="pr">ריבית שנתית (%)</label><span className="hint">הריבית שהבנק מציע. אם עוד אין הצעה — 7% היא הנחה סבירה לבדיקה.</span><input id="pr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
            <div className="field"><label htmlFor="pn">לכמה חודשים</label><input id="pn" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></div>
          </div>
          {d.installments.length > 0 && (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
              <legend style={{ fontWeight: 650 }}>מה ההלוואה סוגרת?</legend>
              <span className="hint">מה שתסמנו ייפרע במלואו ביום לקיחת ההלוואה, והתשלום החודשי שלו ייעלם.</span>
              {d.installments.map((p) => (
                <label key={p.key} style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', minHeight: '2.75rem', fontWeight: 500 }}>
                  <input type="checkbox" style={{ width: '1.375rem', minHeight: '1.375rem' }} checked={keys.includes(p.key)} onChange={(e) => setKeys(e.target.checked ? [...keys, p.key] : keys.filter((k) => k !== p.key))} />
                  <span style={{ flex: 1 }}>{p.businessName} <span className="explain">({p.paid}/{p.total})</span></span>
                  <span className="num">{money(p.remainingAmount)}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="field"><label htmlFor="po">ומה עוד היא מכסה מיד? (₪)</label><span className="hint">למשל סגירת מינוס, או חוב שרייזאפ לא רואה.</span><input id="po" inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value)} /></div>
          {num(amount) > 0 && <p className="banner">החזר חודשי: <b className="num">{money(pay)}</b> · סך הריבית: <b className="num">{money(pay * num(n) - num(amount))}</b> · נסגר: <b className="num">{money(closeSum + num(other))}</b> · נשאר ביד: <b className="num">{money(num(amount) - closeSum - num(other))}</b></p>}
        </>
      )}
      <div className="actions">
        <button className="tool-btn primary" disabled={num(amount) <= 0 || (isLoan && num(n) <= 0)} onClick={() => onAdd({ id: `${Date.now()}`, kind, label: label.trim(), month, amount: num(amount), until: until || undefined,
          loan: isLoan ? { annualRatePct: num(rate), months: Math.round(num(n)), payoffKeys: keys, payoffOther: num(other) } : undefined })}>הוספה לתוכנית</button>
        <button className="tool-btn" onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}
