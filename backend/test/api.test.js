import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createApiHandler } from "../src/api.js";
import { createAppStore } from "../src/app-store.js";

async function invoke(handler, { method = "GET", path, body, cookie } = {}) {
  const request = {
    method,
    url: path,
    headers: cookie ? { cookie } : {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  const result = {};
  const response = {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    end(value) {
      result.body = JSON.parse(value);
    },
  };
  await handler(request, response);
  return result;
}

function cookieFrom(response) {
  return response.headers["set-cookie"].split(";")[0];
}

async function openChatStream(handler, cookie) {
  const request = Object.assign(new EventEmitter(), {
    method: "GET",
    url: "/api/chats/events",
    headers: { cookie },
    async *[Symbol.asyncIterator]() {},
  });
  const result = { chunks: [] };
  const response = {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    write(value) {
      result.chunks.push(value);
    },
  };
  await handler(request, response);
  return { request, result };
}

test('matching names on separate devices share one wallet and retain both sessions', async () => {
  const { handler, calls } = fixture();
  const [first, second] = await Promise.all([
    invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'John String' } }),
    invoke(handler, { method: 'POST', path: '/api/session', body: { name: '  john   STRING  ' } }),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.user.id, second.body.user.id);
  assert.equal(calls.createUsers.length, 1);
  assert.notEqual(cookieFrom(first), cookieFrom(second));
  for (const session of [first, second]) {
    const wallet = await invoke(handler, { path: '/api/wallet', cookie: cookieFrom(session) });
    assert.equal(wallet.status, 200);
    assert.equal(wallet.body.account.id, 'account-1');
  }
  const deposit = await invoke(handler, { method: 'POST', path: '/api/wallet/deposits', cookie: cookieFrom(second), body: { amount: 25, provider: 'venmo', checkoutId: 'shared_deposit_123' } });
  assert.equal(deposit.status, 201);
  assert.equal(calls.deposits[0][0], 'account-1');
});

test('saving an existing name switches wallet without renaming or overwriting either owner', async () => {
  const { handler, calls } = fixture();
  const john = await invoke(handler, { method: 'POST', path: '/api/session', body: { profile: { name: 'John String', bio: 'John bio' } } });
  const alex = await invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'Alex Rivera' } });
  const switched = await invoke(handler, { method: 'PUT', path: '/api/profile', cookie: cookieFrom(alex), body: { profile: { name: 'john string', bio: 'Alex bio' } } });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.switched, true);
  assert.equal(switched.body.user.id, john.body.user.id);
  assert.equal(switched.body.profile.bio, 'John bio');
  assert.equal(switched.body.account.id, 'account-1');
  assert.equal(calls.updates.length, 0);
  const original = await invoke(handler, { path: '/api/session', cookie: cookieFrom(alex) });
  assert.equal(original.body.profile.name, 'Alex Rivera');
});

