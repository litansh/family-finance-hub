import type { Alert } from '@hub/core';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY, type TermId } from '../lib/glossary.ts';

// ---- Sheet: an accessible bottom dialog -------------------------------------

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, select, input, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]')].filter((el) => !el.hasAttribute('disabled'));
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; opener?.focus(); };
  }, [onClose]);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose} aria-label="סגירה">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ---- Explanations ------------------------------------------------------------

const InfoCtx = createContext<(id: TermId) => void>(() => {});
export const InfoProvider = InfoCtx.Provider;

export function Info({ term }: { term: TermId }) {
  const open = useContext(InfoCtx);
  return <button type="button" className="info-btn" onClick={(e) => { e.stopPropagation(); open(term); }} aria-label={`הסבר: ${GLOSSARY[term].title}`}>?</button>;
}

export function TermSheet({ term, onClose, onGlossary }: { term: TermId; onClose: () => void; onGlossary: () => void }) {
  const t = GLOSSARY[term];
  return (
    <Sheet title={t.title} onClose={onClose}>
      <p className="lead">{t.short}</p>
      <p>{t.long}</p>
      <button className="link-btn" onClick={onGlossary}>לכל המונחים וההסברים</button>
    </Sheet>
  );
}

// ---- Building blocks ---------------------------------------------------------

export function Section(p: { title: string; term?: TermId; hint?: ReactNode; note?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(p.defaultOpen ?? true);
  return (
    <section className="section" data-open={open}>
      <header>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minHeight: '2.75rem', textAlign: 'start' }}>
          <h2>{p.title}</h2>
          {p.hint != null && <span className="hint">{p.hint}</span>}
          <span className="chev" aria-hidden>›</span>
          <span className="sr">{open ? 'לחצו לכיווץ' : 'לחצו להרחבה'}</span>
        </button>
        {p.term && <Info term={p.term} />}
      </header>
      {open && (
        <div className="body">
          {p.note && <p className="note">{p.note}</p>}
          {p.children}
        </div>
      )}
    </section>
  );
}

export function Tile(p: { caption: string; term?: TermId; value: ReactNode; sub?: ReactNode; explain?: string }) {
  return (
    <div className="tile">
      <div className="caption"><span>{p.caption}</span>{p.term && <Info term={p.term} />}</div>
      <div className="value">{p.value}</div>
      {p.sub != null && <div className="sub">{p.sub}</div>}
      {p.explain && <p className="explain">{p.explain}</p>}
    </div>
  );
}

const SEV_LABEL: Record<Alert['severity'], string> = { critical: 'דחוף', warning: 'לתשומת לב', info: 'לידיעה' };

export function AlertList({ alerts, limit }: { alerts: Alert[]; limit?: number }) {
  const [all, setAll] = useState(false);
  if (alerts.length === 0) return <div className="empty">אין כרגע שום דבר שדורש טיפול. 👍</div>;
  const shown = all || !limit ? alerts : alerts.slice(0, limit);
  return (
    <>
      <ul className="alerts" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((a) => (
          <li className="alert" data-sev={a.severity} key={a.id}>
            <span className="ico" aria-hidden>{a.severity === 'info' ? 'i' : '!'}</span>
            <div>
              <div className="title"><span className="sr">{SEV_LABEL[a.severity]}: </span>{a.title}</div>
              <div className="detail">{a.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      {limit && alerts.length > limit && !all && <button className="more" onClick={() => setAll(true)}>הצגת כל {alerts.length} ההתראות</button>}
    </>
  );
}

const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
export const Icons = {
  home: svg(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>),
  month: svg(<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  trends: svg(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>),
  recurring: svg(<><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" /><path d="M4 20v-4h4" /></>),
  variable: svg(<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.7 12.4a1.500 1.500 0 0 0 1.500 1.200h8.300a1.500 1.500 0 0 0 1.500-1.200L21 7H6" /></>),
  recos: svg(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.800 1-2.5A6 6 0 0 0 12 3z" /></>),
};
