import { randomUUID, randomBytes, createHash } from "node:crypto";
import { normalizeName } from './app-store.js';

const testProviders = new Set(["stripe", "venmo", "paypal", "cashapp"]);
const sessionCookieName = "dormio_session";
const campusAddress = Object.freeze({
  street_number: "800",
  street_name: "Drillfield Drive",
  city: "Blacksburg",
  state: "VA",
  zip: "24061",
});
const campusGeocode = Object.freeze({ lat: 37.2284, lng: -80.4234 });

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2_500_000) throw new ApiError(413, "request body is too large.");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new ApiError(400, "request body must be valid JSON.");
  }
}

function cookieValue(request, name) {
  const cookie = request.headers?.cookie || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function sessionCookie(id, secure) {
  return [
    `${sessionCookieName}=${encodeURIComponent(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=2592000",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
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

function text(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function validateProfile(value = {}) {
  return {
    name: text(value.name, "Dorm.io Student", 40),
    campus: "Virginia Tech",
    year: text(value.year, "Other", 20),
    bio: typeof value.bio === "string" ? value.bio.trim().slice(0, 160) : "",
    pickup: typeof value.pickup === "string" ? value.pickup.trim().slice(0, 80) : "",
  };
}

function customerName(name) {
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  return {
    first_name: firstName || "Dorm.io",
    last_name: rest.join(" ") || "Student",
  };
}

function customerInput(profile) {
  return { ...customerName(profile.name), address: campusAddress };
}

function publicUser(user) {
  return {
    id: user.id,
    customerId: user.customerId,
    accountId: user.accountId,
  };
}

function validateDeposit(body) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    throw new ApiError(400, "amount must be between $1 and $500.");
  }
  if (!testProviders.has(body.provider)) {
    throw new ApiError(400, "provider must be stripe, venmo, paypal, or cashapp.");
  }
  if (typeof body.checkoutId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.checkoutId)) {
    throw new ApiError(400, "checkoutId is invalid.");
  }
  return {
    amount: Math.round(amount * 100) / 100,
    provider: body.provider,
    checkoutId: body.checkoutId,
  };
}

function listingText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${name} is required.`);
  }
  return value.trim().slice(0, maxLength);
}

function validateListing(body) {
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0 || price > 10_000) {
    throw new ApiError(400, "price must be between $0 and $10,000.");
  }
  if (
    typeof body.image !== "string" ||
    !/^data:image\/(jpeg|png|webp);base64,/.test(body.image) ||
    body.image.length > 2_100_000
  ) {
    throw new ApiError(400, "image must be a JPG, PNG, or WebP under 2 MB.");
  }
  return {
    title: listingText(body.title, "title", 70),
    price: Math.round(price * 100) / 100,
    category: listingText(body.category, "category", 40),
    condition: listingText(body.condition, "condition", 20),
    description: listingText(body.description, "description", 1_200),
    image: body.image,
    location: text(body.location, "On campus", 80),
  };
}