function fixture({ purchaseItem, translationService, currencyService } = {}) {
  const calls = { createUsers: [], accountIds: [], accountUpdates: [], updates: [], deposits: [], purchases: [] };
  const balances = new Map([
    ["account-1", 500],
    ["account-2", 700],
  ]);
  const customers = new Map();
  const accountsByCustomer = new Map();
  let userNumber = 0;
  const nessie = {
    accounts: {
      get: async (accountId) => {
        calls.accountIds.push(accountId);
        return {
          _id: accountId,
          nickname: "Dorm.io wallet",
          type: "Checking",
          balance: balances.get(accountId) ?? 0,
          account_number: "1234567890123456",
        };
      },
      update: async (...input) => {
        calls.accountUpdates.push(input);
        return { code: 202 };
      },
      listByCustomer: async (customerId) => {
        const accountId = accountsByCustomer.get(customerId);
        return accountId ? [await nessie.accounts.get(accountId)] : [];
      },
    },
    customers: {
      list: async () => [...customers.values()],
      get: async (customerId) => customers.get(customerId),
      update: async (...input) => {
        calls.updates.push(input);
        const [customerId, changes] = input;
        customers.set(customerId, { ...customers.get(customerId), ...changes, _id: customerId });
        return { code: 202 };
      },
    },
  };
  const marketplace = {
    createUser: async (input) => {
      userNumber += 1;
      calls.createUsers.push(input);
      const customerId = `customer-${userNumber}`;
      const accountId = `account-${userNumber}`;
      customers.set(customerId, { ...input.customer, _id: customerId });
      accountsByCustomer.set(customerId, accountId);
      return {
        customer: { _id: customerId },
        account: { _id: accountId },
        merchant: { _id: `merchant-${userNumber}` },
      };
    },
    addCredits: async (...input) => {
      calls.deposits.push(input);
      return { code: 201, message: "Deposit created" };
    },
    purchaseItem: purchaseItem || (async (input) => {
      calls.purchases.push(input);
      return { status: "settled", purchase: { objectCreated: { _id: "purchase-1" } } };
    }),
  };
  const store = createAppStore();
  return {
    calls,
    nessie,
    store,
    handler: createApiHandler({ nessie, marketplace, store, translationService, currencyService }),
  };
}

test("creates one Nessie customer/account and resumes it from an HttpOnly session", async () => {
  const { handler, calls } = fixture();
  const first = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: {
      profile: {
        name: "Alex Rivera",
        campus: "Somewhere else",
        year: "Junior",
        bio: "Textbooks",
        pickup: "Newman Library",
      },
    },
  });

  assert.equal(first.status, 201);
  assert.match(first.headers["set-cookie"], /HttpOnly/);
  assert.match(first.headers["set-cookie"], /SameSite=Lax/);
  assert.equal(first.body.user.customerId, "customer-1");
  assert.equal(first.body.user.accountId, "account-1");
  assert.equal(first.body.profile.campus, "Virginia Tech");
  assert.equal(first.body.account.account_number, undefined);
  assert.equal(typeof calls.createUsers[0].merchant.category, 'string', 'Nessie MerchantCreate accepts a string category');
  assert.notEqual(cookieFrom(first).split('=')[1], first.body.user.id);
  const forged = await invoke(handler, { path: '/api/wallet', cookie: `dormio_session=${first.body.user.id}` });
  assert.equal(forged.status, 401, 'public seller IDs cannot authenticate');
  assert.deepEqual(calls.createUsers[0].customer, {
    first_name: "Alex",
    last_name: "Rivera",
    address: {
      street_number: "800",
      street_name: "Drillfield Drive",
      city: "Blacksburg",
      state: "VA",
      zip: "24061",
    },
  });

  const resumed = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    cookie: cookieFrom(first),
    body: { profile: { name: "A different browser value" } },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.user.id, first.body.user.id);
  assert.equal(resumed.body.profile.name, "Alex Rivera");
  assert.equal(calls.createUsers.length, 1);
});

async function saleFixture(options) {
  const context = fixture(options);
  const { handler } = context;
  const seller = await invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'Seller Student' } });
  const buyer = await invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'Buyer Student' } });
  const listingBody = { title: 'Desk lamp', price: 18.5, category: 'Dorm essentials', condition: 'Good', description: 'A desk lamp.', image: 'data:image/png;base64,iVBORw0KGgo=' };
  const listing = await invoke(handler, { method: 'POST', path: '/api/listings', cookie: cookieFrom(seller), body: listingBody });
  return { ...context, seller, buyer, listingBody, listingId: listing.body.listing.id };
}

test('concurrent deposit retries create only one credit', async () => {
  const { handler, calls } = fixture();
  const session = await invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'Buyer Student' } });
  const input = { method: 'POST', path: '/api/wallet/deposits', cookie: cookieFrom(session), body: { amount: 25, provider: 'venmo', checkoutId: 'concurrent_deposit' } };
  const results = await Promise.all([invoke(handler, input), invoke(handler, input)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(calls.deposits.length, 1);
});

