import type { EnvelopeStatus, Plan, Recommendation, Recurring, ViewTransaction } from '@hub/core';
import { useMemo, useState, type ReactNode } from 'react';
import { BurnChart, NetChart, SplitChart } from './components/charts.tsx';
import { AlertList, Info, Section, Tile } from './components/ui.tsx';
import type { Detail } from './details.tsx';
import { Planner } from './planner.tsx';
import type { HubData, RecoStatus } from './lib/data.ts';
import { money, moneyExact, monthLabel, pct, plural, shortDate, signedMoney, signedPct } from './lib/format.ts';
import type { ScreenId } from './lib/layout.ts';

export interface Ctx {
  d: HubData;
  theme: string;
  open: (x: Detail) => void;
  openTxn: (t: ViewTransaction) => void;
  setReco: (id: string, status: RecoStatus) => void;
  savePlans: (plans: Plan[]) => void;
  go: (screen: ScreenId) => void;
}

const charges = (n: number) => plural(n, 'חיוב אחד', 'חיובים');

// ---- shared rows -------------------------------------------------------------

function EnvelopeRow({ e, open }: { e: EnvelopeStatus; open: Ctx['open'] }) {
  const state = e.usedPct >= 1 ? 'over' : e.usedPct >= 0.8 ? 'near' : 'ok';
  const word = state === 'over' ? 'חריגה' : state === 'near' ? 'קרוב לגבול' : 'בסדר';
  return (
    <button type="button" className="row tap" onClick={() => open({ kind: 'envelope', e })} aria-label={`${e.label}: הוצאתם ${money(e.actual)} מתוך ${money(e.planned)}. לחצו לכל הפרטים והעסקאות`}>
      <span className="name">{e.label}</span>
      <span className="amt">{money(e.actual)} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>/ {money(e.planned)}</span></span>
      <div className="bar" data-state={state} aria-hidden><i style={{ width: `${Math.min(e.usedPct, 1) * 100}%` }} /></div>
      <div className="meta">
        <span>{e.remaining >= 0 ? `נשארו ${money(e.remaining)}` : `חריגה של ${money(-e.remaining)}`}</span>
        <span>{charges(e.count)}</span>
        {e.weeks && <span>מנוהל שבועית</span>}
        {state !== 'ok' && <span className={`pill ${state === 'over' ? 'p1' : 'p2'}`}>{word}</span>}
      </div>
    </button>
  );
}

// An income or a fixed charge: one line, tappable, paid or still expected.
function FixedRow({ e, open }: { e: EnvelopeStatus; open: Ctx['open'] }) {
  return (
    <button type="button" className="row tap" onClick={() => open({ kind: 'envelope', e })}>
      <span className="name">{e.label}</span>
      <span className={`amt ${e.isIncome ? 'in' : ''}`}>{moneyExact(e.paid ? e.actual : e.planned)}</span>
      <div className="meta">
        <span className={`pill ${e.paid ? 'ok' : 'warn'}`}>{e.paid ? (e.isIncome ? 'התקבל' : 'שולם') : e.isIncome ? 'עדיין לא התקבל' : 'ממתין לחיוב'}</span>
        {e.guessed && <span>שם משוער לפי החודש שעבר</span>}
        {e.paid && Math.abs(e.actual - e.planned) > Math.max(2, e.planned * 0.03) && <span>הסכום הצפוי היה <span className="num">{moneyExact(e.planned)}</span></span>}
      </div>
    </button>
  );
}

function TxnRow({ t, onOpen }: { t: ViewTransaction; onOpen: (t: ViewTransaction) => void }) {
  return (
    <button type="button" className="row tap" onClick={() => onOpen(t)} aria-label={`${t.businessName}, ${moneyExact(t.amount)}, ${shortDate(t.transactionDate)}. לחצו לפרטים ולהעברה לקטגוריה אחרת`}>
      <span className="name">{t.businessName}</span>
      <span className={`amt ${t.isIncome ? 'in' : ''}`}>{t.isIncome ? '+' : ''}{moneyExact(t.amount)}</span>
      <div className="meta">
        <span>{shortDate(t.transactionDate)}</span>
        <span>{t.categoryLabel}</span>
        {t.sourceCategory && <span className="pill ok">הועבר על ידכם</span>}
        {t.note && <span className="pill">יש הערה</span>}
        {t.accountNickname && <span>{t.accountNickname}</span>}
        {t.isInstallment && <span className="pill">תשלום {t.installmentNumber} מתוך {t.totalNumberOfInstallments}</span>}
      </div>
    </button>
  );
}

