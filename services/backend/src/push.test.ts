import { describe, expect, it } from 'vitest';
import { handler, pushStatus, savePush, sendToAll, type Sender, type Subscriptions } from './push.ts';
import { keys, MemoryStore } from './store.ts';

const sub = (n: number, host = 'web.push.apple.com') => ({ subscription: { endpoint: `https://${host}/Q${n}abc`, keys: { p256dh: 'BPk_x-Y1', auth: 'a_b-C2' } } });
const now = '2026-09-19T05:00:00Z';

describe('phone notifications', () => {
  it('accepts a phone, refreshes it on repeat, and keeps each person to their own devices', async () => {
    const store = new MemoryStore();
    await savePush(store, 'alex@example.com', sub(1), now);
    await savePush(store, 'alex@example.com', sub(1), '2026-09-20T05:00:00Z'); // same phone again
    await savePush(store, 'noa@example.com', sub(2, 'fcm.googleapis.com'), now);
    expect(Object.keys((await store.get<Subscriptions>(keys.push))!)).toHaveLength(2);
    expect((await pushStatus(store, 'alex@example.com')).devices).toBe(1);

    // Turning off someone else's phone does nothing.
    await savePush(store, 'noa@example.com', { remove: true, endpoint: sub(1).subscription.endpoint }, now);
    expect((await pushStatus(store, 'alex@example.com')).devices).toBe(1);
    await savePush(store, 'alex@example.com', { remove: true, endpoint: sub(1).subscription.endpoint }, now);
    expect((await pushStatus(store, 'alex@example.com')).devices).toBe(0);
  });

  it('only ever posts to a real push service', async () => {
    const store = new MemoryStore();
    for (const bad of [sub(1, 'evil.example.com'), sub(1, 'push.apple.com.evil.io'), { subscription: { endpoint: 'http://web.push.apple.com/x', keys: { p256dh: 'a', auth: 'b' } } }, { subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'a b', auth: 'b' } } }, { subscription: { endpoint: 'https://169.254.169.254/latest', keys: { p256dh: 'a', auth: 'b' } } }, {}])
      await expect(savePush(store, 'alex@example.com', bad, now)).rejects.toThrow();
    expect(await store.get(keys.push)).toBeUndefined();
  });

  it('sends a notice with no figures, retires a dead phone, and keeps a flaky one', async () => {
    const store = new MemoryStore();
    await savePush(store, 'alex@example.com', sub(1), now);
    await savePush(store, 'noa@example.com', sub(2), now);
    await savePush(store, 'noa@example.com', sub(3), now);
    const seen: string[] = [];
    const send: Sender = async (s, payload) => {
      seen.push(payload);
      if (s.endpoint.includes('Q2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (s.endpoint.includes('Q3')) throw Object.assign(new Error('busy'), { statusCode: 503 });
    };
    const out = await handler({}, { store, send, now: () => new Date(now) });
    expect(out).toEqual({ devices: 3, sent: 1, gone: 1, failed: 1 });
    for (const p of seen) { expect(p).not.toMatch(/[₪\d]{3,}/); expect(JSON.parse(p)).toMatchObject({ url: '/?brief=1' }); }

    const again = await sendToAll(store, { title: 't', body: 'b', url: '/' }, now, async () => undefined);
    expect(again).toMatchObject({ devices: 2, sent: 2 }); // the dead one is not retried, the flaky one is
    expect(JSON.parse(seen[0]!).body).not.toContain('example.com');
  });

  it('does nothing, quietly, until the keys exist', async () => {
    expect(await handler({}, { store: new MemoryStore() })).toEqual({ skipped: 'push keys are not configured' });
  });
});
