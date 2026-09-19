import { buildDashboard, type RiseupBudget, type StoredTransaction } from '@hub/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { randomBytes } from 'node:crypto';
import { AccessDenied, verifyAccess, type AccessConfig } from './access.ts';
import type { AskJob, ChatTurn } from './assistant.ts';
import { emptyMeta, keys, S3Store, type Meta, type Store } from './store.ts';
import { BadRequest, loadUserData, saveLayout, saveOverride, saveCommitment, savePlans, saveShift, saveStrategy, saveRecoStatus } from './userdata.ts';
import { pushStatus, savePush } from './push.ts';

const HISTORY_MONTHS = 13;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  body: JSON.stringify(body),
});

export interface ApiDeps {
  store: Store;
  access: AccessConfig;
  tokenExpiresAt?: string; // YYYY-MM-DD
  now?: () => Date;
  startAssistant?: (jobId: string) => Promise<void>;
}

// Fire and forget: the assistant Lambda writes its answer into the job file.
async function startAssistant(jobId: string) {
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.ASSISTANT_FUNCTION!, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ jobId })) }));
}

export async function handle(event: APIGatewayProxyEventV2, deps: ApiDeps): Promise<APIGatewayProxyResultV2> {
  let email: string;
  try {
    email = await verifyAccess(event.headers['cf-access-jwt-assertion'], deps.access);
  } catch (e) {
    if (e instanceof AccessDenied) return json(403, { error: 'forbidden' });
    throw e;
  }

  const path = event.rawPath.replace(/\/+$/, '');
  const method = event.requestContext.http.method;
  const now = deps.now?.() ?? new Date();

  if (method === 'PUT' && path === '/api/ask') {
    try {
      const b = JSON.parse((event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body) || 'null') as { question?: unknown; history?: unknown; month?: unknown } | null;
      const question = typeof b?.question === 'string' ? b.question.trim() : '';
      if (!question || question.length > 2000) return json(400, { error: 'question must be 1-2000 characters' });
      const history = (Array.isArray(b?.history) ? b.history : []).slice(-8)
        .filter((t): t is ChatTurn => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.text === 'string').map((t) => ({ role: t.role, text: t.text.slice(0, 6000) }));
      const job: AskJob = { id: randomBytes(16).toString('hex'), email, question, history, month: typeof b?.month === 'string' && /^\d{4}-\d{2}$/.test(b.month) ? b.month : undefined, status: 'pending', askedAt: now.toISOString() };
      await deps.store.put(keys.chat(job.id), job);
      await (deps.startAssistant ?? startAssistant)(job.id);
      return json(202, { id: job.id });
    } catch (e) {
      if (e instanceof SyntaxError) return json(400, { error: 'bad json' });
      throw e;
    }
  }
  if (method === 'PUT') {
    const save = { '/api/layout': saveLayout, '/api/override': saveOverride, '/api/reco': saveRecoStatus, '/api/plans': savePlans, '/api/shift': saveShift, '/api/commitment': saveCommitment, '/api/strategy': saveStrategy, '/api/push': savePush }[path];
    if (!save) return json(404, { error: 'not found' });
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body ?? '';
      if (raw.length > 25_000) throw new BadRequest('body too large');
      const saved = await save(deps.store, email, JSON.parse(raw || 'null'), now.toISOString());
      return json(200, { ok: true, saved: saved ?? null });
    } catch (e) {
      if (e instanceof BadRequest || e instanceof SyntaxError) return json(400, { error: e.message });
      throw e;
    }
  }
  if (method !== 'GET') return json(405, { error: 'method not allowed' });
  if (path === '/api/me') return json(200, { email });
  if (path === '/api/push') return json(200, await pushStatus(deps.store, email));
  if (path === '/api/ask') {
    const id = event.queryStringParameters?.id ?? '';
    if (!/^[a-f0-9]{32}$/.test(id)) return json(400, { error: 'bad id' });
    const job = await deps.store.get<AskJob>(keys.chat(id));
    // A job belongs to whoever asked it.
    if (!job || job.email !== email) return json(404, { error: 'not found' });
    return json(200, { status: job.status, answer: job.answer, error: job.error });
  }
  if (path !== '/api/dashboard') return json(404, { error: 'not found' });

  const asked = event.queryStringParameters?.month;
  if (asked && !/^\d{4}-\d{2}$/.test(asked)) return json(400, { error: 'month must be YYYY-MM' });
  const tokenDays = deps.tokenExpiresAt ? Math.ceil((Date.parse(`${deps.tokenExpiresAt}T00:00:00Z`) - now.getTime()) / 86_400_000) : undefined;
  const out = await loadDashboard(deps.store, email, asked, now, tokenDays);
  if (!out) {
    const meta: Meta = { ...emptyMeta, ...(await deps.store.get<Meta>(keys.meta)) };
    return json(503, { error: 'no data synced yet', lastError: meta.lastError });
  }
  return json(200, out);
}

// The dashboard for one viewer. The assistant calls this too, so its answers
// come from exactly the numbers on the screen.
export async function loadDashboard(store: Store, email: string, asked: string | undefined, now: Date, tokenExpiresInDays?: number) {
  const meta: Meta = { ...emptyMeta, ...(await store.get<Meta>(keys.meta)) };
  if (meta.months.length === 0) return undefined;
  const month = asked && meta.months.includes(asked) ? asked : meta.months[0]!;
  const budget = await store.get<RiseupBudget>(keys.budget(month));
  if (!budget) return undefined;
  const wanted = meta.months.filter((m) => m <= month).slice(0, HISTORY_MONTHS);
  const loaded = await Promise.all(wanted.map((m) => store.get<{ transactions: StoredTransaction[] }>(keys.transactions(m))));
  const user = await loadUserData(store, email);
  const previousBudgets = (await Promise.all(meta.months.filter((m) => m < month).slice(0, 6).map((m) => store.get<RiseupBudget>(keys.budget(m))))).filter((b): b is RiseupBudget => !!b);
  const dashboard = buildDashboard({ budget, previousBudgets, transactions: loaded.flatMap((r) => r?.transactions ?? []), overrides: user.overrides, shifts: user.shifts, commitments: user.commitments, plan: user.plans?.plans?.[0], today: now.toISOString().slice(0, 10), lastSyncAt: meta.lastSyncAt, tokenExpiresInDays });
  // Older months stay selectable even though only `wanted` was loaded.
  return { ...dashboard, availableMonths: meta.months, user: { email, layout: user.layout, reco: user.reco, plans: user.plans, strategy: user.strategy } };
}

let deps: ApiDeps | undefined;

export async function handler(event: APIGatewayProxyEventV2) {
  deps ??= {
    store: new S3Store(process.env.DATA_BUCKET!),
    access: {
      teamDomain: process.env.ACCESS_TEAM_DOMAIN!,
      audience: process.env.ACCESS_AUD!,
      allowedEmails: process.env.ALLOWED_EMAILS!.split(',').map((e) => e.trim().toLowerCase()),
    },
    tokenExpiresAt: process.env.PAT_EXPIRES_AT || undefined,
  };
  try {
    return await handle(event, deps);
  } catch (e) {
    console.error((e as Error).message);
    return json(500, { error: 'internal error' });
  }
}
