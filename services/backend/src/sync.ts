import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { addMonths, annotateWithBudget, mergeTransactions, type StoredTransaction } from '@hub/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectRiseup, RiseupAuthError, type Riseup } from './riseup.ts';
import { emptyMeta, keys, S3Store, type Meta, type Store } from './store.ts';

export interface SyncOptions {
  monthsBack: number; // 1 = current and previous
  now?: Date;
}

// Card charges keep landing in a closed month for a few weeks, so the previous
// month is refreshed on every run along with the current one.
export async function runSync(riseup: Riseup, store: Store, opts: SyncOptions) {
  const now = opts.now ?? new Date();
  const meta: Meta = { ...emptyMeta, ...(await store.get<Meta>(keys.meta)) };
  meta.lastAttemptAt = now.toISOString();

  try {
    // RiseUp's cashflow month is not always the calendar month; ask it.
    const current = await riseup.budget('current');
    const months = Array.from({ length: opts.monthsBack + 1 }, (_, i) => addMonths(current.budgetDate, -i));
    const synced: string[] = [];

    for (const month of months) {
      const budget = month === current.budgetDate ? current : await riseup.budget(month).catch(() => undefined);
      const txns = await riseup.transactions(month).catch(() => undefined);
      // Months before the account existed come back empty or fail; skip them.
      if (!budget || !txns || (txns.transactions.length === 0 && budget.envelopes.length === 0)) continue;
      // _meta carries a token reference; it has no business in storage.
      const { _meta: _b, ...cleanBudget } = budget as typeof budget & { _meta?: unknown };
      await store.put(keys.budget(month), cleanBudget);
      // Merged, never replaced: a transaction RiseUp drops or edits stays on record.
      const held = (await store.get<{ transactions: StoredTransaction[] }>(keys.transactions(month)))?.transactions ?? [];
      // Each transaction is stamped with its place in RiseUp's budget. RiseUp's
      // feed includes what it keeps out of the cashflow (transfers, the card bill
      // seen from the bank); unstamped, every total would roughly double.
      const merged = mergeTransactions(held, txns.transactions, now.toISOString());
      await store.put(keys.transactions(month), { transactions: annotateWithBudget(merged, budget) });
      synced.push(month);
    }

    meta.months = [...new Set([...meta.months, ...synced])].sort().reverse();
    meta.lastSyncAt = now.toISOString();
    meta.lastError = null;
    await store.put(keys.meta, meta);
    return { synced };
  } catch (e) {
    meta.lastError = e instanceof RiseupAuthError ? 'RiseUp rejected the token. Create a new one and run scripts/set-token.sh.' : (e as Error).message;
    await store.put(keys.meta, meta);
    throw e;
  }
}

export async function handler(event: { monthsBack?: number } = {}) {
  const ssm = new SSMClient({});
  const pat = (await ssm.send(new GetParameterCommand({ Name: process.env.PAT_PARAM!, WithDecryption: true }))).Parameter!.Value!;
  const server = join(dirname(fileURLToPath(import.meta.url)), 'riseup-mcp.mjs');
  const riseup = await connectRiseup(pat, server);
  try {
    const out = await runSync(riseup, new S3Store(process.env.DATA_BUCKET!), { monthsBack: event.monthsBack ?? 1 });
    // Month keys only. No amounts or business names go to CloudWatch.
    console.log(JSON.stringify({ synced: out.synced }));
    return out;
  } finally {
    await riseup.close();
  }
}
