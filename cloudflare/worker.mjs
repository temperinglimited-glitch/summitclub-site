import { DurableObject } from 'cloudflare:workers';
import { createBookingStore } from './store.mjs';
import { createPrivateGateway } from './gateway.mjs';

export class BookingStore extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.store = createBookingStore(ctx, env); }
  fetch(request) { return this.store.fetch(request); }
  alarm() { return this.store.alarm(); }
}

export default { fetch: createPrivateGateway() };