test('a deposit survives a failed wallet refresh and rejects changed retry details', async () => {
  const { handler, calls, nessie } = fixture();
  const session = await invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'Buyer Student' } });
  const input = { method: 'POST', path: '/api/wallet/deposits', cookie: cookieFrom(session), body: { amount: 25, provider: 'venmo', checkoutId: 'refresh_deposit' } };
  nessie.deposits = { listByAccount: async () => { throw new Error('offline'); } };
  assert.equal((await invoke(handler, input)).status, 502);
  nessie.deposits.listByAccount = async () => [{ amount: 25, status: 'completed' }];
  const retry = await invoke(handler, input);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.account.balance, 525);
  assert.equal(calls.deposits.length, 1);
  assert.equal((await invoke(handler, { ...input, body: { ...input.body, amount: 50 } })).status, 409);
  assert.equal(calls.deposits.length, 1);
});

test('concurrent purchases cannot sell one listing twice', async () => {
  const { handler, calls, buyer, listingId } = await saleFixture();
  const results = await Promise.all(['first_checkout', 'second_checkout'].map(checkoutId => invoke(handler, {
    method: 'POST', path: `/api/listings/${listingId}/purchase`, cookie: cookieFrom(buyer), body: { checkoutId },
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(calls.purchases.length, 1);
});

test('concurrent retries return the same purchase order', async () => {
  const { handler, calls, buyer, listingId } = await saleFixture();
  const input = { method: 'POST', path: `/api/listings/${listingId}/purchase`, cookie: cookieFrom(buyer), body: { checkoutId: 'same_checkout' } };
  const results = await Promise.all([invoke(handler, input), invoke(handler, input)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(results[0].body.order.id, results[1].body.order.id);
  assert.equal(calls.purchases.length, 1);
});

test('backend rejects purchases exceeding the available wallet balance', async () => {
  const { handler, calls, buyer, listingId, store } = await saleFixture();
  await store.updateListing(listingId, { price: 701 });
  const result = await invoke(handler, { method: 'POST', path: `/api/listings/${listingId}/purchase`, cookie: cookieFrom(buyer), body: { checkoutId: 'expensive_checkout' } });
  assert.equal(result.status, 409);
  assert.equal(calls.purchases.length, 0);
  assert.equal((await store.getListing(listingId)).sold, false);
  await store.updateListing(listingId, { price: 20 });
  assert.equal((await invoke(handler, { method: 'POST', path: `/api/listings/${listingId}/purchase`, cookie: cookieFrom(buyer), body: { checkoutId: 'affordable_checkout' } })).status, 201, 'a rejected payment does not block subsequent payments');
});

test('a checkout ID cannot be reused for a different listing', async () => {
  const { handler, seller, buyer, listingId, listingBody, calls } = await saleFixture();
  const input = { method: 'POST', path: `/api/listings/${listingId}/purchase`, cookie: cookieFrom(buyer), body: { checkoutId: 'reused_checkout' } };
  assert.equal((await invoke(handler, input)).status, 201);
  const other = await invoke(handler, { method: 'POST', path: '/api/listings', cookie: cookieFrom(seller), body: listingBody });
  assert.equal((await invoke(handler, { ...input, path: `/api/listings/${other.body.listing.id}/purchase` })).status, 409);
  assert.equal(calls.purchases.length, 1);
});

test('a failed wallet refresh after settlement cannot reopen or recharge the listing', async () => {
  let failLedger = false;
  let charges = 0;
  const { handler, buyer, listingId, nessie, store } = await saleFixture({ purchaseItem: async () => {
    charges += 1;
    failLedger = true;
    return { status: 'settled' };
  } });
  nessie.purchases = { listByAccount: async () => { if (failLedger) throw new Error('offline'); return []; } };
  const input = { method: 'POST', path: `/api/listings/${listingId}/purchase`, cookie: cookieFrom(buyer), body: { checkoutId: 'refresh_checkout' } };
  assert.equal((await invoke(handler, input)).status, 502);
  assert.equal((await store.getListing(listingId)).sold, true);
  failLedger = false;
  assert.equal((await invoke(handler, input)).status, 200);
  assert.equal(charges, 1);
});

test('wallet reads fail instead of displaying a balance from an incomplete ledger', async () => {
  const { handler, nessie } = fixture();
  const session = await invoke(handler, { method: 'POST', path: '/api/session', body: { name: 'Buyer Student' } });
  nessie.purchases = { listByAccount: async () => { throw new Error('offline'); } };
  assert.equal((await invoke(handler, { path: '/api/wallet', cookie: cookieFrom(session) })).status, 502);
});

test('listing uploads accept 2 MB of image bytes and reject larger images', async () => {
  const { handler, seller, listingBody } = await saleFixture();
  for (const [bytes, status] of [[2_000_000, 201], [2_000_001, 400]]) {
    const result = await invoke(handler, { method: 'POST', path: '/api/listings', cookie: cookieFrom(seller), body: { ...listingBody, image: `data:image/png;base64,${Buffer.alloc(bytes).toString('base64')}` } });
    assert.equal(result.status, status);
  }
});

test('non-object JSON bodies and malformed session cookies receive client errors', async () => {
  const { handler } = fixture();
  for (const body of [null, [], 'text', 5, { profile: null }]) {
    assert.equal((await invoke(handler, { method: 'POST', path: '/api/session', body })).status, 400);
  }
  assert.equal((await invoke(handler, { path: '/api/wallet', cookie: 'dormio_session=%zz' })).status, 401);
});

test("isolates wallet and profile operations by the current session", async () => {
  const { handler, calls } = fixture();
  const alex = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Alex Rivera" } },
  });
  const sam = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Sam Lee" } },
  });

  const alexWallet = await invoke(handler, {
    path: "/api/wallet",
    cookie: cookieFrom(alex),
  });
  const samWallet = await invoke(handler, {
    path: "/api/wallet",
    cookie: cookieFrom(sam),
  });
  assert.equal(alexWallet.body.account.id, "account-1");
  assert.equal(alexWallet.body.account.balance, 500);
  assert.equal(samWallet.body.account.id, "account-2");
  assert.equal(samWallet.body.account.balance, 700);

  const updated = await invoke(handler, {
    method: "PUT",
    path: "/api/profile",
    cookie: cookieFrom(sam),
    body: { profile: { name: "Samantha Lee", year: "Senior" } },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.profile.name, "Samantha Lee");
  assert.equal(calls.updates[0][0], "customer-2");
  assert.equal(calls.updates[0][1].first_name, "Samantha");
  assert.deepEqual(calls.accountUpdates[0], ["account-2", { nickname: "Samantha Lee" }]);
});

test("persists deposit idempotency within the owning user", async () => {
  const { handler, calls } = fixture();
  const session = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Alex Rivera" } },
  });
  const input = {
    method: "POST",
    path: "/api/wallet/deposits",
    cookie: cookieFrom(session),
    body: { amount: 25, provider: "venmo", checkoutId: "checkout_12345" },
  };

  const first = await invoke(handler, input);
  const second = await invoke(handler, input);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(calls.deposits.length, 1);
  assert.equal(calls.deposits[0][0], "account-1");
  assert.equal(calls.deposits[0][1], 25);
  assert.match(calls.deposits[0][2].description, /Test venmo wallet top-up/);
});

test("rejects wallet access without a valid session", async () => {
  const { handler } = fixture();
  const response = await invoke(handler, { path: "/api/wallet" });
  assert.equal(response.status, 401);
  assert.match(response.body.error, /session/i);
});

test("owns listings by app user and settles a purchase between mapped accounts", async () => {
  const { handler, calls } = fixture();
  const seller = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Seller Student" } },
  });
  const buyer = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Buyer Student" } },
  });
  const created = await invoke(handler, {
    method: "POST",
    path: "/api/listings",
    cookie: cookieFrom(seller),
    body: {
      title: "Desk lamp",
      price: 18.5,
      category: "Dorm essentials",
      condition: "Good",
      description: "A useful lamp for a dorm desk.",
      image: "data:image/png;base64,iVBORw0KGgo=",
      location: "Newman Library",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.listing.sellerUserId, seller.body.user.id);

  const input = {
    method: "POST",
    path: `/api/listings/${created.body.listing.id}/purchase`,
    cookie: cookieFrom(buyer),
    body: { checkoutId: "purchase_checkout_123" },
  };
  const first = await invoke(handler, input);
  const repeated = await invoke(handler, input);

  assert.equal(first.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(calls.purchases.length, 1);
  assert.equal(calls.purchases[0].buyerAccountId, "account-2");
  assert.equal(calls.purchases[0].sellerAccountId, "account-1");
  assert.equal(calls.purchases[0].merchantId, "merchant-1");
  assert.equal(calls.purchases[0].amount, 18.5);
});

test("persists a retryable order when the buyer charge succeeds before seller credit", async () => {
  const partialError = Object.assign(new Error("seller credit failed"), {
    name: "MarketplaceSettlementError",
    details: { purchase: { objectCreated: { _id: "purchase-partial" } } },
  });
  const { handler } = fixture({ purchaseItem: async () => { throw partialError; } });
  const seller = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Seller Student" } },
  });
  const buyer = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Buyer Student" } },
  });
  const created = await invoke(handler, {
    method: "POST",
    path: "/api/listings",
    cookie: cookieFrom(seller),
    body: {
      title: "Desk lamp",
      price: 18.5,
      category: "Dorm essentials",
      condition: "Good",
      description: "A useful lamp for a dorm desk.",
      image: "data:image/png;base64,iVBORw0KGgo=",
    },
  });
  const input = {
    method: "POST",
    path: `/api/listings/${created.body.listing.id}/purchase`,
    cookie: cookieFrom(buyer),
    body: { checkoutId: "partial_checkout_123" },
  };

  const response = await invoke(handler, input);
  const repeated = await invoke(handler, input);
  assert.equal(response.status, 202);
  assert.equal(response.body.order.status, "seller_credit_pending");
  assert.equal(response.body.order.purchase.objectCreated._id, "purchase-partial");
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.order.id, response.body.order.id);
});

