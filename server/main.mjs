import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Repository } from './repository.mjs';
import { StripeGateway, EmailGateway } from './providers.mjs';
import { createApp } from './app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const seed = JSON.parse(readFileSync(resolve(root, 'config/pricing.json'), 'utf8'));
const mode = process.env.PAYMENTS_MODE || 'off';
if (!['off', 'test', 'live'].includes(mode)) throw new Error('PAYMENTS_MODE must be off, test or live.');
const key = process.env.STRIPE_SECRET_KEY || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const adminToken = process.env.ADMIN_TOKEN || '';
const receiptSecret = process.env.RECEIPT_SECRET || (mode === 'off' ? randomBytes(32).toString('hex') : '');
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const base = new URL(baseUrl);
const emailEnabled = process.env.EMAIL_DELIVERY === 'on';
if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('BASE_URL must be just the site origin.');
if (mode !== 'off') {
  if (!new RegExp('^(sk|rk)_' + mode + '_').test(key)) throw new Error('Use a Stripe key matching PAYMENTS_MODE.');
  if (!webhookSecret.startsWith('whsec_')) throw new Error('Configure STRIPE_WEBHOOK_SECRET.');
  if (adminToken.length < 32 || receiptSecret.length < 32) throw new Error('Set separate strong ADMIN_TOKEN and RECEIPT_SECRET values (at least 32 characters).');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Use HTTPS for a hosted payment site.');
}
if (emailEnabled && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.OWNER_EMAIL)) throw new Error('Complete the email provider settings.');
if (mode === 'live' && (base.protocol !== 'https:' || !emailEnabled)) throw new Error('Live bookings require HTTPS and configured confirmation email delivery.');
const repo = new Repository(resolve(root, process.env.DATABASE_PATH || 'data/bookings.sqlite'), seed);
if (mode !== 'off' && repo.list().some(b => b.data.paymentMode && b.data.paymentMode !== mode && !['expired','cancelled'].includes(b.status))) throw new Error('This database contains bookings from the other Stripe mode. Use a separate DATABASE_PATH for test and live bookings.');
if (mode === 'live' && !repo.settings().pricesApproved) throw new Error('Review and approve the pricing in the owner screen before selecting live payment mode.');
const runtime = { mode, baseUrl, adminToken, receiptSecret, webhookSecret, paymentsEnabled: mode !== 'off', emailEnabled };
const stripe = new StripeGateway(key);
const mailer = new EmailGateway({ apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, ownerEmail: process.env.OWNER_EMAIL });
const app = createApp({ repo, stripe, mailer, runtime });
const publicRoot = resolve(root, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon' };
const headers = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
const server = createServer(async (req, res) => {
  try {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    const url = new URL(req.url, baseUrl);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (url.pathname === '/api/stripe/webhook' ? 1048576 : 16384)) { res.writeHead(413); res.end('Request too large.'); return; }
        chunks.push(chunk);
      }
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await app.handle(request, { ip: req.socket.remoteAddress });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let path; try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    const file = resolve(publicRoot, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(publicRoot + sep) || !types[extname(file)] || !existsSync(file)) { res.writeHead(404); res.end('Not found.'); return; }
    const bytes = readFileSync(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Content-Length': bytes.length, 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public,max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('This request could not be completed.'); }
});
server.requestTimeout = 30000;
server.on('error', error => { console.error('Could not start the website:', error.code); process.exitCode = 1; repo.close(); });
const interval = setInterval(() => app.maintenance().catch(() => {}), 60000).unref();
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  console.log('Summit Club: ' + baseUrl + ' (payments: ' + mode + ')');
  app.maintenance().catch(() => {});
});
function shutdown() { clearInterval(interval); server.close(() => { repo.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