// ---- Home --------------------------------------------------------------------

function Hero({ d }: Ctx) {
  const s = d.status;
  const live = s.dayOfMonth > 0 && s.daysLeft > 0;
  const budget = Math.max(s.flexible.planned, 0);
  const used = budget > 0 ? s.flexible.spent / budget : s.flexible.spent > 0 ? 1 : 0;
  const elapsed = s.dayOfMonth / s.daysInMonth;
  const over = s.flexible.left < 0;
  return (
    <div className="hero">
      <div className="caption"><span>{over ? 'הוצאתם יותר ממה שפנוי החודש' : 'נשאר להוציא'} · {monthLabel(s.month)}</span><Info term="leftToSpend" /></div>
      <div className="figure">{money(Math.abs(s.flexible.left))}</div>
      <div className="sub">
        {live && !over ? <>כלומר בערך <b className="num">{money(s.leftPerDay)}</b> ליום, ל־{s.daysLeft + 1} הימים שנותרו</> : <>הוצאות משתנות: <span className="num">{money(s.flexible.spent)}</span> · פנוי להוצאות משתנות: <span className="num">{money(s.flexible.planned)}</span></>}
      </div>
      <div className="meter" role="img" aria-label={`נוצלו ${pct(Math.min(used, 9.99))} מהסכום הפנוי, ועברו ${pct(elapsed)} מהחודש`}>
        <i style={{ width: `${Math.min(used, 1) * 100}%` }} />
        {live && <b style={{ insetInlineStart: `${elapsed * 100}%` }} />}
      </div>
      <p className="explain">
        איך זה מחושב: הכנסות צפויות <span className="num">{money(s.income.expected)}</span>, פחות הוצאות קבועות <span className="num">{money(s.fixed.planned)}</span>
        {s.goals.planned > 0 && <>, פחות חיסכון ליעדים <span className="num">{money(s.goals.planned)}</span></>}
        , פחות הוצאות משתנות שכבר יצאו <span className="num">{money(s.flexible.spent)}</span>.
      </p>
    </div>
  );
}

function Kpis({ d }: Ctx) {
  const s = d.status;
  return (
    <div className="tiles">
      <Tile caption="תחזית לסוף החודש" term="projection" value={<span className={`delta ${s.projectedNet >= 0 ? 'good' : 'bad'}`}>{signedMoney(s.projectedNet)}</span>}
        sub="אם קצב ההוצאות היומי יימשך" explain={s.projectedNet >= 0 ? 'בקצב הנוכחי יישאר לכם כסף בסוף החודש.' : 'בקצב הנוכחי תסיימו את החודש במינוס.'} />
      <Tile caption="הכנסות שהתקבלו" term="income" value={money(s.income.received)}
        sub={s.income.received >= s.income.expected ? 'כל ההכנסות הצפויות נכנסו' : <>עוד <span className="num">{money(s.income.expected - s.income.received)}</span> צפויים להיכנס</>} />
      <Tile caption="הוצאות קבועות ששולמו" term="fixed" value={money(s.fixed.paid)}
        sub={s.fixed.pending > 0 ? <>עוד <span className="num">{money(s.fixed.pending)}</span> צפויים לרדת</> : 'כל הקבועות כבר ירדו'} />
      <Tile caption="הוצאות משתנות עד כה" term="flexible" value={money(s.flexible.spent)} sub={<>מהן <span className="num">{money(s.flexible.trackedSpent)}</span> בקטגוריות במעקב</>} />
    </div>
  );
}

function Alerts({ d }: Ctx) {
  return (
    <Section title="דורש תשומת לב" hint={d.alerts.length ? <span className="badge">{d.alerts.length}</span> : 'הכול תקין'}>
      <AlertList alerts={d.alerts} limit={4} />
    </Section>
  );
}

const openRecos = (d: HubData) => {
  const today = new Date().toISOString().slice(0, 10);
  return d.recommendations.filter((r) => {
    const st = d.user.reco[r.id];
    return !st || st.status === 'open' || (st.status === 'snoozed' && (st.until ?? '') <= today);
  });
};

