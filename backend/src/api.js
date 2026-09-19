const testProviders = new Set(["stripe", "venmo", "paypal", "cashapp"]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("request body is too large.");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("request body must be valid JSON.");
  }
}

function publicAccount(account, balance = account.balance) {
  return {
    id: account._id,
    nickname: account.nickname,
    type: account.type,
    balance,
  };
}

function completedTotal(items) {
  return items
    .filter((item) => !["cancelled", "pending"].includes(item.status))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

async function walletSnapshot(nessie, accountId) {
  const account = await nessie.accounts.get(accountId);
  const loaders = [
    nessie.deposits?.listByAccount?.(accountId),
    nessie.withdrawals?.listByAccount?.(accountId),
    nessie.purchases?.listByAccount?.(accountId),
  ].map((request) => request ?? Promise.resolve([]));
  const results = await Promise.allSettled(loaders);
  const [deposits, withdrawals, purchases] = results.map((result) =>
    result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [],
  );
  const balance =
    Number(account.balance) +
    completedTotal(deposits) -
    completedTotal(withdrawals) -
    completedTotal(purchases);
  return {
    account: publicAccount(account, balance),
    ledger: {
      deposits: completedTotal(deposits),
      withdrawals: completedTotal(withdrawals),
      purchases: completedTotal(purchases),
    },
  };
}

function validateDeposit(body) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    throw new Error("amount must be between $1 and $500.");
  }
  if (!testProviders.has(body.provider)) {
    throw new Error("provider must be stripe, venmo, paypal, or cashapp.");
  }
  if (typeof body.checkoutId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.checkoutId)) {
    throw new Error("checkoutId is invalid.");
  }
  return { amount: Math.round(amount * 100) / 100, provider: body.provider, checkoutId: body.checkoutId };
}

export function createApiHandler({ nessie, marketplace, accountId }) {
  if (!accountId) throw new Error("NESSIE_ACCOUNT_ID is required.");
  const completedDeposits = new Map();

  return async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/wallet") {
        sendJson(response, 200, await walletSnapshot(nessie, accountId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/wallet/deposits") {
        const input = validateDeposit(await readJson(request));
        const existing = completedDeposits.get(input.checkoutId);
        if (existing) {
          sendJson(response, 200, existing);
          return;
        }

        const deposit = await marketplace.addCredits(accountId, input.amount, {
          description: `Test ${input.provider} wallet top-up [checkout:${input.checkoutId}]`,
        });
        const snapshot = await walletSnapshot(nessie, accountId);
        const result = {
          testMode: true,
          provider: input.provider,
          checkoutId: input.checkoutId,
          deposit,
          ...snapshot,
        };
        completedDeposits.set(input.checkoutId, result);
        sendJson(response, 201, result);
        return;
      }

      sendJson(response, 404, { error: "route not found." });
    } catch (error) {
      const clientError = error instanceof TypeError || error.message?.startsWith("amount") || error.message?.startsWith("provider") || error.message?.startsWith("checkoutId") || error.message?.startsWith("request body");
      sendJson(response, clientError ? 400 : 502, {
        error: clientError ? error.message : "Nessie could not complete the wallet request.",
      });
    }
  };
}
