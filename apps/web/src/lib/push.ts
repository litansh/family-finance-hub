import { isSample } from './data.ts';

// Phone notifications for the daily brief. iOS delivers them only to a web app
// that was added to the Home Screen, and only after the person taps a button.

export type PushState = 'unsupported' | 'needs-home-screen' | 'off' | 'blocked' | 'on' | 'not-configured';

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const toBytes = (base64url: string) => {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function serverKey(): Promise<string> {
  const res = await fetch('/api/push', { credentials: 'same-origin' });
  if (!res.ok) return '';
  return ((await res.json()) as { publicKey?: string }).publicKey ?? '';
}

const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' });

export async function pushState(): Promise<PushState> {
  if (isSample()) return 'unsupported';
  if (!supported()) return isIos() && !standalone() ? 'needs-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function subscribe(): Promise<PushState> {
  const key = await serverKey();
  if (!key) return 'not-configured';
  const reg = await register();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }));
  const res = await fetch('/api/push', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  if (!res.ok) throw new Error(`ההרשמה להתראות נכשלה (${res.status})`);
  return 'on';
}

// Must run from a tap: the permission prompt is only shown for a user gesture.
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  return subscribe();
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remove: true, endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

// iOS sometimes drops a subscription without telling anyone. Whenever the hub
// opens on a phone that already gave permission, the subscription is renewed
// and sent again; the server treats a repeat as a refresh.
export async function healPush(): Promise<void> {
  try { if (!isSample() && supported() && Notification.permission === 'granted') await subscribe(); } catch { /* next open tries again */ }
}
