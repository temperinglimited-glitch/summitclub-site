export function privateRuntime(env) {
  const mode = env.PAYMENTS_MODE || 'off';
  if (!['off','test'].includes(mode)) throw new Error('This private testing deployment only supports payment off or test mode.');
  const base = new URL(env.BASE_URL);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Set BASE_URL to the HTTPS test site origin.');
  if (String(env.STRIPE_SECRET_KEY || '').match(/^(sk|rk)_live_/)) throw new Error('Live Stripe keys are not allowed on the private test deployment.');
  if (String(env.ADMIN_TOKEN || '').length < 32 || String(env.RECEIPT_SECRET || '').length < 32) throw new Error('Set separate strong administrator and receipt secrets.');
  if (mode === 'test' && (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '') || !String(env.STRIPE_WEBHOOK_SECRET || '').startsWith('whsec_'))) throw new Error('Configure a Stripe test key and webhook signing secret.');
  const emailEnabled = env.EMAIL_DELIVERY === 'on';
  if (emailEnabled && (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.OWNER_EMAIL)) throw new Error('Complete the confirmation email settings.');
  return { mode, baseUrl: base.origin, adminToken: env.ADMIN_TOKEN, receiptSecret: env.RECEIPT_SECRET, webhookSecret: env.STRIPE_WEBHOOK_SECRET || '', paymentsEnabled: mode === 'test', emailEnabled };
}
