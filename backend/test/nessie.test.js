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
