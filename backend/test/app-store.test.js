import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppStore } from '../src/app-store.js';

test('profiles, sessions, listings and payment records survive restart and concurrent initial reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dormio-store-test-'));
  try {
    const filePath = join(directory, 'app.json');
    const first = createAppStore({ filePath });
    await first.createUser({ id: 'user', sessionHash: 'hash', profile: { name: 'Alex' } });
    await first.createListing({ id: 'listing', sellerUserId: 'user' });
    await first.putIdempotency('payment', { status: 'settled' });
    const restarted = createAppStore({ filePath });
    const [user, session, listings, payment] = await Promise.all([
      restarted.getUser('user'), restarted.getUserBySession('hash'),
      restarted.listListings(), restarted.getIdempotency('payment'),
    ]);
    assert.equal(user.profile.name, 'Alex');
    assert.equal(session.id, user.id);
    assert.equal(listings[0].sellerUserId, user.id);
    assert.equal(payment.status, 'settled');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
