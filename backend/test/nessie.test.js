import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketplaceService,
  createNessieClient,
  MarketplaceSettlementError,
  NessieHttpError,
} from "../src/index.js";

function jsonResponse(body, init = {}) {
  return Response.json(body, init);
}

test("loads the API key from the environment and calls a customer route", async () => {
  const calls = [];
  const nessie = createNessieClient({
    apiKey: "test-key",
    baseUrl: "https://nessie.test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse([{ _id: "customer-1" }]);
    },
  });

  const result = await nessie.customers.list();

  assert.deepEqual(result, [{ _id: "customer-1" }]);
  assert.equal(calls[0].url.pathname, "/customers");
  assert.equal(calls[0].url.searchParams.get("key"), "test-key");
  assert.equal(calls[0].init.method, "GET");
});

test("maps all marketplace resource write routes and bodies", async () => {
  const calls = [];
  const nessie = createNessieClient({
    apiKey: "test-key",
    baseUrl: "https://nessie.test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ code: 201, message: "created" });
    },
  });

  await nessie.deposits.create("account-1", { amount: 10 });
  await nessie.withdrawals.create("account-1", { amount: 5 });
  await nessie.purchases.create("account-1", { amount: 4 });
  await nessie.bills.create("account-1", { payment_amount: 4 });
  await nessie.merchants.create({ name: "Seller" });

  assert.deepEqual(
    calls.map(({ url }) => url.pathname),
    [
      "/accounts/account-1/deposits",
      "/accounts/account-1/withdrawals",
      "/accounts/account-1/purchases",
      "/accounts/account-1/bills",
      "/merchants",
    ],
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: 10 });
  assert.ok(calls.every(({ init }) => init.method === "POST"));
});

test("lists customer deposits across the customer's accounts", async () => {
  const calls = [];
  const nessie = createNessieClient({
    apiKey: "test-key",
    baseUrl: "https://nessie.test",
    fetch: async (url) => {
      calls.push(url.pathname);
      if (url.pathname === "/customers/customer-1/accounts") {
        return jsonResponse([{ _id: "account-1" }, { _id: "account-2" }]);
      }
      if (url.pathname === "/accounts/account-1/deposits") {
        return jsonResponse([{ _id: "deposit-1", amount: 25 }]);
      }
      return jsonResponse([{ _id: "deposit-2", amount: 10, account_id: "account-2" }]);
    },
  });

  const deposits = await nessie.deposits.listByCustomer("customer-1");

  assert.deepEqual(calls, [
    "/customers/customer-1/accounts",
    "/accounts/account-1/deposits",
    "/accounts/account-2/deposits",
  ]);
  assert.deepEqual(
    deposits.map((deposit) => [deposit._id, deposit.account_id]),
    [["deposit-1", "account-1"], ["deposit-2", "account-2"]],
  );
});

test("resolves a customer wallet and derives balance from its ledger", async () => {
  const created = [];
  const deposits = [{ amount: 25, status: "completed" }];
  const nessie = {
    customers: {},
    accounts: {
      listByCustomer: async () => [
        { _id: "account-1", type: "Checking", balance: 500 },
      ],
      get: async () => ({ _id: "account-1", type: "Checking", balance: 500 }),
    },
    deposits: {
      listByAccount: async () => deposits,
      create: async (accountId, body) => {
        created.push({ accountId, body });
        deposits.push(body);
        return { objectCreated: { _id: "deposit-2", ...body } };
      },
    },
    withdrawals: { listByAccount: async () => [] },
    purchases: { listByAccount: async () => [] },
  };
  const marketplace = createMarketplaceService(nessie);

  const before = await marketplace.getCustomerWallet("customer-1");
  const after = await marketplace.addCreditsForCustomer("customer-1", 10, {
    date: "2026-09-19",
  });

  assert.equal(before.account.base_balance, 500);
  assert.equal(before.account.balance, 525);
  assert.equal(after.account.balance, 535);
  assert.equal(after.accountId, "account-1");
  assert.equal(created[0].accountId, "account-1");
});

test("creates a customer, wallet account, and seller merchant for an app user", async () => {
  const calls = [];
  const nessie = createNessieClient({
    apiKey: "test-key",
    baseUrl: "https://nessie.test",
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const resource = calls.length === 1 ? "customer" : calls.length === 2 ? "account" : "merchant";
      return jsonResponse({ objectCreated: { _id: `${resource}-1` } }, { status: 201 });
    },
  });

  const result = await createMarketplaceService(nessie).createUser({
    customer: { first_name: "Alex", last_name: "Rivera" },
    account: { balance: 500 },
    merchant: { name: "Alex on Dorm.io" },
  });

  assert.equal(result.customer._id, "customer-1");
  assert.equal(result.account._id, "account-1");
  assert.equal(result.merchant._id, "merchant-1");
  assert.equal(calls[1].body.nickname, "Alex Rivera");
  assert.deepEqual(
    calls.map(({ url }) => url.pathname),
    ["/customers", "/customers/customer-1/accounts", "/merchants"],
  );
});

test("settles a marketplace purchase into the seller account", async () => {
  const calls = [];
  const nessie = createNessieClient({
    apiKey: "test-key",
    baseUrl: "https://nessie.test",
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ code: 201, message: "created" });
    },
  });
  const marketplace = createMarketplaceService(nessie);

  const result = await marketplace.purchaseItem({
    buyerAccountId: "buyer-account",
    sellerAccountId: "seller-account",
    merchantId: "seller-merchant",
    amount: 25,
    itemId: "listing-42",
    date: "2026-09-19",
  });

  assert.equal(result.status, "settled");
  assert.equal(calls[0].url.pathname, "/accounts/buyer-account/purchases");
  assert.equal(calls[0].body.description, "Marketplace purchase [item:listing-42]");
  assert.equal(calls[1].url.pathname, "/accounts/seller-account/deposits");
  assert.equal(calls[1].body.amount, 25);
});

test("surfaces a partial settlement when the seller credit fails", async () => {
  let callCount = 0;
  const nessie = createNessieClient({
    apiKey: "test-key",
    baseUrl: "https://nessie.test",
    fetch: async () => {
      callCount += 1;
      return callCount === 1
        ? jsonResponse({ code: 201, message: "created", objectCreated: { _id: "purchase-1" } })
        : jsonResponse({ message: "failed" }, { status: 500 });
    },
  });
  const marketplace = createMarketplaceService(nessie);

  await assert.rejects(
    marketplace.purchaseItem({
      buyerAccountId: "buyer-account",
      sellerAccountId: "seller-account",
      merchantId: "seller-merchant",
      amount: 25,
    }),
    (error) => {
      assert.ok(error instanceof MarketplaceSettlementError);
      assert.equal(error.details.purchase.objectCreated._id, "purchase-1");
      assert.ok(error.cause instanceof NessieHttpError);
      return true;
    },
  );
});

test("throws a redacted HTTP error without including the API key", async () => {
  const nessie = createNessieClient({
    apiKey: "super-secret-key",
    baseUrl: "https://nessie.test",
    maxRetries: 0,
    fetch: async () => jsonResponse({ message: "not found" }, { status: 404 }),
  });

  await assert.rejects(nessie.customers.get("missing"), (error) => {
    assert.ok(error instanceof NessieHttpError);
    assert.equal(error.status, 404);
    assert.equal(error.path, "/customers/missing");
    assert.equal(error.message.includes("super-secret-key"), false);
    return true;
  });
});