export function createApiHandler({ nessie, marketplace, store, secureCookies = false }) {
  if (!store) throw new TypeError("store is required.");
  // Serialize name resolution and session attachment in this single-process demo.
  let identityQueue = Promise.resolve();
  function identityChange(work) {
    const result = identityQueue.then(work);
    identityQueue = result.catch(() => {});
    return result;
  }
  async function attachSession(user) {
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    await store.updateUser(user.id, { sessionHashes: [...(user.sessionHashes || []), hash] });
    return { 'set-cookie': sessionCookie(token, secureCookies) };
  }

  async function currentUser(request) {
    const token = cookieValue(request, sessionCookieName);
    return token ? store.getUserBySession(createHash('sha256').update(token).digest('hex')) : undefined;
  }

  async function requireUser(request) {
    const user = await currentUser(request);
    if (!user) throw new ApiError(401, "Start a Dorm.io session before using this route.");
    return user;
  }

  return async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/session") {
        const body = await readJson(request);
        if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40)) {
          throw new ApiError(400, 'name must contain between 1 and 40 characters.');
        }
        await identityChange(async () => {
        const existing = await currentUser(request);
        const profile = validateProfile(body.name !== undefined ? { name: body.name } : body.profile);
        const matched = await store.getUserByName(profile.name);
        const selected = body.name === undefined && existing ? existing : matched;
        if (selected) {
          sendJson(response, 200, {
            user: publicUser(selected),
            profile: selected.profile,
            ...(await walletSnapshot(nessie, selected.accountId)),
          }, await attachSession(selected));
          return;
        }

        const created = await marketplace.createUser({
          customer: customerInput(profile),
          account: { nickname: "Dorm.io wallet", balance: 500 },
          merchant: {
            name: `${profile.name} on Dorm.io`,
            category: "Campus marketplace",
            address: campusAddress,
            geocode: campusGeocode,
          },
        });
        const token = randomBytes(32).toString('hex');
        const user = await store.createUser({
          id: randomUUID(),
          sessionHash: createHash('sha256').update(token).digest('hex'),
          customerId: created.customer._id,
          accountId: created.account._id,
          merchantId: created.merchant._id,
          profile,
          createdAt: new Date().toISOString(),
        });
        sendJson(
          response,
          201,
          {
            user: publicUser(user),
            profile,
            ...(await walletSnapshot(nessie, user.accountId)),
          },
          { "set-cookie": sessionCookie(token, secureCookies) },
        );
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/session") {
        const user = await requireUser(request);
        sendJson(response, 200, { user: publicUser(user), profile: user.profile });
        return;
      }

      if (request.method === "PUT" && url.pathname === "/api/profile") {
        const body = await readJson(request);
        await identityChange(async () => {
        const user = await requireUser(request);
        const profile = validateProfile(body.profile);
        const matched = await store.getUserByName(profile.name);
        if (matched && matched.id !== user.id) {
          sendJson(response, 200, {
            user: publicUser(matched), profile: matched.profile, switched: true,
            ...(await walletSnapshot(nessie, matched.accountId)),
          }, await attachSession(matched));
          return;
        }
        if (normalizeName(profile.name) !== normalizeName(user.profile.name)) {
          await nessie.customers.update(user.customerId, customerInput(profile));
        }
        const updated = await store.updateUser(user.id, { profile, updatedAt: new Date().toISOString() });
        sendJson(response, 200, { user: publicUser(updated), profile: updated.profile });
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/wallet") {
        const user = await requireUser(request);
        sendJson(response, 200, {
          user: publicUser(user),
          ...(await walletSnapshot(nessie, user.accountId)),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/wallet/deposits") {
        const user = await requireUser(request);
        const input = validateDeposit(await readJson(request));
        const idempotencyKey = `${user.id}:${input.checkoutId}`;
        const existing = await store.getIdempotency(idempotencyKey);
        if (existing) {
          sendJson(response, 200, existing);
          return;
        }

        const deposit = await marketplace.addCredits(user.accountId, input.amount, {
          description: `Test ${input.provider} wallet top-up [checkout:${input.checkoutId}]`,
        });
        const result = {
          testMode: true,
          provider: input.provider,
          checkoutId: input.checkoutId,
          deposit,
          user: publicUser(user),
          ...(await walletSnapshot(nessie, user.accountId)),
        };
        await store.putIdempotency(idempotencyKey, result);
        sendJson(response, 201, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/listings") {
        const listings = (await store.listListings()).filter((listing) => !listing.deletedAt);
        sendJson(response, 200, { listings });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/listings") {
        const user = await requireUser(request);
        const input = validateListing(await readJson(request));
        const listing = await store.createListing({
          id: randomUUID(),
          ...input,
          sellerUserId: user.id,
          seller: user.profile.name,
          campus: "Virginia Tech",
          sold: false,
          createdAt: new Date().toISOString(),
        });
        sendJson(response, 201, { listing });
        return;
      }

      const listingMatch = url.pathname.match(/^\/api\/listings\/([a-f0-9-]+)$/i);
      if (request.method === "DELETE" && listingMatch) {
        const user = await requireUser(request);
        const listing = await store.getListing(listingMatch[1]);
        if (!listing || listing.deletedAt) throw new ApiError(404, "listing not found.");
        if (listing.sellerUserId !== user.id) {
          throw new ApiError(403, "only the seller can remove this listing.");
        }
        await store.updateListing(listing.id, { deletedAt: new Date().toISOString() });
        sendJson(response, 200, { ok: true });
        return;
      }

      const purchaseMatch = url.pathname.match(/^\/api\/listings\/([a-f0-9-]+)\/purchase$/i);
      if (request.method === "POST" && purchaseMatch) {
        const buyer = await requireUser(request);
        const listing = await store.getListing(purchaseMatch[1]);
        if (!listing || listing.deletedAt) throw new ApiError(404, "listing not found.");
        const body = await readJson(request);
        if (typeof body.checkoutId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.checkoutId)) {
          throw new ApiError(400, "checkoutId is invalid.");
        }
        const idempotencyKey = `${buyer.id}:purchase:${body.checkoutId}`;
        const existing = await store.getIdempotency(idempotencyKey);
        if (existing) {
          sendJson(response, 200, existing);
          return;
        }
        if (listing.sellerUserId === buyer.id) {
          throw new ApiError(400, "you cannot purchase your own listing.");
        }
        if (listing.sold) throw new ApiError(409, "listing has already been sold.");
        const seller = await store.getUser(listing.sellerUserId);
        if (!seller?.merchantId || !seller?.accountId) {
          throw new ApiError(409, "seller payment account is unavailable.");
        }

        await store.updateListing(listing.id, { sold: true, saleStatus: "processing" });
        try {
          const settlement =
            listing.price === 0
              ? { status: "settled", purchase: null, sellerCredit: null }
              : await marketplace.purchaseItem({
                  buyerAccountId: buyer.accountId,
                  sellerAccountId: seller.accountId,
                  merchantId: seller.merchantId,
                  amount: listing.price,
                  itemId: listing.id,
                });
          const order = await store.createOrder({
            id: randomUUID(),
            checkoutId: body.checkoutId,
            listingId: listing.id,
            buyerUserId: buyer.id,
            sellerUserId: seller.id,
            amount: listing.price,
            status: "settled",
            createdAt: new Date().toISOString(),
          });
          await store.updateListing(listing.id, { saleStatus: "settled", orderId: order.id });
          const result = { order, settlement, ...(await walletSnapshot(nessie, buyer.accountId)) };
          await store.putIdempotency(idempotencyKey, result);
          sendJson(response, 201, result);
        } catch (error) {
          if (error?.name === "MarketplaceSettlementError") {
            const order = await store.createOrder({
              id: randomUUID(),
              checkoutId: body.checkoutId,
              listingId: listing.id,
              buyerUserId: buyer.id,
              sellerUserId: seller.id,
              amount: listing.price,
              status: "seller_credit_pending",
              purchase: error.details?.purchase,
              createdAt: new Date().toISOString(),
            });
            await store.updateListing(listing.id, { saleStatus: "seller_credit_pending" });
            const result = {
              order,
              settlement: { status: "seller_credit_pending" },
              ...(await walletSnapshot(nessie, buyer.accountId)),
            };
            await store.putIdempotency(idempotencyKey, result);
            sendJson(response, 202, result);
            return;
          } else {
            await store.updateListing(listing.id, { sold: false, saleStatus: undefined });
          }
          throw error;
        }
        return;
      }

      sendJson(response, 404, { error: "route not found." });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 502;
      sendJson(response, status, {
        error: status < 500 ? error.message : "Nessie could not complete the request.",
      });
    }
  };
}
