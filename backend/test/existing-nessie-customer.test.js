import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiHandler } from '../src/api.js';
import { createAppStore } from '../src/app-store.js';
import { createMarketplaceService, createNessieClient } from '../src/index.js';

// Execute these expectations as TODOs until Nessie-only customer lookup exists.
// All Nessie traffic is simulated; no real customers or balances are changed.
function fixture() {
  const calls = [];
  const existing = { _id: 'existing-customer', first_name: 'John', last_name: 'String' };
  const accounts = new Map([
    ['existing-account', { _id: 'existing-account', customer_id: existing._id, type: 'Checking', nickname: 'Existing wallet', balance: 875 }],
  ]);
  const nessie = createNessieClient({
    apiKey: 'test-key', baseUrl: 'https://nessie.test', maxRetries: 0,
    fetch: async (url, init) => {
      const path = url.pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, path, body });
      if (init.method === 'GET') {
        if (path === '/customers') return Response.json([existing]);
        if (path === '/customers/existing-customer') return Response.json(existing);
        if (path === '/customers/existing-customer/accounts') return Response.json([accounts.get('existing-account')]);
        if (/^\/accounts\/[^/]+$/.test(path) && accounts.has(path.split('/')[2])) return Response.json(accounts.get(path.split('/')[2]));
        if (/\/(deposits|withdrawals|purchases)$/.test(path)) return Response.json([]);
      }
      if (init.method === 'POST') {
        if (path === '/customers') return Response.json({ objectCreated: { ...body, _id: 'new-customer' } }, { status: 201 });
        if (path === '/customers/new-customer/accounts') {
          const account = { ...body, _id: 'new-account', customer_id: 'new-customer' };
          accounts.set(account._id, account);
          return Response.json({ objectCreated: account }, { status: 201 });
        }
        if (path === '/merchants') return Response.json({ objectCreated: { ...body, _id: 'new-merchant' } }, { status: 201 });
      }
      if (init.method === 'PUT' && path === '/customers/new-customer') return Response.json({ code: 202 });
      if (init.method === 'PUT' && path === '/accounts/new-account') {
        accounts.set('new-account', { ...accounts.get('new-account'), ...body });
        return Response.json({ code: 202 });
      }
      throw new Error(`Unexpected Nessie request: ${init.method} ${path}`);
    },
  });
  const handler = createApiHandler({ nessie, marketplace: createMarketplaceService(nessie), store: createAppStore() });
  async function invoke(method, path, body, cookie) {
    const result = {};
    await handler({ method, url: path, headers: cookie ? { cookie } : {}, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } }, {
      writeHead(status, headers) { Object.assign(result, { status, headers }); },
      end(value) { result.body = JSON.parse(value); },
    });
    return result;
  }
  return { calls, invoke };
}

test('onboarding with a Nessie-only customer name reuses their customer and wallet', {
  todo: 'Backend currently searches only its local app-user store',
}, async t => {
  const { calls, invoke } = fixture();
  const session = await invoke('POST', '/api/session', { profile: { name: 'John String' } });
  assert.ok(session.status < 300, JSON.stringify(session.body));
  const cookie = session.headers['set-cookie'].split(';')[0];
  const wallet = await invoke('GET', '/api/wallet', undefined, cookie);
  const observed = {
    customerId: session.body.user.customerId,
    accountId: wallet.body.account.id,
    balance: wallet.body.account.balance,
    customerCreates: calls.filter(call => call.method === 'POST' && call.path === '/customers').length,
  };
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, { customerId: 'existing-customer', accountId: 'existing-account', balance: 875, customerCreates: 0 });
});

test('saving a Nessie-only customer name switches the frontend wallet response', {
  todo: 'Profile save currently renames the current customer when no local user matches',
}, async t => {
  const { calls, invoke } = fixture();
  const session = await invoke('POST', '/api/session', { profile: { name: 'Alex Rivera' } });
  const cookie = session.headers['set-cookie'].split(';')[0];
  calls.length = 0;
  const saved = await invoke('PUT', '/api/profile', { profile: { name: 'John String' } }, cookie);
  assert.equal(saved.status, 200);
  const observed = {
    customerId: saved.body.user.customerId,
    accountId: saved.body.account?.id,
    balance: saved.body.account?.balance,
    customerUpdates: calls.filter(call => call.method === 'PUT' && call.path.startsWith('/customers/')).length,
  };
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, { customerId: 'existing-customer', accountId: 'existing-account', balance: 875, customerUpdates: 0 });
});