function TopRecos(c: Ctx) {
  const open = openRecos(c.d);
  const saving = open.reduce((s, r) => s + (r.yearlySaving ?? 0), 0);
  return (
    <Section title="המלצות בשבילכם" term="recommendations" hint={open.length ? plural(open.length, 'המלצה אחת', 'המלצות') : 'אין כרגע'}>
      {open.length === 0 ? <div className="empty">אין כרגע המלצות פתוחות.</div> : (
        <>
          {saving > 0 && <p className="note">טיפול בכולן יכול להחזיר בערך <b className="num">{money(saving)}</b> בשנה.</p>}
          <div className="rows">
            {open.slice(0, 3).map((r) => (
              <button type="button" className="row tap" key={r.id} onClick={() => c.go('recos')}>
                <span className="name" style={{ whiteSpace: 'normal' }}>{r.title}</span>
                <span className="amt in">{r.yearlySaving ? `${money(r.yearlySaving)} בשנה` : ''}</span>
              </button>
            ))}
          </div>
          <button className="more" onClick={() => c.go('recos')}>לכל ההמלצות וההסברים</button>
        </>
      )}
    </Section>
  );
}

function Pace({ d, theme }: Ctx) {
  return (
    <Section title="תקציב יומי מול הוצאה בפועל" term="pace" note="רק הוצאות משתנות. חיובים קבועים לא נכללים בגרף.">
      <BurnChart d={d} theme={theme} />
    </Section>
  );
}

function Budgets({ d, open }: Ctx) {
  const tracked = d.status.envelopes.filter((e) => e.kind === 'tracked').sort((a, b) => b.usedPct - a.usedPct);
  const over = tracked.filter((e) => e.usedPct >= 1 && e.planned > 0).length;
  return (
    <Section title="קטגוריות במעקב" term="envelope" hint={over ? plural(over, 'חריגה אחת', 'חריגות') : 'ללא חריגות'} note="הקטגוריות שהגדרתם להן תקציב ברייזאפ. לחיצה על קטגוריה מציגה את כל העסקאות שלה, החלוקה השבועית וההיסטוריה.">
      <div className="rows">{tracked.map((e) => <EnvelopeRow e={e} open={open} key={e.id} />)}</div>
    </Section>
  );
}

function Everyday({ d, open, openTxn }: Ctx) {
  const e = d.status.envelopes.find((x) => x.kind === 'everyday');
  if (!e) return null;
  const ids = new Set(e.items.map((i) => i.transactionId));
  const txns = d.transactions.filter((t) => ids.has(t.transactionId));
  return (
    <Section title="הוצאות שוטפות" term="flexible" hint={<span className="num">{money(e.actual)}</span>} defaultOpen={false} note="כל ההוצאות המשתנות שאינן שייכות לקטגוריה במעקב. לרייזאפ אין להן תקציב; מה שפנוי להן הוא מה שנשאר אחרי הקבועות והקטגוריות.">
      <EnvelopeRow e={e} open={open} />
      <div className="rows">{txns.slice(0, 12).map((t) => <TxnRow t={t} onOpen={openTxn} key={t.transactionId} />)}</div>
      {txns.length > 12 && <button className="more" onClick={() => open({ kind: 'envelope', e })}>כל {txns.length} העסקאות</button>}
    </Section>
  );
}

function VariableKpis({ d }: Ctx) {
  const s = d.status;
  return (
    <div className="tiles">
      <Tile caption="הוצאות משתנות החודש" term="flexible" value={money(s.flexible.spent)} sub={<>פנוי להן: <span className="num">{money(s.flexible.planned)}</span></>} />
      <Tile caption={s.flexible.left >= 0 ? 'נשאר להוציא' : 'חריגה'} term="leftToSpend" value={<span className={`delta ${s.flexible.left >= 0 ? 'good' : 'bad'}`}>{money(Math.abs(s.flexible.left))}</span>} sub={s.daysLeft > 0 && s.flexible.left > 0 ? <><span className="num">{money(s.leftPerDay)}</span> ליום</> : ''} />
      <Tile caption="קטגוריות במעקב" term="envelope" value={money(s.flexible.trackedSpent)} sub={<>מתוך תקציב של <span className="num">{money(s.flexible.trackedPlanned)}</span></>} />
      <Tile caption="הוצאות שוטפות" value={money(s.flexible.everydaySpent)} sub="ללא קטגוריה במעקב" />
    </div>
  );
}

function FixedKpis({ d }: Ctx) {
  const s = d.status;
  const n = s.envelopes.filter((e) => e.kind === 'fixed');
  return (
    <div className="tiles">
      <Tile caption="הוצאות קבועות החודש" term="fixed" value={money(s.fixed.planned)} sub={plural(n.length, 'חיוב קבוע אחד', 'חיובים קבועים')} explain="כך רייזאפ מסווג אותן. זה הכסף ש״יוצא לבד״ כל חודש." />
      <Tile caption="כבר ירדו" value={money(s.fixed.paid)} sub={s.fixed.pending > 0 ? <>עוד <span className="num">{money(s.fixed.pending)}</span> צפויים לרדת</> : 'הכול ירד'} />
      <Tile caption="הכנסות קבועות" term="income" value={money(s.envelopes.filter((e) => e.kind === 'income' && e.type === 'fixed').reduce((a, e) => a + Math.max(e.planned, e.actual), 0))} sub="משכורות וקצבאות" />
      <Tile caption="קבועות מתוך ההכנסה" value={s.income.expected > 0 ? pct(s.fixed.planned / s.income.expected) : '—'} sub="ככל שנמוך יותר, יש יותר גמישות" />
    </div>
  );
}

