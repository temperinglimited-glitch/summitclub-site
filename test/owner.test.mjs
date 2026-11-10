import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Repository } from '../server/repository.mjs';
import { fixture, seed, selection } from './helpers.mjs';

test('owner settings use optimistic concurrency and lodge IDs cannot be changed', async t => {
  const f = fixture(t), auth = f.runtime.adminToken;
  const previous = (await f.call('/api/admin/settings', { auth })).body;
  const value = { ...previous, settings: { ...previous.settings, winterPence: 27000 } };
  assert.equal((await f.call('/api/admin/settings', { method: 'PUT', value, auth })).status, 200);
  assert.equal((await f.call('/api/admin/settings', { method: 'PUT', value, auth })).status, 409);
  assert.equal(f.app.findQuote(selection()).totalPence, 54000);
  assert.throws(() => f.repo.saveSettings({ ...f.repo.settings(), lodges: [{ id: 'new', name: 'New' }, seed.lodges[1]] }));
});
test('blocking and releasing owner dates immediately updates availability', async t => {
  const f = fixture(t), auth = f.runtime.adminToken;
  const block = await f.call('/api/admin/blocks', { method: 'POST', auth, value: { lodgeId: 'lodge-one', checkIn: '2026-12-10', checkOut: '2026-12-12', note: 'External booking' } });
  assert.equal(block.status, 201); assert.equal(f.repo.available('lodge-one', '2026-12-10', '2026-12-12'), false);
  const availability = await f.call('/api/availability?from=2026-12-10&to=2026-12-12&lodgeId=any');
  assert.deepEqual(availability.body.days[0].availableLodges, ['lodge-two']);
  assert.equal((await f.call('/api/admin/bookings/' + block.body.booking.id + '/cancel', { method: 'POST', auth, value: {} })).status, 200);
  assert.equal(f.repo.available('lodge-one', '2026-12-10', '2026-12-12'), true);
});
test('cancellation needs refund acknowledgement and suppresses unsent confirmations', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0]; f.stripe.paid(b.stripe_session_id); await f.webhook(b.stripe_session_id);
  const path = '/api/admin/bookings/' + b.id + '/cancel', auth = f.runtime.adminToken;
  assert.equal((await f.call(path, { method: 'POST', auth, value: {} })).status, 400);
  assert.equal((await f.call(path, { method: 'POST', auth, value: { refundAcknowledged: true } })).status, 200);
  assert.equal(f.repo.get(b.id).status, 'cancelled'); assert.equal(f.repo.available(b.lodge_id, b.check_in, b.check_out), true);
  assert.deepEqual(f.repo.messages(f.now()).map(m => m.kind).sort(), ['guest_cancelled', 'owner_cancelled']);
  await f.webhook(b.stripe_session_id); assert.equal(f.repo.get(b.id).status, 'cancelled');
});
test('owner recovers an interrupted Stripe creation and can close an unpaid checkout', async t => {
  const f = fixture(t); f.stripe.failCreate = 1; await f.start(); const b = f.repo.list()[0], auth = f.runtime.adminToken;
  const path = '/api/admin/bookings/' + b.id + '/recover';
  const result = await f.call(path, { method: 'POST', auth, value: { sessionId: f.stripe.ids.get(b.id), expire: true } });
  assert.equal(result.status, 200); assert.equal(f.repo.get(b.id).status, 'expired'); assert.equal(f.repo.available(b.lodge_id, b.check_in, b.check_out), true);
});
test('unknown payment holds cannot be released before expiry or without a Stripe check acknowledgement', async t => {
  const f = fixture(t); f.stripe.failCreate = 1; await f.start(); const b = f.repo.list()[0], auth = f.runtime.adminToken;
  const path = '/api/admin/bookings/' + b.id + '/release-unresolved';
  assert.equal((await f.call(path, { method: 'POST', auth, value: { noPaymentAcknowledged: true } })).status, 409);
  f.advance(3901);
  assert.equal((await f.call(path, { method: 'POST', auth, value: {} })).status, 400);
  assert.equal((await f.call(path, { method: 'POST', auth, value: { noPaymentAcknowledged: true } })).status, 200);
});
test('settings, inventory, outbox and a consistent SQLite backup survive closing the process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'summit-test-')), path = join(dir, 'bookings.sqlite');
  let repo;
  try {
    repo = new Repository(path, seed); repo.saveSettings({ ...seed, winterPence: 29000 });
    const b = repo.reserve({ quote: { lodge: seed.lodges[0], selection: { checkIn: '2026-12-10', checkOut: '2026-12-12' } }, data: { note: 'Owner use' }, now: 1000, blocked: true });
    await backup(repo.db, join(dir, 'backup.sqlite')); repo.close();
    repo = new Repository(path, seed); assert.equal(repo.settings().winterPence, 29000); assert.equal(repo.get(b.id).status, 'blocked'); assert.equal(repo.available('lodge-one', '2026-12-10', '2026-12-12'), false);
    const copy = new DatabaseSync(join(dir, 'backup.sqlite')); assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM night_locks').get().n, 2); copy.close();
  } finally { if (repo) repo.close(); rmSync(dir, { recursive: true, force: true }); }
});
