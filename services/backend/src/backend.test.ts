import { sampleData } from '@hub/core';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { handle, type ApiDeps } from './api.ts';
import type { Riseup } from './riseup.ts';
import { RiseupAuthError } from './riseup.ts';
import { keys, MemoryStore, type Meta } from './store.ts';
import { runSync } from './sync.ts';

const TODAY = '2026-09-18';
const sample = sampleData(TODAY);

const fakeRiseup = (fail?: Error): Riseup => ({
  async budget(m) {
    if (fail) throw fail;
    const b = sample.budgets.get(m === 'current' ? sample.current : m);
    if (!b) throw new Error('no such month');
    return { ...b, _meta: { tokenRef: 'secret-ref' } } as never;
  },
  async transactions(m) {
    return { transactions: sample.transactions.filter((t) => t.cashflowDate === m) };
  },
  async close() {},
});

let sign: (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string }) => Promise<string>;
let deps: ApiDeps;
const store = new MemoryStore();

const event = (path: string, token?: string, query?: Record<string, string>, method = 'GET', body?: unknown) =>
  ({ body: body === undefined ? undefined : JSON.stringify(body), rawPath: path, headers: token ? { 'cf-access-jwt-assertion': token } : {}, queryStringParameters: query, requestContext: { http: { method } } }) as never;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  sign = (claims, o = {}) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(o.iss ?? 'https://team.cloudflareaccess.com').setAudience(o.aud ?? 'aud-tag').setExpirationTime('1h').sign(privateKey);
  deps = { store, access: { teamDomain: 'team.cloudflareaccess.com', audience: 'aud-tag', allowedEmails: ['alex@example.com', 'noa@example.com'], keys: jwks },
    tokenExpiresAt: '2026-09-23', now: () => new Date(`${TODAY}T10:00:00Z`) };
});

describe('sync', () => {
  it('stores requested months and strips the token reference', async () => {
    const out = await runSync(fakeRiseup(), store, { monthsBack: 3, now: new Date(`${TODAY}T04:00:00Z`) });
    expect(out.synced).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
    expect([...store.data.values()].join('')).not.toContain('secret-ref');
    expect((await store.get<Meta>(keys.meta))!.lastError).toBeNull();
  });

  it('skips months RiseUp has nothing for', async () => {
    const s = new MemoryStore();
    const out = await runSync(fakeRiseup(), s, { monthsBack: 30 });
    expect(out.synced).toHaveLength(12);
  });

  it('records a rejected token without losing earlier data', async () => {
    await expect(runSync(fakeRiseup(new RiseupAuthError('401')), store, { monthsBack: 1 })).rejects.toThrow();
    const meta = (await store.get<Meta>(keys.meta))!;
    expect(meta.lastError).toMatch(/token/);
    expect(meta.months).toHaveLength(4);
    await runSync(fakeRiseup(), store, { monthsBack: 3, now: new Date(`${TODAY}T04:00:00Z`) });
  });
});

describe('api access', () => {
  it('rejects a missing, foreign-audience, foreign-issuer or unlisted token', async () => {
    const cases = [
      undefined,
      'not-a-jwt',
      await sign({ email: 'alex@example.com' }, { aud: 'other-app' }),
      await sign({ email: 'alex@example.com' }, { iss: 'https://evil.cloudflareaccess.com' }),
      await sign({ email: 'stranger@example.com' }),
      await sign({}),
    ];
    for (const t of cases) expect((await handle(event('/api/dashboard', t), deps) as { statusCode: number }).statusCode).toBe(403);
  });

  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256');
    const t = await new SignJWT({ email: 'alex@example.com' }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://team.cloudflareaccess.com').setAudience('aud-tag').setExpirationTime('1h').sign(other.privateKey);
    expect((await handle(event('/api/dashboard', t), deps) as { statusCode: number }).statusCode).toBe(403);
  });

  it('serves both family members, case-insensitively', async () => {
    for (const email of ['alex@example.com', 'Noa@Example.com']) {
      const r = await handle(event('/api/me', await sign({ email })), deps) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).email).toBe(email.toLowerCase());
    }
  });
});

