import type { ViewTransaction } from '@hub/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons, InfoProvider, Sheet, TermSheet } from './components/ui.tsx';
import { Chat } from './chat.tsx';
import { DetailSheet, type Detail } from './details.tsx';
import { isSample, loadDashboard, localLayout, saveLayout, saveOverride, savePlans, saveReco, type HubData, type RecoStatus } from './lib/data.ts';
import { ago, monthLabel } from './lib/format.ts';
import { GLOSSARY, type TermId } from './lib/glossary.ts';
import { DEFAULT_LAYOUT, hide, move, normalize, SCREEN_LABEL, SCREENS, sendTo, type Layout, type ScreenId } from './lib/layout.ts';
import { TEXT_SIZES, useTheme } from './lib/theme.ts';
import { WIDGETS, type Ctx } from './widgets.tsx';

const TAB_ICON: Record<ScreenId, JSX.Element> = { home: Icons.home, fixed: Icons.recurring, variable: Icons.variable, txns: Icons.month, trends: Icons.trends, recos: Icons.recos };

export function App() {
  const { resolved: theme, toggle, size, setSize } = useTheme();
  const [screen, setScreen] = useState<ScreenId>('home');
  const [month, setMonth] = useState<string>();
  const [d, setD] = useState<HubData>();
  const [error, setError] = useState<string>();
  const [layout, setLayout] = useState<Layout>(() => normalize(localLayout.get()));
  const [editing, setEditing] = useState(false);
  const [term, setTerm] = useState<TermId>();
  const [sheet, setSheet] = useState<'settings' | 'glossary' | 'chat'>();
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState<string>();

  const say = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast(undefined), 2600); }, []);

  const load = useCallback(async (first = false) => {
    try {
      const x = await loadDashboard(month);
      setD(x);
      setError(undefined);
      // The hub's copy wins on first load, so both phones show the same arrangement.
      if (first && x.user.layout) setLayout(normalize(x.user.layout));
    } catch (e) { setError((e as Error).message); }
  }, [month]);

  useEffect(() => { void load(d === undefined); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [load]);

  const change = (next: Layout) => { setLayout(next); saveLayout(next).catch(() => say('הסידור נשמר במכשיר הזה בלבד')); };
  const go = (id: ScreenId) => { setScreen(id); window.scrollTo({ top: 0 }); };

  const setReco = async (id: string, status: RecoStatus) => {
    const until = status === 'snoozed' ? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) : undefined;
    try { await saveReco(id, status, until); await load(); say(status === 'done' ? 'מעולה, סומן כטופל' : status === 'open' ? 'הוחזר לרשימה' : 'עודכן'); }
    catch (e) { say((e as Error).message); }
  };

  const ctx: Ctx | undefined = useMemo(() => d && { d, theme, open: setDetail, openTxn: (t: ViewTransaction) => setDetail({ kind: 'txn', t }), setReco, go, savePlans: (plans) => { savePlans(plans).catch(() => say('התוכנית נשמרה במכשיר הזה בלבד')); } }, [d, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const widgets = layout.screens[screen];

  return (
    <InfoProvider value={setTerm}>
      <a className="skip" href="#main">דילוג לתוכן</a>
      <div className="app">
        <header className="topbar">
          <h1>הכספים שלנו</h1>
          {d && (
            <select className="month-select" aria-label="בחירת חודש" value={d.status.month} onChange={(e) => setMonth(e.target.value)}>
              {d.availableMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          )}
          <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="הגדרות, נגישות וסידור המסך">⚙</button>
        </header>

        <nav className="tabbar" aria-label="מסכים">
          {SCREENS.map((id) => (
            <button key={id} className="tab" aria-current={screen === id ? 'page' : undefined} onClick={() => go(id)}>
              {TAB_ICON[id]}<span>{SCREEN_LABEL[id]}</span>
            </button>
          ))}
        </nav>

        {error && <div className="banner" role="alert">לא הצלחנו לטעון את הנתונים: {error} <button className="link-btn" onClick={() => load()}>לנסות שוב</button></div>}
        {!d && !error && <div className="empty" role="status">טוען…</div>}

        {d && ctx && (
          <main id="main">
            <h2 className="sr">{SCREEN_LABEL[screen]}</h2>
            {isSample() && <div className="banner">אלה נתוני דוגמה, לא הנתונים האמיתיים שלכם. אפשר לנסות כאן הכול בחופשיות.</div>}
            {editing && (
              <div className="edit-banner" role="region" aria-label="מצב סידור">
                <p><b>מצב סידור.</b> אפשר להזיז כל חלק למעלה ולמטה, להעביר אותו למסך אחר או להסתיר אותו. שום נתון לא נמחק.</p>
                <button className="tool-btn" onClick={() => change(normalize({ screens: DEFAULT_LAYOUT, hidden: [] }))}>איפוס לברירת המחדל</button>
                <button className="tool-btn" onClick={() => setEditing(false)}>סיום</button>
              </div>
            )}

            {widgets.map((id, i) => {
              const w = WIDGETS[id]!;
              const body = w.render(ctx);
              if (!editing) return body === null ? null : <div className="widget" key={id}>{body}</div>;
              return (
                <div className="widget" data-edit="true" key={id}>
                  <div className="widget-tools" role="group" aria-label={`סידור: ${w.name}`}>
                    <span className="name">{w.name}</span>
                    <button className="tool-btn small" disabled={i === 0} onClick={() => change(move(layout, id, -1))} aria-label={`הזזת ${w.name} למעלה`}>▲ למעלה</button>
                    <button className="tool-btn small" disabled={i === widgets.length - 1} onClick={() => change(move(layout, id, 1))} aria-label={`הזזת ${w.name} למטה`}>▼ למטה</button>
                    <select aria-label={`העברת ${w.name} למסך אחר`} value={screen} onChange={(e) => { change(sendTo(layout, id, e.target.value as ScreenId)); say(`הועבר למסך ${SCREEN_LABEL[e.target.value as ScreenId]}`); }}>
                      {SCREENS.map((s) => <option key={s} value={s}>{s === screen ? 'במסך הזה' : `להעביר ל${SCREEN_LABEL[s]}`}</option>)}
                    </select>
                    <button className="tool-btn small" onClick={() => change(hide(layout, id))} aria-label={`הסתרת ${w.name}`}>הסתרה</button>
                  </div>
                  <div className="widget-body" aria-hidden>{body ?? <div className="empty">אין כרגע נתונים להצגה בחלק הזה.</div>}</div>
                </div>
              );
            })}

            {editing && layout.hidden.length > 0 && (
              <section className="section" style={{ marginTop: '1rem' }}>
                <header><h2>חלקים מוסתרים</h2></header>
                <div className="body rows">
                  {layout.hidden.map((id) => (
                    <div className="row" key={id}><span className="name">{WIDGETS[id]!.name}</span>
                      <button className="tool-btn small" onClick={() => change(sendTo(layout, id, screen))}>להציג במסך הזה</button></div>
                  ))}
                </div>
              </section>
            )}
            {!editing && widgets.length === 0 && <div className="empty">המסך הזה ריק. אפשר להוסיף אליו חלקים דרך ⚙ ← סידור המסכים.</div>}

            <p className="foot">
              עודכן {ago(d.sync.lastSyncAt)}
              {d.sync.tokenExpiresInDays !== undefined && <> · החיבור לרייזאפ בתוקף לעוד {Math.max(d.sync.tokenExpiresInDays, 0)} ימים</>}
              <br /><button className="link-btn" onClick={() => setSheet('glossary')}>מילון מונחים והסברים</button>
            </p>
          </main>
        )}
      </div>

      {d && !sheet && !detail && !term && !editing && <button className="fab" onClick={() => setSheet('chat')} aria-label="שאלו את העוזר הפיננסי">💬 <span>שאלו אותי</span></button>}
      {sheet === 'chat' && d && <Chat month={d.status.month} onClose={() => setSheet(undefined)} />}

      {term && <TermSheet term={term} onClose={() => setTerm(undefined)} onGlossary={() => { setTerm(undefined); setSheet('glossary'); }} />}

      {sheet === 'settings' && (
        <Sheet title="הגדרות" onClose={() => setSheet(undefined)}>
          <div className="field">
            <label id="ts">גודל הטקסט</label>
            <div className="actions" role="group" aria-labelledby="ts">
              {TEXT_SIZES.map((s) => <button key={s.id} className="tool-btn" aria-pressed={size === s.id} onClick={() => setSize(s.id)}>{s.label}</button>)}
            </div>
          </div>
          <div className="field">
            <label id="th">תצוגה</label>
            <div className="actions" role="group" aria-labelledby="th">
              <button className="tool-btn" aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggle()}>☀ בהירה</button>
              <button className="tool-btn" aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggle()}>☾ כהה</button>
            </div>
          </div>
          <div className="field">
            <label>סידור המסכים</label>
            <span className="hint">להזיז חלקים, להעביר אותם בין מסכים או להסתיר. הסידור אישי לכל אחד מכם, ונשמר גם בטלפון וגם במחשב.</span>
            <button className="tool-btn primary" onClick={() => { setEditing(true); setSheet(undefined); }}>לסדר את המסך הנוכחי</button>
          </div>
          <button className="tool-btn" style={{ width: '100%' }} onClick={() => setSheet('glossary')}>מילון מונחים והסברים</button>
          {d && !isSample() && <p className="explain" style={{ marginTop: '1rem' }}>מחוברים בתור {d.user.email}</p>}
        </Sheet>
      )}

      {sheet === 'glossary' && (
        <Sheet title="מילון מונחים והסברים" onClose={() => setSheet(undefined)}>
          <dl className="glossary">
            {Object.values(GLOSSARY).map((t) => (<div key={t.title}><dt>{t.title}</dt><dd><b>{t.short}</b> {t.long}</dd></div>))}
          </dl>
        </Sheet>
      )}

      {detail && d && (
        <DetailSheet key={detail.kind === 'txn' ? detail.t.transactionId : detail.kind} detail={detail} d={d} open={setDetail} onClose={() => setDetail(undefined)}
          editor={(t) => <TxnEditor t={t} categories={d.categoryNames}
            onSave={async (o) => { try { await saveOverride({ transactionId: t.transactionId, ...o }); setDetail(undefined); await load(); say('נשמר. השינוי שלכם לא יושפע מרייזאפ'); } catch (e) { say((e as Error).message); } }} />} />
      )}

      <div aria-live="polite" role="status">{toast && <div className="toast">{toast}</div>}</div>
    </InfoProvider>
  );
}

