import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiHandler } from '../src/api.js';
import { createAppStore } from '../src/app-store.js';
import { createMarketplaceService, createNessieClient } from '../src/index.js';

// all nessie traffic is simulated; no real customers or balances are changed.
function fixture({ duplicate = false } = {}) {
  const calls = [];
  const existing = { _id: 'existing-customer', first_name: 'John', last_name: 'String' };
  const duplicateCustomer = { _id: 'duplicate-customer', first_name: 'john', last_name: 'string' };
  const customers = duplicate ? [existing, duplicateCustomer] : [existing];
  let newCustomer;
  const accounts = new Map([
    ['existing-account', { _id: 'existing-account', customer_id: existing._id, type: 'Checking', nickname: 'Existing wallet', balance: 875 }],
    ['duplicate-account', { _id: 'duplicate-account', customer_id: duplicateCustomer._id, type: 'Checking', nickname: 'Second wallet', balance: 225 }],
  ]);
  const nessie = createNessieClient({
    apiKey: 'test-key', baseUrl: 'https://nessie.test', maxRetries: 0,
    fetch: async (url, init) => {
      const path = url.pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, path, body });
      if (init.method === 'GET') {
        if (path === '/customers') return Response.json(customers);
        if (path === '/customers/existing-customer') return Response.json(existing);
        if (path === '/customers/duplicate-customer') return Response.json(duplicateCustomer);
        if (path === '/customers/new-customer' && newCustomer) return Response.json(newCustomer);
        if (path === '/customers/existing-customer/accounts') return Response.json([accounts.get('existing-account')]);
        if (path === '/customers/duplicate-customer/accounts') return Response.json([accounts.get('duplicate-account')]);
        if (path === '/customers/new-customer/accounts') return Response.json(accounts.has('new-account') ? [accounts.get('new-account')] : []);
        if (/^\/accounts\/[^/]+$/.test(path) && accounts.has(path.split('/')[2])) return Response.json(accounts.get(path.split('/')[2]));
        if (/\/(deposits|withdrawals|purchases)$/.test(path)) return Response.json([]);
      }
      if (init.method === 'POST') {
        if (path === '/customers') {
          newCustomer = { ...body, _id: 'new-customer' };
          return Response.json({ objectCreated: newCustomer }, { status: 201 });
        }
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
  return { calls, invoke, existing };
}

test('onboarding with a Nessie-only customer name reuses their customer and wallet', async t => {
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

test('duplicate Nessie names require an explicit customer choice', async () => {
  const { invoke } = fixture({ duplicate: true });
  const ambiguous = await invoke('POST', '/api/session', { profile: { name: 'John String' } });
  assert.equal(ambiguous.status, 409);
  assert.equal(ambiguous.body.code, 'AMBIGUOUS_NESSIE_CUSTOMER');
  assert.deepEqual(
    ambiguous.body.candidates.map(candidate => candidate.customerId),
    ['existing-customer', 'duplicate-customer'],
  );

  const selected = await invoke('POST', '/api/session', {
    profile: { name: 'John String' },
    customerId: 'duplicate-customer',
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.user.customerId, 'duplicate-customer');
  assert.equal(selected.body.account.id, 'duplicate-account');
});

test('an active session refreshes its display name from Nessie', async () => {
  const { invoke, existing } = fixture();
  const session = await invoke('POST', '/api/session', { profile: { name: 'John String' } });
  const cookie = session.headers['set-cookie'].split(';')[0];
  existing.first_name = 'Jonathan';

  const refreshed = await invoke('GET', '/api/session', undefined, cookie);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.profile.name, 'Jonathan String');
});

test('saving a Nessie-only customer name switches the frontend wallet response', async t => {
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