describe('api dashboard', () => {
  it('builds the dashboard from stored months', async () => {
    const r = await handle(event('/api/dashboard', await sign({ email: 'alex@example.com' })), deps) as { statusCode: number; body: string; headers: Record<string, string> };
    const d = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toContain('no-store');
    expect(d.status.month).toBe('2026-09');
    expect(d.sync).toMatchObject({ source: 'riseup', tokenExpiresInDays: 5 });
    expect(d.availableMonths).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
  });

  it('serves an earlier month without leaking later transactions into it', async () => {
    const r = await handle(event('/api/dashboard', await sign({ email: 'alex@example.com' }), { month: '2026-07' }), deps) as { body: string };
    const d = JSON.parse(r.body);
    expect(d.status.month).toBe('2026-07');
    expect(d.months.at(-1).month).toBe('2026-07');
  });

  it('validates input and method', async () => {
    const t = await sign({ email: 'alex@example.com' });
    expect((await handle(event('/api/dashboard', t, { month: '../meta' }), deps) as { statusCode: number }).statusCode).toBe(400);
    expect((await handle(event('/api/dashboard', t, undefined, 'POST'), deps) as { statusCode: number }).statusCode).toBe(405);
    expect((await handle(event('/api/dashboard', t, undefined, 'DELETE'), deps) as { statusCode: number }).statusCode).toBe(405);
    expect((await handle(event('/api/other', t), deps) as { statusCode: number }).statusCode).toBe(404);
  });

  it('says so when nothing has synced yet', async () => {
    const r = await handle(event('/api/dashboard', await sign({ email: 'alex@example.com' })), { ...deps, store: new MemoryStore() }) as { statusCode: number };
    expect(r.statusCode).toBe(503);
  });
});

