import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  teamDomain: string; // <team>.cloudflareaccess.com
  audience: string; // the Access application's AUD tag
  allowedEmails: string[];
  keys?: JWTVerifyGetKey; // injected in tests
}

export class AccessDenied extends Error {}

let cached: { domain: string; keys: JWTVerifyGetKey } | undefined;

// Cloudflare Access already gates the hostname. This check exists because the
// Lambda URL is reachable directly, so the edge alone proves nothing here.
export async function verifyAccess(token: string | undefined, cfg: AccessConfig): Promise<string> {
  if (!token) throw new AccessDenied('missing Access token');
  if (!cfg.keys && cached?.domain !== cfg.teamDomain) {
    cached = { domain: cfg.teamDomain, keys: createRemoteJWKSet(new URL(`https://${cfg.teamDomain}/cdn-cgi/access/certs`)) };
  }
  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, cfg.keys ?? cached!.keys, {
      issuer: `https://${cfg.teamDomain}`,
      audience: cfg.audience,
      algorithms: ['RS256'],
    });
    email = payload.email;
  } catch (e) {
    throw new AccessDenied(`invalid Access token: ${(e as Error).message}`);
  }
  // The Access policy holds the same list; a second copy here means a policy
  // mistake in the dashboard cannot open the data to anyone else.
  if (typeof email !== 'string' || !cfg.allowedEmails.includes(email.toLowerCase())) throw new AccessDenied('email not allowed');
  return email.toLowerCase();
}
