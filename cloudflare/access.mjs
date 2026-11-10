const cache = new Map();
export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}
function settings(env) {
  let team;
  try { team = new URL(env.ACCESS_TEAM_DOMAIN); } catch { throw new AccessError('Private test access has not been configured.', 503); }
  if (team.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team.hostname) || team.pathname !== '/' || team.search || team.hash || team.username || team.password || team.port) throw new AccessError('Private test access has not been configured.', 503);
  const audience = String(env.ACCESS_AUD || '');
  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  const testers = String(env.TESTER_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!audience || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) || !testers.length || testers.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw new AccessError('Private test access has not been configured.', 503);
  return { issuer: team.origin, audience, owner, allowed: new Set([owner, ...testers]) };
}
function decode(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AccessError('Please sign in to private booking testing.');
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function parse(value) {
  try { return JSON.parse(new TextDecoder().decode(decode(value))); } catch { throw new AccessError('Please sign in to private booking testing.'); }
}
async function keys(issuer, fetcher, now, force = false) {
  const saved = cache.get(issuer);
  if (saved && saved.expires > now && (!force || saved.loaded > now - 60)) return saved.keys;
  let response;
  try { response = await fetcher(issuer + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000) }); } catch { throw new AccessError('Login could not be checked. Please try again shortly.', 503); }
  if (!response.ok) throw new AccessError('Login could not be checked. Please try again shortly.', 503);
  let result; try { result = await response.json(); } catch { throw new AccessError('Login could not be checked.', 503); }
  if (!Array.isArray(result.keys) || result.keys.length > 20) throw new AccessError('Login could not be checked.', 503);
  cache.set(issuer, { keys: result.keys, loaded: now, expires: now + 300 });
  if (cache.size > 20) for (const [key, value] of cache) if (value.expires < now) cache.delete(key);
  return result.keys;
}
export async function verifyAccess(request, env, { fetcher = fetch, clock = Date.now } = {}) {
  const config = settings(env), now = Math.floor(clock() / 1000);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new AccessError('This booking test is invite-only. Please sign in with an approved email address.');
  const parts = token.split('.'); if (parts.length !== 3) throw new AccessError('Please sign in to private booking testing.');
  const header = parse(parts[0]), claims = parse(parts[1]);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 || header.crit) throw new AccessError('Please sign in to private booking testing.');
  if (!claims || claims.iss !== config.issuer || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(config.audience) || !Number.isSafeInteger(claims.exp) || claims.exp <= now || !Number.isSafeInteger(claims.iat) || claims.iat > now + 60 || (claims.nbf != null && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 60))) throw new AccessError('Your test login has expired or is invalid. Please sign in again.');
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!config.allowed.has(email)) throw new AccessError('This email address is not authorised for booking testing.');
  let available = await keys(config.issuer, fetcher, now);
  let jwk = available.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256'));
  if (!jwk) { available = await keys(config.issuer, fetcher, now, true); jwk = available.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256')); }
  if (!jwk) throw new AccessError('Your test login could not be verified. Please sign in again.');
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!valid) throw new Error('Invalid signature');
  } catch { throw new AccessError('Your test login could not be verified. Please sign in again.'); }
  return { email, owner: email === config.owner };
}
