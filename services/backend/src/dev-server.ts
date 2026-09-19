// Serves ./data to the Vite dev server on localhost. Bound to loopback and
// without Access checks, so it must never be deployed.
//   npm run api:local -w @hub/backend   then   VITE_DATA_SOURCE=api npm run dev
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { handle } from './api.ts';
import { FileStore } from './store.ts';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
const access = { teamDomain: 'local.invalid', audience: 'local', allowedEmails: ['dev@localhost'], keys };
const token = await new SignJWT({ email: 'dev@localhost' }).setProtectedHeader({ alg: 'RS256' })
  .setIssuer('https://local.invalid').setAudience('local').setExpirationTime('12h').sign(privateKey);
const store = new FileStore(join(process.cwd(), '../../data'));

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const out = await handle({
    body: Buffer.concat(chunks).toString(),
    rawPath: url.pathname,
    headers: { 'cf-access-jwt-assertion': token },
    queryStringParameters: Object.fromEntries(url.searchParams),
    requestContext: { http: { method: req.method ?? 'GET' } },
  } as never, { store, access, tokenExpiresAt: process.env.PAT_EXPIRES_AT });
  const r = out as { statusCode: number; headers: Record<string, string>; body: string };
  res.writeHead(r.statusCode, r.headers).end(r.body);
}).listen(8787, '127.0.0.1', () => console.log('local API on http://127.0.0.1:8787 serving ./data'));