const NEW = '__new__';

// The part of a transaction the family can change. It lives in our own layer.
function TxnEditor({ t, categories, onSave }: { t: ViewTransaction; categories: string[]; onSave: (o: { category?: string; note?: string }) => void }) {
  const source = t.sourceCategory ?? t.categoryLabel ?? 'אחר';
  const [cat, setCat] = useState(t.categoryLabel ?? 'אחר');
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState(t.note ?? '');
  const chosen = cat === NEW ? custom.trim() : cat;
  const options = [...new Set([source, ...categories])];
  const movable = !t.isIncome && !t.excluded && t.envelopeType !== 'fixed';

  return (
    <>
      {movable && (
        <div className="field">
          <label htmlFor="cat">הקטגוריה אצלנו</label>
          <span className="hint">ההעברה נשמרת אצלנו בלבד. היא לא משנה דבר ברייזאפ, ורייזאפ לא ידרוס אותה.</span>
          <select id="cat" value={cat} onChange={(e) => setCat(e.target.value)}>
            {options.map((c) => <option key={c} value={c}>{c}{c === source ? ' (כמו ברייזאפ)' : ''}</option>)}
            <option value={NEW}>קטגוריה חדשה…</option>
          </select>
          {cat === NEW && <input aria-label="שם הקטגוריה החדשה" placeholder="שם הקטגוריה החדשה" maxLength={60} value={custom} onChange={(e) => setCustom(e.target.value)} />}
        </div>
      )}
      <div className="field">
        <label htmlFor="note">הערה</label>
        <textarea id="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: מתנה ליום הולדת של סבתא" />
      </div>
      <div className="actions">
        <button className="tool-btn primary" disabled={cat === NEW && !chosen} onClick={() => onSave({ category: movable && chosen && chosen !== source ? chosen : undefined, note: note.trim() || undefined })}>שמירה</button>
        {(t.sourceCategory || t.note) && <button className="tool-btn" onClick={() => onSave({})}>ביטול השינויים שלנו</button>}
      </div>
    </>
  );
}
