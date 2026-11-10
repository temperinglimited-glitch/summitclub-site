import { CoreRepository } from '../server/repository-core.mjs';
import { createApp } from '../server/app.mjs';
import { StripeGateway, EmailGateway } from '../server/providers.mjs';
import { DurableSqlDatabase } from './sql-database.mjs';
import { privateRuntime } from './runtime.mjs';
import seed from '../config/pricing.json' with { type: 'json' };

export function createBookingStore(ctx, env, providers = {}) {
  const runtime = privateRuntime(env);
  const repo = new CoreRepository(new DurableSqlDatabase(ctx.storage), seed);
  const stripe = providers.stripe || new StripeGateway(env.STRIPE_SECRET_KEY || '');
  const mailer = providers.mailer || new EmailGateway({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, ownerEmail: env.OWNER_EMAIL });
  const app = createApp({ repo, stripe, mailer, runtime, clock: providers.clock });
  function hasWork() {
    return (runtime.paymentsEnabled && repo.pending().length > 0) || (runtime.emailEnabled && repo.outbox().some(m => m.status === 'pending'));
  }
  async function schedule() {
    if (hasWork() && !(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + 60000);
  }
  return {
    repo, app,
    async fetch(request) {
      const response = await app.handle(request, { ip: request.headers.get('X-Summit-Client-IP') || 'unknown' });
      await schedule();
      return response;
    },
    async alarm() {
      try { await app.maintenance(); }
      finally { if (hasWork()) await ctx.storage.setAlarm(Date.now() + 60000); }
    }
  };
}
