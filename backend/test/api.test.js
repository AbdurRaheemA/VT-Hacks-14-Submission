import assert from "node:assert/strict";
import test from "node:test";

import { createApiHandler } from "../src/api.js";

async function invoke(handler, { method = "GET", path, body } = {}) {
  const request = {
    method,
    url: path,
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

test("returns the configured wallet without exposing its account number", async () => {
  const nessie = {
    accounts: {
      get: async () => ({
        _id: "account-1",
        nickname: "Demo wallet",
        type: "Checking",
        balance: 500,
        account_number: "1234567890123456",
      }),
    },
  };
  const handler = createApiHandler({ nessie, marketplace: {}, accountId: "account-1" });

  const response = await invoke(handler, { path: "/api/wallet" });
  assert.equal(response.status, 200);
  assert.equal(response.body.account.balance, 500);
  assert.equal(response.body.account.account_number, undefined);
});

test("converts a test checkout into one idempotent Nessie deposit", async () => {
  const deposits = [];
  const nessie = {
    accounts: {
      get: async () => ({
        _id: "account-1",
        nickname: "Demo wallet",
        type: "Checking",
        balance: 525,
      }),
    },
  };
  const marketplace = {
    addCredits: async (...input) => {
      deposits.push(input);
      return { code: 201, message: "Deposit created" };
    },
  };
  const handler = createApiHandler({ nessie, marketplace, accountId: "account-1" });

  const input = {
    method: "POST",
    path: "/api/wallet/deposits",
    body: { amount: 25, provider: "venmo", checkoutId: "checkout_12345" },
  };
  const first = await invoke(handler, input);
  const second = await invoke(handler, input);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0][0], "account-1");
  assert.equal(deposits[0][1], 25);
  assert.match(deposits[0][2].description, /Test venmo wallet top-up/);
  assert.equal(second.body.account.balance, 525);
});

test("rejects unsupported providers and out-of-range amounts", async () => {
  const handler = createApiHandler({ nessie: {}, marketplace: {}, accountId: "account-1" });

  const response = await invoke(handler, {
    method: "POST",
    path: "/api/wallet/deposits",
    body: { amount: 1000, provider: "cash", checkoutId: "checkout_12345" },
  });
  assert.equal(response.status, 400);
});
