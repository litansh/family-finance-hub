// Cloudflare Pages Function: same-origin /api/* → the API behind API Gateway.
// Access has already authenticated the viewer by the time this runs; the JWT it
// issued is passed along so the API can verify the viewer for itself.
interface Env { API_ORIGIN: string }

export const onRequest = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'PUT') return new Response('method not allowed', { status: 405 });
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return new Response('forbidden', { status: 403 });

  const init: RequestInit = { method: request.method, headers: { 'cf-access-jwt-assertion': token, accept: 'application/json' } };
  if (request.method === 'PUT') {
    // The Access cookie rides along on cross-site requests too, so a write must
    // prove it came from the hub's own pages.
    if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.includes('application/json')) {
      return new Response('forbidden', { status: 403 });
    }
    const body = await request.text();
    if (body.length > 25_000) return new Response('too large', { status: 413 });
    init.body = body;
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }

  const upstream = await fetch(`${env.API_ORIGIN.replace(/\/$/, '')}${url.pathname}${url.search}`, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
};
