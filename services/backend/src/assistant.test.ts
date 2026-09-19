import { buildDashboard, sampleData } from '@hub/core';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { handle, type ApiDeps } from './api.ts';
import { overview, runForecast, searchTransactions } from './assistant-tools.ts';
import { handler as assistant, type AskJob, type Model } from './assistant.ts';
import { keys, MemoryStore } from './store.ts';
import { runSync } from './sync.ts';

const TODAY = '2026-09-18';
const sample = sampleData(TODAY);
const d = buildDashboard({ budget: sample.budgets.get(sample.current)!, transactions: sample.transactions, today: TODAY, lastSyncAt: null });

describe('assistant tools', () => {
  it('quote the same numbers as the screen', () => {
    const o = overview(d);
    expect(o.variable_expenses.left).toBe(Math.round(d.status.flexible.left));
    expect(o.fixed_expenses.total).toBe(Math.round(d.status.fixed.planned));
    expect(o.last_12_months).toHaveLength(12);
  });

  it('never include what RiseUp keeps out of the cashflow', () => {
    expect(searchTransactions(d, { text: 'חיוב כרטיס אשראי' }).matched).toBe(0);
    const all = searchTransactions(d, { month_from: sample.current, month_to: sample.current, group_by: 'month' });
    const screen = d.transactions.reduce((s, t) => s + t.amount, 0);
    expect(all.total).toBe(Math.round(screen));
  });

  it('group by month, business and category, and split fixed from variable the way RiseUp does', () => {
    const wolt = searchTransactions(d, { text: 'וולט', group_by: 'month' });
    expect(wolt.groups!.length).toBeGreaterThan(3);
    const fixed = searchTransactions(d, { kind: 'fixed', month_from: sample.current, group_by: 'business' });
    expect(fixed.total).toBe(Math.round(d.status.fixed.paid));
    expect(fixed.groups!.some((g) => String(g.business).includes('משכנתא'))).toBe(true);
    expect(searchTransactions(d, { kind: 'variable', category: 'סופר', limit: 3 }).transactions).toHaveLength(3);
  });

  it('run the planner arithmetic: a loan that closes an installment plan, a bonus and a raise', () => {
    const plain = runForecast(d, { start_balance: 5000, floor: -10000 });
    const planned = runForecast(d, { start_balance: 5000, floor: -10000, events: [
      { kind: 'loan', month: '2026-10', amount: 100000, annual_rate_pct: 7, months: 60, closes_installments: ['איקאה'], also_covers: 8000 },
      { kind: 'income-once', month: '2027-01', amount: 40000 }, { kind: 'income-monthly', month: '2026-12', amount: 3000 },
    ] });
    expect(planned.loans[0]).toMatchObject({ closes: 1, monthly_payment: 1980 });
    expect(planned.monthly_payments_freed).toBe(1150);
    expect(planned.total_interest).toBeGreaterThan(18000);
    expect(planned.loan_still_owed_at_end).toBeGreaterThan(50000);
    expect(planned.max_safe_daily_variable_spend).toBeGreaterThan(plain.max_safe_daily_variable_spend);
    expect(planned.without_these_events.end_balance).toBe(plain.end_balance);
  });
});

describe('ask flow', () => {
  const store = new MemoryStore();
  const started: string[] = [];
  let deps: ApiDeps;
  let sign: (email: string) => Promise<string>;
  const ev = (method: string, path: string, token: string, body?: unknown, query?: Record<string, string>) =>
    ({ rawPath: path, headers: { 'cf-access-jwt-assertion': token }, body: body ? JSON.stringify(body) : undefined, queryStringParameters: query, requestContext: { http: { method } } }) as never;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
    sign = (email) => new SignJWT({ email }).setProtectedHeader({ alg: 'RS256' }).setIssuer('https://t.cloudflareaccess.com').setAudience('aud').setExpirationTime('1h').sign(privateKey);
    deps = { store, access: { teamDomain: 't.cloudflareaccess.com', audience: 'aud', allowedEmails: ['alex@example.com', 'noa@example.com'], keys: jwks }, now: () => new Date(`${TODAY}T10:00:00Z`), startAssistant: async (id) => { started.push(id); } };
    await runSync({ budget: async (m) => sample.budgets.get(m === 'current' ? sample.current : m)!, transactions: async (m) => ({ transactions: sample.transactions.filter((t) => t.cashflowDate === m) }), close: async () => {} }, store, { monthsBack: 12, now: new Date(`${TODAY}T04:00:00Z`) });
  });

  it('queues a question, answers it from the tools, and returns it only to whoever asked', async () => {
    const alex = await sign('alex@example.com');
    const put = await handle(ev('PUT', '/api/ask', alex, { question: 'כמה הוצאנו על וולט השנה?', history: [{ role: 'user', text: 'שלום' }, { role: 'hacker', text: 'x' }] }), deps) as { statusCode: number; body: string };
    expect(put.statusCode).toBe(202);
    const { id } = JSON.parse(put.body);
    expect(started).toEqual([id]);
    expect(JSON.parse((await handle(ev('GET', '/api/ask', alex, undefined, { id }), deps) as { body: string }).body).status).toBe('pending');

    // A stand-in model that does what the real one would: call a tool, then answer from it.
    const model: Model = async ({ messages, tools, system }) => {
      expect(system).toContain('העוזר הפיננסי של המשפחה');
      expect(messages.at(-1)!.content).toContain('כמה הוצאנו על וולט');
      expect(messages).toHaveLength(2); // the malformed history turn was dropped
      const search = tools.find((t) => t.name === 'search_transactions')!;
      const out = JSON.parse(await search.run({ text: 'וולט' } as never) as string);
      return `הוצאתם ₪${out.total.toLocaleString()} על וולט ב־${out.matched} הזמנות.`;
    };
    await assistant({ jobId: id }, { store, model });
    const done = JSON.parse((await handle(ev('GET', '/api/ask', alex, undefined, { id }), deps) as { body: string }).body);
    expect(done.status).toBe('done');
    expect(done.answer).toMatch(/^הוצאתם ₪[\d,]+ על וולט ב־\d+ הזמנות\.$/);

    expect((await handle(ev('GET', '/api/ask', await sign('noa@example.com'), undefined, { id }), deps) as { statusCode: number }).statusCode).toBe(404);
  });

  it('turns a model failure into a plain sentence, and rejects bad input', async () => {
    const alex = await sign('alex@example.com');
    const { id } = JSON.parse((await handle(ev('PUT', '/api/ask', alex, { question: 'שאלה' }), deps) as { body: string }).body);
    await assistant({ jobId: id }, { store, model: async () => { throw new Error('boom: secret detail'); } });
    const job = (await store.get<AskJob>(keys.chat(id)))!;
    expect(job).toMatchObject({ status: 'error', error: 'משהו השתבש בדרך. נסו שוב.' });
    expect((await handle(ev('PUT', '/api/ask', alex, { question: '' }), deps) as { statusCode: number }).statusCode).toBe(400);
    expect((await handle(ev('PUT', '/api/ask', alex, { question: 'x'.repeat(2001) }), deps) as { statusCode: number }).statusCode).toBe(400);
    expect((await handle(ev('GET', '/api/ask', alex, undefined, { id: '../meta' }), deps) as { statusCode: number }).statusCode).toBe(400);
  });
});
