// Runs in front of every request to the Pages project, static files included.
// Cloudflare Access guards the hub hostname, but it cannot guard the
// project's own *.pages.dev addresses (they are outside our zone). Anything
// that did not arrive through the guarded hostname is refused here.
interface Env { HUB_HOST?: string }

export const onRequest = async (ctx: { request: Request; env: Env; next: () => Promise<Response> }): Promise<Response> => {
  const host = new URL(ctx.request.url).hostname;
  // No HUB_HOST means a misconfigured deploy: refuse rather than serve openly.
  if (!ctx.env.HUB_HOST || host !== ctx.env.HUB_HOST) return new Response('Not found', { status: 404 });
  // Access adds this header to every request it lets through.
  if (!ctx.request.headers.get('cf-access-jwt-assertion')) return new Response('Forbidden', { status: 403 });
  return ctx.next();
};