test("keeps listing conversations in memory, translates for the recipient, and limits access", async () => {
  const translationCalls = [];
  const { handler } = fixture({
    translationService: {
      translate: async (value, targetLanguage) => {
        translationCalls.push([value, targetLanguage]);
        if (value.startsWith("Fallback")) throw new Error("translation unavailable");
        return value.startsWith("Hola")
          ? { sourceLanguage: "es", translatedText: value, translated: false }
          : { sourceLanguage: "en", translatedText: "¿Sigue disponible?", translated: true };
      },
    },
    currencyService: {
      rate: async (currency) => ({ base: "USD", quote: currency, rate: 0.84, date: "2026-09-18" }),
    },
  });
  const seller = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Seller Student" } },
  });
  const buyer = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Buyer Student" } },
  });
  const outsider = await invoke(handler, {
    method: "POST",
    path: "/api/session",
    body: { profile: { name: "Other Student" } },
  });
  const settings = await invoke(handler, {
    method: "PUT",
    path: "/api/profile",
    cookie: cookieFrom(seller),
    body: { profile: { name: "Seller Student", language: "es", currency: "EUR" } },
  });
  assert.equal(settings.body.profile.language, "es");
  assert.equal(settings.body.profile.currency, "EUR");
  const rate = await invoke(handler, {
    path: "/api/exchange-rate?currency=EUR",
    cookie: cookieFrom(seller),
  });
  assert.equal(rate.body.rate, 0.84);
  const created = await invoke(handler, {
    method: "POST",
    path: "/api/listings",
    cookie: cookieFrom(seller),
    body: {
      title: "Desk lamp",
      price: 18.5,
      category: "Dorm essentials",
      condition: "Good",
      description: "A useful lamp for a dorm desk.",
      image: "data:image/png;base64,iVBORw0KGgo=",
    },
  });

  const started = await invoke(handler, {
    method: "POST",
    path: `/api/listings/${created.body.listing.id}/conversations`,
    cookie: cookieFrom(buyer),
  });
  const repeated = await invoke(handler, {
    method: "POST",
    path: `/api/listings/${created.body.listing.id}/conversations`,
    cookie: cookieFrom(buyer),
  });
  assert.equal(started.status, 200);
  assert.equal(repeated.body.conversation.id, started.body.conversation.id);
  assert.equal(started.body.conversation.otherUser.name, "Seller Student");

  const live = await openChatStream(handler, cookieFrom(seller));
  assert.equal(live.result.status, 200);
  assert.match(live.result.headers["content-type"], /text\/event-stream/);

  const sent = await invoke(handler, {
    method: "POST",
    path: `/api/chats/${started.body.conversation.id}/messages`,
    cookie: cookieFrom(buyer),
    body: { text: "Is this still available?" },
  });
  assert.equal(sent.status, 201);
  assert.deepEqual(translationCalls[0], ["Is this still available?", "es"]);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(live.result.chunks.join(""), /¿Sigue disponible\?/);
  live.request.emit("close");

  const sellerChats = await invoke(handler, {
    path: "/api/chats",
    cookie: cookieFrom(seller),
  });
  assert.equal(sellerChats.status, 200);
  assert.equal(sellerChats.body.conversations[0].otherUser.name, "Buyer Student");
  assert.equal(sellerChats.body.conversations[0].messages[0].text, "¿Sigue disponible?");
  assert.equal(sellerChats.body.conversations[0].messages[0].originalText, "Is this still available?");
  assert.equal(sellerChats.body.conversations[0].messages[0].translated, true);

  const buyerChats = await invoke(handler, {
    path: "/api/chats",
    cookie: cookieFrom(buyer),
  });
  assert.equal(buyerChats.body.conversations[0].messages[0].text, "Is this still available?");
  assert.equal(buyerChats.body.conversations[0].messages[0].translated, false);

  await invoke(handler, {
    method: "POST",
    path: `/api/chats/${started.body.conversation.id}/messages`,
    cookie: cookieFrom(buyer),
    body: { text: "Hola, ¿sigue disponible?" },
  });
  const sameLanguage = await invoke(handler, {
    path: "/api/chats",
    cookie: cookieFrom(seller),
  });
  assert.equal(sameLanguage.body.conversations[0].messages[1].translated, false);
  assert.equal("originalText" in sameLanguage.body.conversations[0].messages[1], false);

  const fallbackSent = await invoke(handler, {
    method: "POST",
    path: `/api/chats/${started.body.conversation.id}/messages`,
    cookie: cookieFrom(buyer),
    body: { text: "Fallback message" },
  });
  assert.equal(fallbackSent.status, 201);
  const fallbackChats = await invoke(handler, {
    path: "/api/chats",
    cookie: cookieFrom(seller),
  });
  assert.equal(fallbackChats.body.conversations[0].messages[2].text, "Fallback message");
  assert.equal(fallbackChats.body.conversations[0].messages[2].translated, false);
  assert.equal("originalText" in fallbackChats.body.conversations[0].messages[2], false);

  const forbidden = await invoke(handler, {
    method: "POST",
    path: `/api/chats/${started.body.conversation.id}/messages`,
    cookie: cookieFrom(outsider),
    body: { text: "Hello" },
  });
  assert.equal(forbidden.status, 403);
});
