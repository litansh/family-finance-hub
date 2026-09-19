import { buildDashboard, sampleData, type Dashboard, type Overrides, type Plan } from '@hub/core';

export type RecoStatus = 'open' | 'done' | 'dismissed' | 'snoozed';
export type RecoState = Record<string, { status: RecoStatus; until?: string; updatedBy?: string; updatedAt?: string }>;
export interface HubData extends Dashboard { user: { email: string; layout: unknown; reco: RecoState; plans: { plans: Plan[] } | null } }

const todayIso = () => new Date().toISOString().slice(0, 10);

// Until the sync backend has data the hub runs on generated data. Set
// VITE_DATA_SOURCE=api to read the real thing.
const USE_API = import.meta.env.VITE_DATA_SOURCE === 'api';
let sampleMode = !USE_API;
export const isSample = () => sampleMode;

// In sample mode the family's changes live on this device only, so everything
// can be tried without touching real data.
const local = {
  get<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(`hub:${key}`) ?? 'null') ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(`hub:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};
export const localLayout = { get: () => local.get<unknown>('layout', null), set: (v: unknown) => local.set('layout', v) };

function sampleDashboard(month?: string): HubData {
  const today = todayIso();
  const { transactions, budgets, current } = sampleData(today);
  const budget = budgets.get(month ?? current) ?? budgets.get(current)!;
  const d = buildDashboard({
    budget, transactions, today,
    overrides: local.get<Overrides>('sample-overrides', {}),
    lastSyncAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    tokenExpiresInDays: 6,
    source: 'sample',
  });
  return { ...d, user: { email: 'sample', layout: localLayout.get(), reco: local.get<RecoState>('sample-reco', {}), plans: local.get<{ plans: Plan[] } | null>('sample-plans', null) } };
}

export async function loadDashboard(month?: string): Promise<HubData> {
  if (!USE_API) return sampleDashboard(month);
  const res = await fetch(`/api/dashboard${month ? `?month=${month}` : ''}`, { credentials: 'same-origin' });
  // An expired Cloudflare Access session answers with a login page, not JSON.
  if (res.redirected || !res.headers.get('content-type')?.includes('json')) {
    window.location.reload();
    throw new Error('פג תוקף ההתחברות, מתחברים מחדש…');
  }
  // Deployed but never synced (no RiseUp token yet): keep the hub usable.
  if (res.status === 503) { sampleMode = true; return sampleDashboard(month); }
  if (!res.ok) throw new Error(`שגיאת שרת (${res.status})`);
  sampleMode = false;
  return res.json();
}

async function put(path: string, body: unknown) {
  const res = await fetch(path, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`השמירה נכשלה (${res.status})`);
}

export async function saveLayout(layout: unknown) {
  localLayout.set(layout);
  if (!sampleMode) await put('/api/layout', layout);
}

export async function saveOverride(o: { transactionId: string; category?: string; note?: string }) {
  if (!sampleMode) return put('/api/override', o);
  const all = local.get<Overrides>('sample-overrides', {});
  if (!o.category && !o.note) delete all[o.transactionId];
  else all[o.transactionId] = { category: o.category, note: o.note };
  local.set('sample-overrides', all);
}

export async function saveReco(id: string, status: RecoStatus, until?: string) {
  if (!sampleMode) return put('/api/reco', { id, status, until });
  const all = local.get<RecoState>('sample-reco', {});
  all[id] = { status, until };
  local.set('sample-reco', all);
}

export async function savePlans(plans: Plan[]) {
  if (!sampleMode) return put('/api/plans', { plans });
  local.set('sample-plans', { plans });
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

// The assistant answers in the background; the page polls for the result.
export async function askAssistant(question: string, history: ChatTurn[], month: string): Promise<string> {
  const res = await fetch('/api/ask', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, history: history.slice(-8), month }) });
  if (!res.ok) throw new Error(`לא הצלחנו לשלוח את השאלה (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 1500 : 3000));
    const poll = await fetch(`/api/ask?id=${id}`, { credentials: 'same-origin' });
    if (!poll.ok) continue;
    const job = (await poll.json()) as { status: string; answer?: string; error?: string };
    if (job.status === 'done') return job.answer ?? '';
    if (job.status === 'error') throw new Error(job.error ?? 'משהו השתבש');
  }
  throw new Error('התשובה מתעכבת. נסו שוב בעוד רגע.');
}
