// Pull your real RiseUp data into ./data on this machine. No AWS involved.
//   RISEUP_PAT=riseup_pat_... npm run sync:local -w @hub/backend -- 12
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { connectRiseup } from './riseup.ts';
import { FileStore } from './store.ts';
import { runSync } from './sync.ts';

const pat = process.env.RISEUP_PAT;
if (!pat) throw new Error('Set RISEUP_PAT (see .env.example)');
const require = createRequire(import.meta.url);
const server = join(dirname(require.resolve('@riseup-oss/mcp/package.json')), 'dist/index.js');

const riseup = await connectRiseup(pat, server);
try {
  const out = await runSync(riseup, new FileStore(join(process.cwd(), '../../data')), { monthsBack: Number(process.argv[2] ?? 12) });
  console.log(`Synced ${out.synced.length} months: ${out.synced.join(', ')}`);
} finally {
  await riseup.close();
}
