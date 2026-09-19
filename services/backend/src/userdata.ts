import { EVERYDAY, type BudgetShift, type Overrides, type Plan } from '@hub/core';
import { createHash, randomBytes } from 'node:crypto';
import { keys, type Store } from './store.ts';

export type RecoStatus = 'open' | 'done' | 'dismissed' | 'snoozed';
export type RecoState = Record<string, { status: RecoStatus; until?: string; updatedBy: string; updatedAt: string }>;

export class BadRequest extends Error {}

const emailHash = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 32);
const str = (v: unknown, max: number, name: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) throw new BadRequest(`${name} must be text up to ${max} characters`);
  return v;
};

export async function loadUserData(store: Store, email: string) {
  const [overrides, reco, layout, plans, shifts] = await Promise.all([
    store.get<Overrides>(keys.overrides),
    store.get<RecoState>(keys.reco),
    store.get<unknown>(keys.layout(emailHash(email))),
    store.get<{ plans?: Plan[] }>(keys.plans),
    store.get<BudgetShift[]>(keys.shifts),
  ]);
  return { overrides: overrides ?? {}, reco: reco ?? {}, layout: layout ?? null, plans: plans ?? null, shifts: shifts ?? [] };
}

// Layout is personal: each of us arranges our own screens.
export async function saveLayout(store: Store, email: string, body: unknown) {
  const size = JSON.stringify(body ?? null).length;
  if (typeof body !== 'object' || body === null || Array.isArray(body) || size > 20_000) throw new BadRequest('layout must be an object under 20KB');
  await store.put(keys.layout(emailHash(email)), body);
}

// Moves and notes are shared: they describe the household's money, not a screen.
export async function saveOverride(store: Store, email: string, body: unknown, now: string) {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = str(b.transactionId, 200, 'transactionId');
  if (!id || !/^[\w.:@+\-]+$/.test(id)) throw new BadRequest('transactionId is required');
  const category = str(b.category, 60, 'category');
  const note = str(b.note, 500, 'note');
  const all = (await store.get<Overrides>(keys.overrides)) ?? {};
  // Clearing both fields returns the transaction to RiseUp's own category. The
  // earlier value is still in the bucket's version history.
  if (!category && !note) delete all[id];
  else all[id] = { category, note, updatedBy: email, updatedAt: now };
  await store.put(keys.overrides, all);
  return all;
}

export async function saveRecoStatus(store: Store, email: string, body: unknown, now: string) {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = str(b.id, 200, 'id');
  const status = b.status;
  if (!id) throw new BadRequest('id is required');
  if (status !== 'open' && status !== 'done' && status !== 'dismissed' && status !== 'snoozed') throw new BadRequest('unknown status');
  const until = str(b.until, 10, 'until');
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new BadRequest('until must be YYYY-MM-DD');
  const all = (await store.get<RecoState>(keys.reco)) ?? {};
  all[id] = { status, until, updatedBy: email, updatedAt: now };
  await store.put(keys.reco, all);
  return all;
}

// What-if plans are shared: they are the household's assumptions about its future.
export async function savePlans(store: Store, email: string, body: unknown, now: string) {
  const b = body as { plans?: unknown } | null;
  if (!b || !Array.isArray(b.plans) || b.plans.length > 20 || JSON.stringify(b).length > 24_000) throw new BadRequest('plans must be a list of up to 20 plans');
  await store.put(keys.plans, { plans: b.plans, updatedBy: email, updatedAt: now });
}

// Moving budget between categories is shared, and append-only: a shift is never
// edited or removed. To undo one, record the opposite shift.
export async function saveShift(store: Store, email: string, body: unknown, now: string) {
  const b = (body ?? {}) as Record<string, unknown>;
  const month = str(b.month, 7, 'month');
  const from = str(b.from, 60, 'from');
  const to = str(b.to, 60, 'to');
  const amount = typeof b.amount === 'number' && Number.isFinite(b.amount) ? Math.round(b.amount) : NaN;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new BadRequest('month must be YYYY-MM');
  if (!from || !to || from === to) throw new BadRequest('from and to must be two different budgets');
  if (!(amount >= 1 && amount <= 1_000_000)) throw new BadRequest('amount must be between 1 and 1,000,000');
  const all = (await store.get<BudgetShift[]>(keys.shifts)) ?? [];
  if (all.length >= 5000) throw new BadRequest('too many shifts recorded');
  const shift: BudgetShift = { id: randomBytes(8).toString('hex'), month, from, to, amount, reason: str(b.reason, 300, 'reason'), by: email, at: now };
  await store.put(keys.shifts, [...all, shift]);
  return shift;
}
export { EVERYDAY };