describe('the hub keeps its own data', () => {
  const put = async (path: string, body: unknown, email = 'alex@example.com') =>
    handle(event(path, await sign({ email }), undefined, 'PUT', body), deps) as Promise<{ statusCode: number; body: string }>;
  const dashboard = async (email = 'alex@example.com') =>
    JSON.parse((await handle(event('/api/dashboard', await sign({ email })), deps) as { body: string }).body);

  it('keeps a transaction RiseUp stopped returning, outside the totals', async () => {
    const before = await dashboard();
    const victim = before.transactions.find((t: { isIncome: boolean }) => !t.isIncome);
    const partial: Riseup = { ...fakeRiseup(), async transactions(m) {
      return { transactions: sample.transactions.filter((t) => t.cashflowDate === m && t.transactionId !== victim.transactionId) };
    } };
    await runSync(partial, store, { monthsBack: 0, now: new Date(`${TODAY}T05:00:00Z`) });
    const after = await dashboard();
    expect(after.removed.map((t: { transactionId: string }) => t.transactionId)).toEqual([victim.transactionId]);
    expect(after.transactions).toHaveLength(before.transactions.length - 1);
    await runSync(fakeRiseup(), store, { monthsBack: 0, now: new Date(`${TODAY}T06:00:00Z`) });
    expect((await dashboard()).removed).toHaveLength(0);
  });

  it('applies a category move for both of us and survives the next sync', async () => {
    const tx = (await dashboard()).transactions.find((t: { categoryLabel: string }) => t.categoryLabel === 'מסעדות');
    expect((await put('/api/override', { transactionId: tx.transactionId, category: 'ילדים', note: 'יום הולדת' })).statusCode).toBe(200);
    await runSync(fakeRiseup(), store, { monthsBack: 1, now: new Date(`${TODAY}T07:00:00Z`) });
    const seen = (await dashboard('noa@example.com')).transactions.find((t: { transactionId: string }) => t.transactionId === tx.transactionId);
    expect(seen).toMatchObject({ categoryLabel: 'ילדים', sourceCategory: 'מסעדות', note: 'יום הולדת' });
    // Clearing it hands the transaction back to RiseUp's category.
    await put('/api/override', { transactionId: tx.transactionId });
    expect((await dashboard()).transactions.find((t: { transactionId: string }) => t.transactionId === tx.transactionId).categoryLabel).toBe('מסעדות');
  });

  it('keeps layouts personal and recommendation statuses shared', async () => {
    await put('/api/layout', { home: ['hero', 'alerts'] }, 'alex@example.com');
    await put('/api/reco', { id: 'loans:consolidate', status: 'done' }, 'noa@example.com');
    const alex = await dashboard('alex@example.com');
    const noa = await dashboard('noa@example.com');
    expect(alex.user.layout).toEqual({ home: ['hero', 'alerts'] });
    expect(noa.user.layout).toBeNull();
    expect(alex.user.reco['loans:consolidate']).toMatchObject({ status: 'done', updatedBy: 'noa@example.com' });
  });

  it('shares what-if plans between both of us', async () => {
    expect((await put('/api/plans', { plans: [{ id: 'default', name: 'x', events: [], startBalance: 0, floor: 0 }] }, 'noa@example.com')).statusCode).toBe(200);
    expect((await dashboard('alex@example.com')).user.plans).toMatchObject({ plans: [{ id: 'default' }], updatedBy: 'noa@example.com' });
    expect((await put('/api/plans', { plans: 'nope' })).statusCode).toBe(400);
  });

  it('moves budget between categories for both of us, keeps every shift, and undoes by adding one', async () => {
    const before = await dashboard();
    const month = before.status.month;
    const [a, b] = before.status.envelopes.filter((e: { kind: string }) => e.kind === 'tracked') as { label: string; planned: number }[];
    expect((await put('/api/shift', { month, from: a!.label, to: b!.label, amount: 120, reason: 'נעליים' }, 'noa@example.com')).statusCode).toBe(200);
    const after = await dashboard('alex@example.com');
    const planned = (d: typeof after, l: string) => d.status.envelopes.find((e: { kind: string; label: string }) => e.kind === 'tracked' && e.label === l).planned;
    expect(planned(after, a!.label)).toBeCloseTo(a!.planned - 120);
    expect(planned(after, b!.label)).toBeCloseTo(b!.planned + 120);
    expect(after.shifts).toMatchObject([{ from: a!.label, to: b!.label, amount: 120, by: 'noa@example.com', reason: 'נעליים' }]);
    expect(after.status.flexible.left).toBeCloseTo(before.status.flexible.left);

    await put('/api/shift', { month, from: b!.label, to: a!.label, amount: 120 });
    const undone = await dashboard();
    expect(planned(undone, a!.label)).toBeCloseTo(a!.planned);
    expect(undone.shifts).toHaveLength(2); // nothing is deleted

    for (const bad of [{ month, from: a!.label, to: a!.label, amount: 5 }, { month, from: a!.label, to: b!.label, amount: 0 }, { month: '2026-9', from: a!.label, to: b!.label, amount: 5 }, { month, from: a!.label, to: b!.label, amount: 'lots' }])
      expect((await put('/api/shift', bad)).statusCode).toBe(400);
  });

  it('lets either of us commit to a monthly amount for a category, and withdraw it', async () => {
    const before = await dashboard();
    const e = before.status.envelopes.find((x: { kind: string }) => x.kind === 'tracked') as { label: string; planned: number };
    expect((await put('/api/commitment', { label: e.label, amount: 4321 }, 'noa@example.com')).statusCode).toBe(200);
    const after = await dashboard('alex@example.com');
    expect(after.status.envelopes.find((x: { label: string }) => x.label === e.label)).toMatchObject({ planned: 4321, committed: true });
    expect(after.free.committed).toMatchObject([{ label: e.label, amount: 4321 }]);
    expect((await put('/api/commitment', { label: e.label, amount: null })).statusCode).toBe(200);
    expect((await dashboard()).free.committed).toEqual([]);
    for (const bad of [{ amount: 5 }, { label: e.label, amount: -1 }, { label: e.label, amount: 'x' }, { label: 'x'.repeat(61), amount: 5 }])
      expect((await put('/api/commitment', bad)).statusCode).toBe(400);
  });

  it('never lets a write touch RiseUp data or escape user/', async () => {
    const before = [...store.data.keys()].filter((k) => !k.startsWith('user/')).map((k) => [k, store.data.get(k)]);
    await put('/api/override', { transactionId: 'x', category: 'a' });
    await put('/api/layout', { a: 1 });
    expect([...store.data.keys()].filter((k) => !k.startsWith('user/')).map((k) => [k, store.data.get(k)])).toEqual(before);
  });

  it('rejects malformed and oversized writes, and writes without a login', async () => {
    expect((await put('/api/override', { transactionId: '../meta', category: 'x' })).statusCode).toBe(400);
    expect((await put('/api/override', { transactionId: 'ok', category: 'x'.repeat(61) })).statusCode).toBe(400);
    expect((await put('/api/reco', { id: 'a', status: 'paid' })).statusCode).toBe(400);
    expect((await put('/api/layout', ['not', 'an', 'object'])).statusCode).toBe(400);
    expect((await put('/api/layout', { big: 'x'.repeat(30_000) })).statusCode).toBe(400);
    expect((await put('/api/nope', {})).statusCode).toBe(404);
    expect((await handle(event('/api/layout', undefined, undefined, 'PUT', {}), deps) as { statusCode: number }).statusCode).toBe(403);
  });
});
