import assert from "node:assert/strict";
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

function fixture({ purchaseItem } = {}) {
  const calls = { createUsers: [], accountIds: [], updates: [], deposits: [], purchases: [] };
  const balances = new Map([
    ["account-1", 500],
    ["account-2", 700],
  ]);
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
    },
    customers: {
      update: async (...input) => {
        calls.updates.push(input);
        return { code: 202 };
      },
    },
  };
  const marketplace = {
    createUser: async (input) => {
      userNumber += 1;
      calls.createUsers.push(input);
      return {
        customer: { _id: `customer-${userNumber}` },
        account: { _id: `account-${userNumber}` },
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
    handler: createApiHandler({ nessie, marketplace, store }),
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
