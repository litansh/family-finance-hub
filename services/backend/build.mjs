import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
rmSync('dist', { recursive: true, force: true });

const common = { bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, sourcemap: false,
  // The AWS SDK ships in the Lambda runtime.
  external: ['@aws-sdk/*'],
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" } };

await build({ ...common, entryPoints: ['src/api.ts'], outfile: 'dist/api/index.mjs' });
await build({ ...common, entryPoints: ['src/sync.ts'], outfile: 'dist/sync/index.mjs' });
await build({ ...common, entryPoints: ['src/assistant.ts'], outfile: 'dist/assistant/index.mjs' });
await build({ ...common, entryPoints: ['src/push.ts'], outfile: 'dist/brief/index.mjs' });

// The sync Lambda runs the official RiseUp MCP server as a child process, so
// the server ships as its own self-contained bundle next to the handler.
const entry = join(dirname(require.resolve('@riseup-oss/mcp/package.json')), 'dist/index.js');
await build({ ...common, entryPoints: [entry], outfile: 'dist/sync/riseup-mcp.mjs' });
mkdirSync('dist/zips', { recursive: true });
console.log('bundled: dist/api, dist/sync, dist/assistant, dist/brief');