// ---- Month -------------------------------------------------------------------

function Compare({ d }: Ctx) {
  const p = d.previous;
  const now = d.months.find((m) => m.month === d.status.month);
  if (!p || !now) return null;
  const rows: [string, number, number, boolean][] = [['הכנסות', now.income, p.income, true], ['הוצאות', now.expenses, p.expenses, false], ['נשאר', now.net, p.net, true]];
  const partial = d.status.daysLeft > 0 && d.status.dayOfMonth > 0;
  return (
    <Section title={`${monthLabel(d.status.month)} לעומת ${monthLabel(p.month)}`} term="net" note={partial ? 'החודש עוד לא הסתיים, ולכן ההשוואה חלקית.' : undefined}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col"> </th><th scope="col" className="n">החודש</th><th scope="col" className="n">חודש קודם</th><th scope="col" className="n">שינוי</th></tr></thead>
          <tbody>
            {rows.map(([label, a, b, upIsGood]) => (
              <tr key={label}><th scope="row">{label}</th><td className="n">{money(a)}</td><td className="n">{money(b)}</td>
                <td className="n"><span className={`delta ${(a - b >= 0) === upIsGood ? 'good' : 'bad'}`}>{signedMoney(a - b)}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Income({ d, open }: Ctx) {
  const s = d.status;
  return (
    <Section title="הכנסות" term="income" hint={<span className="num">{money(s.income.received)} / {money(s.income.expected)}</span>} note="התקבל / צפוי. לחיצה על שורה מציגה את כל הפרטים וההיסטוריה.">
      <div className="rows">{s.envelopes.filter((e) => e.kind === 'income' && (e.planned > 0 || e.actual > 0)).map((e) => <FixedRow e={e} open={open} key={e.id} />)}</div>
    </Section>
  );
}

function Fixed({ d, open }: Ctx) {
  const fixed = d.status.envelopes.filter((e) => e.kind === 'fixed').sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual));
  const pending = fixed.filter((e) => !e.paid);
  const paid = fixed.filter((e) => e.paid);
  return (
    <Section title="כל ההוצאות הקבועות" term="fixed" hint={pending.length ? `${pending.length} ממתינים` : 'הכול שולם'} note="בדיוק מה שרייזאפ מסווג כ״קבוע״, מהגדול לקטן.">
      {pending.length > 0 && <div className="group-title">עוד לא ירדו החודש</div>}
      <div className="rows">{pending.map((e) => <FixedRow e={e} open={open} key={e.id} />)}</div>
      {paid.length > 0 && <div className="group-title">כבר ירדו</div>}
      <div className="rows">{paid.map((e) => <FixedRow e={e} open={open} key={e.id} />)}</div>
    </Section>
  );
}

const PAGE = 40;

function Transactions({ d, openTxn }: Ctx) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [n, setN] = useState(PAGE);
  const cats = useMemo(() => [...new Set(d.transactions.map((t) => t.categoryLabel ?? 'אחר'))], [d]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return d.transactions.filter((t) => (!cat || (t.categoryLabel ?? 'אחר') === cat) &&
      (!needle || t.businessName.toLowerCase().includes(needle) || (t.note ?? '').toLowerCase().includes(needle) || String(Math.round(t.amount)).includes(needle)));
  }, [d, q, cat]);
  const total = rows.reduce((sum, t) => sum + (t.isIncome ? 0 : t.amount), 0);
  return (
    <Section title="כל העסקאות" term="cashflowMonth" hint={<>{rows.length} · <span className="num">{money(total)}</span></>} note="לחיצה על עסקה פותחת את כל הפרטים, ומאפשרת להעביר אותה לקטגוריה אחרת או להוסיף הערה.">
      <div className="controls">
        <input className="search" type="search" inputMode="search" placeholder="חיפוש לפי שם עסק, סכום או הערה" value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} aria-label="חיפוש עסקאות" />
      </div>
      <div className="chips" role="group" aria-label="סינון לפי קטגוריה">
        <button className="chip" aria-pressed={cat === null} onClick={() => setCat(null)}>הכול</button>
        {cats.map((c) => <button className="chip" key={c} aria-pressed={cat === c} onClick={() => { setCat(cat === c ? null : c); setN(PAGE); }}>{c}</button>)}
      </div>
      <div className="rows" style={{ marginTop: '0.5rem' }} aria-live="polite">
        {rows.slice(0, n).map((t) => <TxnRow t={t} onOpen={openTxn} key={t.transactionId} />)}
        {rows.length === 0 && <div className="empty">לא נמצאו עסקאות מתאימות.</div>}
      </div>
      {rows.length > n && <button className="more" onClick={() => setN(n + PAGE)}>הצגת {Math.min(PAGE, rows.length - n)} עסקאות נוספות</button>}
    </Section>
  );
}

