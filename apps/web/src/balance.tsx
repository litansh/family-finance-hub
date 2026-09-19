import { defaultStrategy, strategy, type ExistingLoan, type OptionId, type StrategyInputs, type StrategyOption } from '@hub/core';
import { useMemo, useState } from 'react';
import { baseOption, categoryAxis, Chart, valueAxis } from './components/Chart.tsx';
import { Section, Tile } from './components/ui.tsx';
import type { HubData } from './lib/data.ts';
import { compact, money, monthLabel, plural, signedMoney } from './lib/format.ts';

const NAME: Record<OptionId, string> = {
  overdraft: 'בלי הלוואה (המינוס נושא את הדרך)',
  loan: 'הלוואת גישור',
  consolidate: 'איחוד הלוואות',
  'consolidate+loan': 'איחוד הלוואות + גישור',
};
const num = (v: string) => { const n = Number(v.replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

// The path to balance: where the trend is heading, how much has to change each
// month, and the cheapest way to carry the months in between.
export function Balance({ d, theme, onSave }: { d: HubData; theme: string; onSave: (s: StrategyInputs) => void }) {
  const [q, setQ] = useState<StrategyInputs>(() => ({ ...defaultStrategy(), ...(d.user.strategy ?? {}) }));
  const [open, setOpen] = useState(false);
  const update = (patch: Partial<StrategyInputs>) => { const next = { ...q, ...patch }; setQ(next); onSave(next); };
  const s = useMemo(() => strategy(d.months, d.baseline, q, d.history), [d.months, d.baseline, d.history, q]);
  const outside = d.outside.filter((o) => o.month < d.status.month);
  const broughtIn = outside.reduce((a, o) => a + o.moneyIn, 0);
  const t = s.trend;
  const best = s.options.find((o) => o.id === s.recommended);
  const closest = [...s.options].sort((a, b) => a.missingPerMonth - b.missingPerMonth)[0]!;
  const colors = ['s1', 's2', 's3', 's4'] as const;

  const trendLine = t.months.length < 4
    ? 'עוד אין מספיק חודשים סגורים כדי למדוד מגמה.'
    : `לפי ${t.months.length} החודשים האחרונים, ${t.steadyIncomeNow > 0 ? `ההכנסה הקבועה (${money(t.steadyIncomeNow)} בחודש, ועוד כ־${money(t.irregularIncomePerMonth)} בממוצע מבונוסים והכנסות חד־פעמיות)` : 'ההכנסות'} ${Math.abs(t.incomeSlope) < 25 ? 'יציבה' : t.incomeSlope > 0 ? `עולה בכ־${money(t.incomeSlope)} בכל חודש` : `יורדת בכ־${money(-t.incomeSlope)} בכל חודש`}, וההוצאות ${Math.abs(t.expenseSlope) < 25 ? 'יציבות' : t.expenseSlope > 0 ? `עולות בכ־${money(t.expenseSlope)} בכל חודש` : `יורדות בכ־${money(-t.expenseSlope)} בכל חודש`}. ${t.gapNow <= 0 ? 'כבר היום אתם מאוזנים.' : t.monthsToBalanceOnTrend === null ? 'בקצב הזה הפער לא נסגר מעצמו.' : `בקצב הזה הפער נסגר מעצמו בעוד כ־${plural(t.monthsToBalanceOnTrend, 'חודש', 'חודשים')}.`}`;

  const verdict = (() => {
    if (t.gapNow <= 0) return 'ההכנסה הטיפוסית שלכם כבר מכסה את ההוצאות. אין פער לסגור.';
    const parts = [`כדי להתאזן בתוך ${plural(q.monthsToBalance, 'חודש', 'חודשים')}, עם תוספת הכנסה של ${money(q.incomeUp)}, צריך לחתוך ${money(s.cutNeededByTarget)} בחודש מההוצאות עד אז${s.cutNeededByTarget > q.expenseDown + 1 ? ` — יותר מה־${money(q.expenseDown)} שהנחתם` : ''}. בדרך לשם התוכנית עצמה יוצרת בור של ${money(s.bridgeNeeded)}, שמשהו צריך לשאת.`];
    if (best) {
      parts.push(`הדרך הזולה ביותר שמחזיקה: ${NAME[best.id]}${best.loanPrincipal > 0 ? ` של ${money(best.loanPrincipal)} (החזר ${money(best.loanPayment)} בחודש, ${money(best.loanInterest)} ריבית לאורך כל חייה)` : ''}. עלות כוללת ${money(best.totalCost)}, הנקודה הנמוכה ביותר ${signedMoney(best.lowest.balance)} ב${monthLabel(best.lowest.month)}${best.breakEvenMonth ? `, ומ${monthLabel(best.breakEvenMonth)} ההכנסות מכסות את ההוצאות וההחזרים` : ', אבל גם בסוף התקופה ההכנסות עדיין לא מכסות את ההוצאות וההחזרים'}.`);
    } else {
      parts.push(`אף אחת מהדרכים לא מחזיקה עם ההנחות האלה: היתרה יורדת מתחת למסגרת. הקרובה ביותר היא ${NAME[closest.id]}, וחסר לה שיפור נוסף של ${money(closest.missingPerMonth)} בחודש (יותר הכנסה או פחות הוצאות), או מסגרת גדולה יותר.`);
    }
    const loan = s.options.find((o) => o.id === 'loan');
    if (loan && !loan.breakEvenMonth) parts.push('שימו לב: הלוואה קונה זמן, לא איזון. ההחזר שלה הוא הוצאה חדשה, ואם השיפור בהכנסות ובהוצאות לא מגיע, בסופה נשארים עם אותו פער ועוד חוב.');
    return parts.join(' ');
  })();

  const field = (id: keyof StrategyInputs, label: string, hint?: string) => (
    <div className="field"><label htmlFor={`st-${id}`}>{label}</label>{hint && <span className="hint">{hint}</span>}
      <input id={`st-${id}`} inputMode="decimal" dir="ltr" defaultValue={(q[id] as number) || ''} placeholder="0" onBlur={(e) => update({ [id]: num(e.target.value) } as Partial<StrategyInputs>)} /></div>
  );
  const setLoan = (i: number, patch: Partial<ExistingLoan>) => update({ existingLoans: q.existingLoans.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

  return (
    <Section title="הדרך לאיזון" hint={t.gapNow > 0 ? <span className="num">חסרים {money(t.gapNow)} בחודש</span> : 'מאוזנים'}
      note="כמה חסר בכל חודש, לאן המגמה הולכת, כמה צריך לחתוך, ומה הדרך הזולה ביותר לעבור את התקופה שבדרך: מינוס, הלוואת גישור או איחוד הלוואות. הכול חשבון על המספרים שלכם ועל ההנחות שאתם מזינים; שום דבר כאן אינו ייעוץ פיננסי.">
      <div className="tiles">
        <Tile caption={t.gapNow > 0 ? 'הפער החודשי היום' : 'העודף החודשי היום'} value={<span className={`delta ${t.gapNow > 0 ? 'bad' : 'good'}`}>{money(Math.abs(t.gapNow))}</span>} sub={<>הכנסה <span className="num">{money(t.incomeNow)}</span> · הוצאות <span className="num">{money(t.expensesNow)}</span></>} />
        <Tile caption={`לחתוך כדי להתאזן בתוך ${q.monthsToBalance} חודשים`} value={money(s.cutNeededByTarget)} sub={<>בחודש, בהנחה שההכנסה עולה ב־<span className="num">{money(q.incomeUp)}</span></>} />
        <Tile caption="הבור שבדרך" value={money(s.bridgeNeeded)} sub="לפני ריבית. את זה צריך לשאת" />
        <Tile caption="להתאזן כבר היום" value={money(s.cutToBalanceToday)} sub="חיתוך חודשי בלי שום שינוי בהכנסה" />
      </div>
      <p className="explain">{trendLine}</p>
      {broughtIn > 0 && <p className="explain">איך הפער מכוסה היום: ב־{plural(outside.length, 'חודש הקודם', 'החודשים הקודמים')} נכנסו לחשבון <b className="num">{money(broughtIn)}</b> שרייזאפ לא סופר כהכנסה (העברות מחיסכון או מחשבון אחר, הלוואות שהתקבלו): {outside.filter((o) => o.moneyIn > 0).map((o) => `${monthLabel(o.month, 'short')} ${money(o.moneyIn)}`).join(' · ')}. זה הכסף שנושא את המינוס, והוא לא מתחדש מעצמו.</p>}
      <p className="banner" role="status">{verdict}</p>

      <div className="legend">{s.options.map((o, i) => <span key={o.id}><i style={{ background: `var(--series-${i + 1})` }} />{NAME[o.id]}</span>)}</div>
      <Chart theme={theme} deps={[s]} label="גרף: היתרה הצפויה בחשבון בכל חודש, בכל אחת מהדרכים"
        build={(tk) => ({
          ...baseOption(tk),
          xAxis: categoryAxis(tk, s.options[0]!.rows.map((r) => `${monthLabel(r.month, 'short')} ${r.month.slice(2, 4)}`)),
          yAxis: valueAxis(tk, compact),
          series: s.options.map((o, i) => ({ type: 'line', data: o.rows.map((r) => Math.round(r.balance)), symbol: 'none', lineStyle: { color: tk[colors[i]!] ?? tk.s1, width: 2 },
            ...(i === 0 ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: tk.muted, width: 2, type: 'dashed' }, data: [{ yAxis: -q.overdraftLimit }] } } : {}) })),
        })} />

      <div className="rows">{s.options.map((o) => <OptionRow key={o.id} o={o} recommended={o.id === s.recommended} />)}</div>

      <button className="more" onClick={() => setOpen(!open)}>{open ? 'סגירת ההנחות' : 'ההנחות שלכם: יעד, הלוואה, מסגרת, הלוואות קיימות'}</button>
      {open && (
        <>
          <h3 className="group-title">היעד</h3>
          <div className="cols">
            {field('monthsToBalance', 'בתוך כמה חודשים רוצים להתאזן')}
            {field('incomeUp', 'תוספת הכנסה חודשית עד אז (₪)', 'עבודה נוספת, העלאה, הכנסה חדשה. עולה בהדרגה עד היעד.')}
            {field('expenseDown', 'חיתוך חודשי בהוצאות עד אז (₪)', 'יורד בהדרגה עד היעד.')}
            {field('otherIncomePerMonth', 'הכנסה לא קבועה שאתם סומכים עליה, בממוצע לחודש (₪)', `בונוסים, עבודות צד. בחצי השנה האחרונה זה היה כ־${money(t.irregularIncomePerMonth)} בחודש. החישוב לא מניח אותה אלא אם תזינו.`)}
          </div>
          <label className="check"><input type="checkbox" checked={q.followIncomeTrend} onChange={(e) => update({ followIncomeTrend: e.target.checked })} /> להניח שההכנסה הקבועה גם ממשיכה לעלות בקצב שנמדד ({signedMoney(Math.max(t.incomeSlope, 0))} בכל חודש), למשך שנה לכל היותר</label>
          <h3 className="group-title">נקודת המוצא והמינוס</h3>
          <div className="cols">
            {field('startBalance', 'כמה יש בחשבון היום (₪)', 'רייזאפ לא מוסר יתרות. מינוס מסמנים עם −.')}
            {field('overdraftLimit', 'מסגרת האשראי בעו"ש (₪)', 'עד כמה הבנק מרשה לרדת מתחת לאפס. 0 = אין מסגרת.')}
            {field('overdraftRatePct', 'ריבית שנתית על המינוס (%)')}
          </div>
          <h3 className="group-title">ההלוואה שאתם שוקלים</h3>
          <div className="cols">
            {field('loanAmount', 'סכום (₪)', '0 = לא לבדוק הלוואה.')}
            {field('loanRatePct', 'ריבית שנתית (%)', 'הזינו הצעה אמיתית מהבנק; זה המספר שמכריע.')}
            {field('loanMonths', 'מספר תשלומים')}
          </div>
          <h3 className="group-title">הלוואות קיימות (לבדיקת איחוד)</h3>
          <p className="explain">רייזאפ מראה הלוואה רק כחיוב קבוע, בלי היתרה לסילוק. הזינו לכל הלוואה את ההחזר החודשי ואת היתרה לסילוק (מופיעה בדף ההלוואה בבנק).</p>
          {q.existingLoans.map((l, i) => (
            <div className="cols" key={i}>
              <div className="field"><label htmlFor={`ln-${i}`}>שם</label><input id={`ln-${i}`} defaultValue={l.label} onBlur={(e) => setLoan(i, { label: e.target.value.slice(0, 60) })} /></div>
              <div className="field"><label htmlFor={`lm-${i}`}>החזר חודשי (₪)</label><input id={`lm-${i}`} inputMode="decimal" dir="ltr" defaultValue={l.monthly || ''} onBlur={(e) => setLoan(i, { monthly: num(e.target.value) })} /></div>
              <div className="field"><label htmlFor={`lr-${i}`}>יתרה לסילוק (₪)</label><input id={`lr-${i}`} inputMode="decimal" dir="ltr" defaultValue={l.remaining || ''} onBlur={(e) => setLoan(i, { remaining: num(e.target.value) })} /></div>
              <button type="button" className="link-btn" onClick={() => update({ existingLoans: q.existingLoans.filter((_, k) => k !== i) })}>הסרה</button>
            </div>
          ))}
          <button type="button" className="tool-btn" onClick={() => update({ existingLoans: [...q.existingLoans, { label: '', monthly: 0, remaining: 0 }] })}>הוספת הלוואה קיימת</button>
          {d.baseline.installments.length > 0 && <label className="check" style={{ marginTop: '0.75rem' }}><input type="checkbox" checked={q.consolidateInstallments} onChange={(e) => update({ consolidateInstallments: e.target.checked })} /> לכלול באיחוד גם את {d.baseline.installments.length} עסקאות התשלומים הפתוחות ({money(d.baseline.installments.reduce((a, p) => a + p.remainingAmount, 0))})</label>}
        </>
      )}
    </Section>
  );
}

function OptionRow({ o, recommended }: { o: StrategyOption; recommended: boolean }) {
  return (
    <div className="row">
      <span className="name">{NAME[o.id]}{o.loanPrincipal > 0 && <> · <span className="num">{money(o.loanPrincipal)}</span></>}</span>
      <span className="amt">{money(o.totalCost)}</span>
      <div className="meta">
        {recommended && <span className="pill ok">הזולה ביותר שמחזיקה</span>}
        {!o.holds && <span className="pill p1">לא מחזיקה · חסרים {money(o.missingPerMonth)} בחודש</span>}
        <span>עלות: ריבית הלוואה <span className="num">{money(o.loanInterest)}</span> + ריבית מינוס <span className="num">{money(o.overdraftInterest)}</span></span>
        {o.loanPayment > 0 && <span>החזר <span className="num">{money(o.loanPayment)}</span> בחודש{o.freedMonthly > 0 && <> · מבטל תשלומים של <span className="num">{money(o.freedMonthly)}</span></>}</span>}
        {o.paysOff > 0 && <span>סוגר חוב קיים של <span className="num">{money(o.paysOff)}</span> · נכנסים לחשבון <span className="num">{money(o.cashIn)}</span></span>}
        <span>הנקודה הנמוכה ביותר <span className="num">{signedMoney(o.lowest.balance)}</span> ב{monthLabel(o.lowest.month)}</span>
        <span>{o.breakEvenMonth ? `מאוזנים מ${monthLabel(o.breakEvenMonth)}` : 'לא מגיעים לאיזון בתקופה'}</span>
        {o.debtAtEnd > 1 && <span>בסוף התקופה נשארים <span className="num">{money(o.debtAtEnd)}</span> חוב</span>}
      </div>
    </div>
  );
}
