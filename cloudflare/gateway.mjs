import { verifyAccess } from './access.mjs';

const security = {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...security } }); }
function protect(result) { const headers = new Headers(result.headers); for (const [name, value] of Object.entries(security)) headers.set(name, value); return new Response(result.body, { status: result.status, statusText: result.statusText, headers }); }
async function limitedRequest(request, maximum) {
  if (['GET','HEAD'].includes(request.method)) return new Request(request);
  if (Number(request.headers.get('Content-Length') || 0) > maximum) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const reader = request.body?.getReader(); if (!reader) return new Request(request);
  let length = 0; const chunks = [];
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.length;
    if (length > maximum) { await reader.cancel(); throw Object.assign(new Error('Request too large.'), { status: 413 }); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Request(request, { body: bytes });
}
export function createPrivateGateway({ verify = verifyAccess } = {}) {
  return async function fetchPrivate(request, env) {
    try {
      const url = new URL(request.url);
      let base; try { base = new URL(env.BASE_URL); } catch { return response({ error: 'Private testing has not been configured.' }, 503); }
      if (base.protocol !== 'https:' || url.origin !== base.origin) return response({ error: 'Use the authorised private test address.' }, 403);
      let path; try { path = decodeURIComponent(url.pathname); } catch { return response({ error: 'Invalid address.' }, 400); }
      // Stripe cannot sign in to Access. This one endpoint remains protected by the
      // Stripe raw-body signature and test-mode/booking validation in the booking app.
      const webhook = path === '/api/stripe/webhook' && url.pathname === path && request.method === 'POST';
      let identity;
      if (!webhook) identity = await verify(request, env);
      const ownerPath = path === '/admin' || path === '/admin.html' || path.startsWith('/api/admin');
      if (ownerPath && !identity?.owner) return response({ error: 'This area is available to the owner only.' }, 403);
      if (path === '/api/access' && request.method === 'GET') return response(identity);
      if (path.startsWith('/api/')) {
        if (!env.BOOKINGS) return response({ error: 'The private booking database has not been connected.' }, 503);
        const forwarded = await limitedRequest(request, webhook ? 1048576 : 16384);
        if (ownerPath) {
          if (String(env.ADMIN_TOKEN || '').length < 32) return response({ error: 'Owner access has not been configured.' }, 503);
          forwarded.headers.set('Authorization', 'Bearer ' + env.ADMIN_TOKEN);
        }
        forwarded.headers.set('X-Summit-Client-IP', request.headers.get('CF-Connecting-IP') || 'unknown');
        const stub = env.BOOKINGS.get(env.BOOKINGS.idFromName('summit-private-test-v1'));
        return protect(await stub.fetch(forwarded));
      }
      if (!['GET','HEAD'].includes(request.method)) return response({ error: 'Method not supported.' }, 405);
      if (!env.ASSETS) return response({ error: 'The private test website has not been built.' }, 503);
      return protect(await env.ASSETS.fetch(request));
    } catch (error) {
      const status = error.status || 503;
      return response({ error: error.status ? error.message : 'Private booking testing is temporarily unavailable.' }, status);
    }
  };
}