function Biggest({ d, openTxn }: Ctx) {
  const top = d.transactions.filter((t) => !t.isIncome && t.envelopeType !== 'fixed').sort((a, b) => b.amount - a.amount).slice(0, 5);
  return (
    <Section title="הקניות הגדולות של החודש" defaultOpen={false} note="חמש ההוצאות המשתנות הגדולות ביותר. חיובים קבועים לא נכללים.">
      <div className="rows">{top.map((t) => <TxnRow t={t} onOpen={openTxn} key={t.transactionId} />)}</div>
    </Section>
  );
}

function Accounts({ d }: Ctx) {
  return (
    <Section title="לפי כרטיס וחשבון" defaultOpen={false} note="כמה הוצא החודש מכל כרטיס אשראי או חשבון בנק.">
      <div className="rows">
        {d.accounts.map((a) => (
          <div className="row" key={a.account}><span className="name">{a.account}</span><span className="amt">{money(a.amount)}</span><div className="meta"><span>{charges(a.count)}</span></div></div>
        ))}
      </div>
    </Section>
  );
}

function Installments({ d, open }: Ctx) {
  const monthly = d.installments.reduce((s, p) => s + p.monthly, 0);
  const remaining = d.installments.reduce((s, p) => s + p.remainingAmount, 0);
  return (
    <Section title="עסקאות בתשלומים" term="installments" hint={d.installments.length ? <span className="num">{money(monthly)} בחודש</span> : 'אין'} defaultOpen={false}>
      {d.installments.length === 0 ? <div className="empty">אין עסקאות תשלומים פתוחות.</div> : (
        <>
          <p className="note">בסך הכול נותר לשלם <b className="num">{money(remaining)}</b> על עסקאות שכבר בוצעו.</p>
          <div className="rows">
            {d.installments.map((p) => (
              <button type="button" className="row tap" key={p.key} onClick={() => open({ kind: 'installment', p })}>
                <span className="name">{p.businessName}</span>
                <span className="amt">{moneyExact(p.monthly)}</span>
                <div className="bar" role="img" aria-label={`שולמו ${p.paid} מתוך ${p.total} תשלומים`}><i style={{ width: `${(p.paid / p.total) * 100}%` }} /></div>
                <div className="meta"><span>שולמו {p.paid} מתוך {p.total}</span><span>נותרו <span className="num">{money(p.remainingAmount)}</span></span><span>מסתיים ב{monthLabel(p.lastMonth)}</span></div>
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

function Excluded({ d, openTxn }: Ctx) {
  if (d.excluded.length === 0) return null;
  const s = d.status.excluded;
  return (
    <Section title="מחוץ לתזרים (לא נספר)" term="excluded" hint={d.excluded.length} defaultOpen={false}
      note={`רייזאפ מחזיר את העסקאות האלה אבל לא סופר אותן בתזרים — העברות בין חשבונות, חיוב כרטיס האשראי כפי שהוא נראה בבנק, ועסקאות שסימנתם כחד־פעמיות. גם אצלנו הן לא נספרות באף סיכום. סך הכול: ${money(s.expenses)} הוצאות${s.income ? ` ו־${money(s.income)} הכנסות` : ''}.`}>
      <div className="rows">{d.excluded.map((t) => <TxnRow t={t} onOpen={openTxn} key={t.transactionId} />)}</div>
    </Section>
  );
}

function Removed({ d, openTxn }: Ctx) {
  if (d.removed.length === 0) return null;
  return (
    <Section title="נשמר אצלנו, הוסר ברייזאפ" term="removed" hint={d.removed.length} defaultOpen={false} note="העסקאות האלה לא נספרות בסיכומים, אבל לא נמחקות.">
      <div className="rows">{d.removed.map((t) => <TxnRow t={t} onOpen={openTxn} key={t.transactionId} />)}</div>
    </Section>
  );
}

// ---- Trends ------------------------------------------------------------------

function TrendKpis({ d }: Ctx) {
  const closed = d.months.filter((m) => m.month < d.status.month);
  const last6 = closed.slice(-6);
  const n = last6.length || 1;
  const income = last6.reduce((s, m) => s + m.income, 0);
  const net = last6.reduce((s, m) => s + m.net, 0);
  const rate = income > 0 ? net / income : 0;
  const best = [...closed].sort((a, b) => b.net - a.net)[0];
  const worst = [...closed].sort((a, b) => a.net - b.net)[0];
  return (
    <div className="tiles">
      <Tile caption="שיעור חיסכון · חצי שנה" term="savingsRate" value={<span className={`delta ${rate >= 0.1 ? 'good' : 'bad'}`}>{pct(rate)}</span>} sub="מההכנסה נשאר אצלכם" />
      <Tile caption="נשאר בממוצע בחודש" term="net" value={signedMoney(net / n)} sub={<>הוצאה ממוצעת <span className="num">{money(last6.reduce((s, m) => s + m.expenses, 0) / n)}</span></>} />
      <Tile caption="החודש הטוב ביותר" value={best ? signedMoney(best.net) : '—'} sub={best ? monthLabel(best.month) : ''} />
      <Tile caption="החודש הקשה ביותר" value={worst ? signedMoney(worst.net) : '—'} sub={worst ? monthLabel(worst.month) : ''} />
    </div>
  );
}

function Net({ d, theme }: Ctx) {
  return <Section title="כמה נשאר בכל חודש" term="net" note="הכנסות פחות כל ההוצאות. ירוק — נשאר כסף. אדום — הוצאתם יותר ממה שנכנס. החודש הנוכחי עדיין חלקי."><NetChart d={d} theme={theme} /></Section>;
}

function Split({ d, theme }: Ctx) {
  return <Section title="הוצאות קבועות מול משתנות" term="flexible" note="כשהעמודה מגיעה לקו המקווקו, כל ההכנסה של אותו חודש הוצאה."><SplitChart d={d} theme={theme} /></Section>;
}

function Categories({ d }: Ctx) {
  const cats = d.categories.filter((c) => c.average > 0 || c.latest > 0);
  const partial = d.status.daysLeft > 0 && d.status.dayOfMonth > 0;
  return (
    <Section title="כל קטגוריה לעומת הממוצע שלה" note={`${monthLabel(d.status.month)} לעומת ממוצע החודשים שלפניו.${partial ? ' החודש עוד לא הסתיים, ולכן קטגוריות משתנות ייראו נמוכות מהרגיל.' : ''}`}>
      <div className="rows">
        {cats.map((c) => {
          const scale = Math.max(c.latest, c.average, 1);
          return (
            <div className="row" key={c.category}>
              <span className="name">{c.category}</span>
              <span className="amt">{money(c.latest)}</span>
              <div className="bar" data-state={c.changePct > 0.15 ? 'near' : 'ok'} aria-hidden><i style={{ width: `${(c.latest / scale) * 100}%` }} /></div>
              <div className="meta">
                <span>ממוצע <span className="num">{money(c.average)}</span></span>
                {c.average > 0 && <span className={`delta ${c.changePct > 0 ? 'bad' : 'good'}`}><span className="num">{signedPct(c.changePct)}</span> {c.changePct > 0 ? 'מעל הממוצע' : 'מתחת לממוצע'}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---- Recurring ---------------------------------------------------------------

function RecRow({ r, extra, open }: { r: Recurring; extra?: ReactNode; open: Ctx['open'] }) {
  return (
    <button type="button" className="row tap" onClick={() => open({ kind: 'business', key: r.key, name: r.businessName })}>
      <span className="name">{r.businessName}</span>
      <span className="amt">{moneyExact(r.lastAmount)}</span>
      <div className="meta"><span><span className="num">{money(r.annualized)}</span> בשנה</span>{r.category && <span>{r.category}</span>}{extra}</div>
    </button>
  );
}

const activeRec = (d: HubData) => d.recurring.filter((r) => !r.stopped);

function Changes({ d, open }: Ctx) {
  const active = activeRec(d);
  const changed = active.filter((r) => r.steady && r.monthsSeen >= 3 && Math.abs(r.changePct) >= 0.08 && Math.abs(r.lastAmount - r.typicalAmount) >= 5);
  const fresh = active.filter((r) => r.isNew);
  const stopped = d.recurring.filter((r) => r.stopped);
  const n = changed.length + fresh.length + stopped.length;
  return (
    <Section title="מה השתנה בחיובים הקבועים" hint={n || 'אין שינויים'}>
      {n === 0 && <div className="empty">לא זוהו שינויים בחיובים הקבועים.</div>}
      {changed.length > 0 && <div className="group-title">שינויי מחיר</div>}
      <div className="rows">{changed.map((r) => <RecRow r={r} open={open} key={r.key} extra={<span className={`delta ${r.changePct > 0 ? 'bad' : 'good'}`}><span className="num">{signedPct(r.changePct)}</span> · קודם <span className="num">{moneyExact(r.typicalAmount)}</span></span>} />)}</div>
      {fresh.length > 0 && <div className="group-title">חדשים החודש</div>}
      <div className="rows">{fresh.map((r) => <RecRow r={r} open={open} key={r.key} extra={<span className="pill warn">חדש</span>} />)}</div>
      {stopped.length > 0 && <div className="group-title">הפסיקו לחייב</div>}
      <div className="rows">{stopped.map((r) => <RecRow r={r} open={open} key={r.key} extra={<span>חיוב אחרון: {monthLabel(r.lastMonth)}</span>} />)}</div>
    </Section>
  );
}

function RecurringAll({ d, open }: Ctx) {
  return (
    <Section title="קבועות לאורך זמן, ועלות שנתית" term="recurring" defaultOpen={false} note="כל מה שרייזאפ סיווג כקבוע בחודשים האחרונים, עם העלות השנתית. כל שורה שאתם כבר לא צריכים היא כסף שחוזר אליכם כל חודש.">
      <div className="rows">{activeRec(d).map((r) => <RecRow r={r} open={open} key={r.key} />)}</div>
    </Section>
  );
}

// ---- Recommendations ---------------------------------------------------------

const TOPIC: Record<Recommendation['topic'], string> = {
  price: 'התייקרות', loans: 'הלוואות', insurance: 'ביטוח', subscriptions: 'מנויים', telecom: 'תקשורת', fees: 'עמלות', installments: 'תשלומים', budget: 'תקציב', savings: 'חיסכון',
};
const PRIORITY = { 1: 'כדאי לטפל השבוע', 2: 'כדאי לטפל החודש', 3: 'כשיהיה זמן' } as const;
const STATUS_LABEL: Record<RecoStatus, string> = { open: 'פתוחה', done: 'טופלה', dismissed: 'לא רלוונטית', snoozed: 'נדחתה בחודש' };

function RecoSummary(c: Ctx) {
  const open = openRecos(c.d);
  const done = c.d.recommendations.filter((r) => c.d.user.reco[r.id]?.status === 'done');
  return (
    <div className="tiles">
      <Tile caption="המלצות פתוחות" term="recommendations" value={open.length} sub={open.filter((r) => r.priority === 1).length ? `${open.filter((r) => r.priority === 1).length} מהן דחופות` : 'אין דחופות'} />
      <Tile caption="חיסכון שנתי אפשרי" term="yearlySaving" value={<span className="delta good">{money(open.reduce((s, r) => s + (r.yearlySaving ?? 0), 0))}</span>} sub={done.length ? `כבר טיפלתם ב־${done.length}` : 'הערכה בלבד'} />
    </div>
  );
}

function RecoCard({ r, status, setReco }: { r: Recommendation; status: RecoStatus; setReco: Ctx['setReco'] }) {
  return (
    <article className="reco" data-status={status}>
      <div className="tags">
        <span className={`pill p${r.priority}`}>{PRIORITY[r.priority]}</span>
        <span className="pill">{TOPIC[r.topic]}</span>
        {status !== 'open' && <span className="pill ok">{STATUS_LABEL[status]}</span>}
      </div>
      <h3>{r.title}</h3>
      <p className="why"><b>למה: </b>{r.why}</p>
      {r.evidence && r.evidence.length > 0 && (
        <div className="evidence rows" aria-label="הנתונים שעליהם ההמלצה מבוססת">
          {r.evidence.map((e, i) => <div className="row" key={`${e.label}${i}`}><span className="name">{e.label}</span><span className="amt">{moneyExact(e.amount)}</span></div>)}
        </div>
      )}
      <p style={{ marginTop: '0.75rem', fontWeight: 700 }}>מה עושים:</p>
      <ol>{r.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {r.yearlySaving ? <p className="saving">חיסכון משוער: <span className="num">{money(r.yearlySaving)}</span> בשנה</p> : null}
      <div className="actions">
        {status === 'open' ? (
          <>
            <button className="tool-btn primary" onClick={() => setReco(r.id, 'done')}>טיפלנו בזה ✓</button>
            <button className="tool-btn" onClick={() => setReco(r.id, 'snoozed')}>להזכיר בעוד חודש</button>
            <button className="tool-btn" onClick={() => setReco(r.id, 'dismissed')}>לא רלוונטי</button>
          </>
        ) : <button className="tool-btn" onClick={() => setReco(r.id, 'open')}>להחזיר לרשימה הפתוחה</button>}
      </div>
    </article>
  );
}

function RecoList(c: Ctx) {
  const [tab, setTab] = useState<'open' | 'handled'>('open');
  const open = openRecos(c.d);
  const handled = c.d.recommendations.filter((r) => !open.includes(r));
  const list = tab === 'open' ? open : handled;
  return (
    <Section title="ההמלצות" term="recommendations" note="ההמלצות מבוססות על כללים קבועים ועל הנתונים שלכם בלבד. הן אינן ייעוץ פיננסי מקצועי.">
      <div className="chips" role="group" aria-label="סינון המלצות" style={{ marginBottom: '0.75rem' }}>
        <button className="chip" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>פתוחות ({open.length})</button>
        <button className="chip" aria-pressed={tab === 'handled'} onClick={() => setTab('handled')}>טופלו או נדחו ({handled.length})</button>
      </div>
      {list.length === 0 && <div className="empty">{tab === 'open' ? 'אין המלצות פתוחות. כל הכבוד!' : 'עוד לא סימנתם המלצות.'}</div>}
      {list.map((r) => <RecoCard r={r} key={r.id} status={tab === 'open' ? 'open' : c.d.user.reco[r.id]?.status ?? 'open'} setReco={c.setReco} />)}
    </Section>
  );
}

// ---- Registry ----------------------------------------------------------------

export const WIDGETS: Record<string, { name: string; render: (c: Ctx) => ReactNode }> = {
  hero: { name: 'נשאר להוציא', render: (c) => <Hero {...c} /> },
  kpis: { name: 'מדדי החודש', render: (c) => <Kpis {...c} /> },
  alerts: { name: 'דורש תשומת לב', render: (c) => <Alerts {...c} /> },
  topRecos: { name: 'המלצות מובילות', render: (c) => <TopRecos {...c} /> },
  fixedKpis: { name: 'סיכום קבועות', render: (c) => <FixedKpis {...c} /> },
  income: { name: 'הכנסות', render: (c) => <Income {...c} /> },
  fixed: { name: 'כל ההוצאות הקבועות', render: (c) => <Fixed {...c} /> },
  changes: { name: 'שינויים בקבועות', render: (c) => <Changes {...c} /> },
  recurringAll: { name: 'קבועות לאורך זמן', render: (c) => <RecurringAll {...c} /> },
  variableKpis: { name: 'סיכום משתנות', render: (c) => <VariableKpis {...c} /> },
  pace: { name: 'קצב ההוצאות', render: (c) => <Pace {...c} /> },
  budgets: { name: 'קטגוריות במעקב', render: (c) => <Budgets {...c} /> },
  everyday: { name: 'הוצאות שוטפות', render: (c) => <Everyday {...c} /> },
  biggest: { name: 'הקניות הגדולות', render: (c) => <Biggest {...c} /> },
  installments: { name: 'עסקאות בתשלומים', render: (c) => <Installments {...c} /> },
  compare: { name: 'השוואה לחודש הקודם', render: (c) => <Compare {...c} /> },
  transactions: { name: 'כל העסקאות', render: (c) => <Transactions {...c} /> },
  accounts: { name: 'לפי כרטיס וחשבון', render: (c) => <Accounts {...c} /> },
  excluded: { name: 'מחוץ לתזרים', render: (c) => <Excluded {...c} /> },
  removed: { name: 'הוסר ברייזאפ', render: (c) => <Removed {...c} /> },
  trendKpis: { name: 'מדדי מגמה', render: (c) => <TrendKpis {...c} /> },
  net: { name: 'כמה נשאר בכל חודש', render: (c) => <Net {...c} /> },
  split: { name: 'קבועות מול משתנות', render: (c) => <Split {...c} /> },
  categories: { name: 'קטגוריות לעומת הממוצע', render: (c) => <Categories {...c} /> },
  planner: { name: 'מה אם? תכנון ותחזית', render: (c) => <Planner d={c.d} theme={c.theme} onSave={c.savePlans} /> },
  recoSummary: { name: 'סיכום המלצות', render: (c) => <RecoSummary {...c} /> },
  recoList: { name: 'רשימת ההמלצות', render: (c) => <RecoList {...c} /> },
};
