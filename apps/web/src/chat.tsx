import { useEffect, useRef, useState } from 'react';
import { Sheet } from './components/ui.tsx';
import { askAssistant, isSample, type ChatTurn } from './lib/data.ts';

const SUGGESTIONS = [
  'איך אנחנו עומדים החודש?',
  'על מה הוצאנו הכי הרבה בשלושת החודשים האחרונים?',
  'אילו הוצאות קבועות הכי כדאי לנסות להוזיל?',
  'אם ניקח הלוואה של 100,000 ₪ לחמש שנים ונסגור את ההלוואות הקיימות, כמה נוכל להוציא ביום?',
  'מה יקרה אם אקבל בונוס של 40,000 ₪ בינואר והעלאה של 3,000 ₪ בחודש?',
];
const KEY = 'hub:chat';

export function Chat({ month, onClose }: { month: string; onClose: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; } });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-30))); } catch { /* private mode */ } end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history = turns;
    setTurns([...history, { role: 'user', text: question }]);
    setText('');
    setBusy(true);
    try {
      const answer = await askAssistant(question, history, month);
      setTurns((t) => [...t, { role: 'assistant', text: answer }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `⚠️ ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="שאלו את העוזר" onClose={onClose}>
      <p className="explain" style={{ marginTop: '-0.5rem' }}>העוזר עונה רק מתוך הנתונים שלכם, ויודע גם להריץ תחזיות "מה אם". הוא לא יועץ פיננסי מורשה.</p>
      {isSample() && <p className="banner">במצב נתוני דוגמה העוזר לא פעיל.</p>}
      <div className="chat" role="log" aria-live="polite" aria-label="השיחה">
        {turns.length === 0 && (
          <div className="rows">
            {SUGGESTIONS.map((s) => <button type="button" key={s} className="row tap" disabled={busy || isSample()} onClick={() => ask(s)}><span className="name" style={{ whiteSpace: 'normal' }}>{s}</span></button>)}
          </div>
        )}
        {turns.map((t, i) => <div key={i} className={`bubble ${t.role}`}><span className="sr">{t.role === 'user' ? 'אתם: ' : 'העוזר: '}</span>{t.text}</div>)}
        {busy && <div className="bubble assistant" role="status">בודק בנתונים שלכם… זה יכול לקחת עד דקה.</div>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <label className="sr" htmlFor="q">השאלה שלכם</label>
        <textarea id="q" rows={2} maxLength={2000} value={text} placeholder="למשל: כמה הוצאנו על אוכל בחוץ השנה?" disabled={isSample()}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text); } }} />
        <button className="tool-btn primary" type="submit" disabled={busy || !text.trim() || isSample()}>שליחה</button>
      </form>
      {turns.length > 0 && <button className="link-btn" onClick={() => setTurns([])}>שיחה חדשה</button>}
    </Sheet>
  );
}
