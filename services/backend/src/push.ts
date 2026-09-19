import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { keys, S3Store, type Store } from './store.ts';
import { BadRequest } from './userdata.ts';

// Phone notifications. The notification only says the daily brief is ready: no
// amount, no business name. The figures appear after the hub itself is opened,
// behind the same login as everything else.

export interface PushSubscriptionJson { endpoint: string; keys: { p256dh: string; auth: string } }
export interface StoredSubscription { email: string; subscription: PushSubscriptionJson; createdAt: string; lastOkAt?: string; goneAt?: string; lastError?: string }
export type Subscriptions = Record<string, StoredSubscription>; // by hash of the endpoint

// The Lambda posts to whatever endpoint is stored, so only the browsers' own
// push services are accepted. Anything else would let a signed-in user point
// this function at an arbitrary URL.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const idOf = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

function parse(body: unknown): PushSubscriptionJson {
  const s = ((body ?? {}) as { subscription?: unknown }).subscription as Partial<PushSubscriptionJson> | undefined;
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new BadRequest('subscription.endpoint must be a URL'); }
  if (url.protocol !== 'https:' || endpoint.length > 1000 || !PUSH_HOSTS.some((h) => h.test(url.hostname))) throw new BadRequest('subscription.endpoint is not a known push service');
  const p256dh = s?.keys?.p256dh, auth = s?.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100 || !/^[\w-]+=*$/.test(p256dh) || !/^[\w-]+=*$/.test(auth)) throw new BadRequest('subscription.keys are malformed');
  return { endpoint, keys: { p256dh, auth } };
}

// Each phone subscribes for itself; the same phone subscribing again just refreshes its entry.
export async function savePush(store: Store, email: string, body: unknown, now: string) {
  const all = (await store.get<Subscriptions>(keys.push)) ?? {};
  if ((body as { remove?: unknown } | null)?.remove === true) {
    const endpoint = String((body as { endpoint?: unknown }).endpoint ?? '');
    const hit = all[idOf(endpoint)];
    if (hit && hit.email === email) { hit.goneAt = now; hit.lastError = 'turned off by the user'; await store.put(keys.push, all); }
    return { subscribed: false };
  }
  const subscription = parse(body);
  if (Object.values(all).filter((s) => !s.goneAt).length >= 40) throw new BadRequest('too many devices subscribed');
  all[idOf(subscription.endpoint)] = { email, subscription, createdAt: all[idOf(subscription.endpoint)]?.createdAt ?? now, lastOkAt: all[idOf(subscription.endpoint)]?.lastOkAt };
  await store.put(keys.push, all);
  return { subscribed: true };
}

export async function pushStatus(store: Store, email: string) {
  const all = (await store.get<Subscriptions>(keys.push)) ?? {};
  return { publicKey: process.env.VAPID_PUBLIC_KEY ?? '', devices: Object.values(all).filter((s) => s.email === email && !s.goneAt).length };
}

export type Sender = (sub: PushSubscriptionJson, payload: string) => Promise<void>;

const viaWebPush: Sender = async (sub, payload) => {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hub@localhost', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  // Kept for half a day: a brief that arrives the next evening is noise.
  await webpush.sendNotification(sub, payload, { TTL: 12 * 3600, urgency: 'normal' });
};

// Sends the same figure-free notice to every live device. A push service answers
// 404 or 410 once a subscription is dead; that device is marked, never retried,
// and re-subscribes by itself the next time the hub is opened on it.
export async function sendToAll(store: Store, notice: { title: string; body: string; url: string }, now: string, send: Sender = viaWebPush, only?: string) {
  const all = (await store.get<Subscriptions>(keys.push)) ?? {};
  const live = Object.entries(all).filter(([, s]) => !s.goneAt && (!only || s.email === only));
  let sent = 0, gone = 0, failed = 0;
  for (const [, s] of live) {
    try { await send(s.subscription, JSON.stringify(notice)); s.lastOkAt = now; delete s.lastError; sent++; }
    catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) { s.goneAt = now; gone++; } else failed++;
      s.lastError = `push service answered ${status ?? (e as Error).name}`;
    }
  }
  if (live.length) await store.put(keys.push, all);
  return { devices: live.length, sent, gone, failed };
}

// Invoked every morning by the scheduler, and on demand from CI with {test:true}.
export async function handler(event: { test?: boolean } = {}, deps: { store?: Store; send?: Sender; now?: () => Date } = {}) {
  if (!deps.send && (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)) return { skipped: 'push keys are not configured' };
  const store = deps.store ?? new S3Store(process.env.DATA_BUCKET!);
  const now = (deps.now?.() ?? new Date()).toISOString();
  const notice = event.test
    ? { title: 'הכספים שלנו', body: 'בדיקה: ההתראות פועלות בטלפון הזה.', url: '/' }
    : { title: 'הכספים שלנו', body: 'הסיכום היומי מוכן. הקישו כדי לראות.', url: '/?brief=1' };
  // Counts only: never an address, never a figure.
  return sendToAll(store, notice, now, deps.send);
}
