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

function customerDisplayName(customer) {
  return [customer.first_name, customer.last_name]
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => part.trim())
    .join(" ");
}

function createdObject(result, resourceName) {
  const object = result && typeof result === "object" ? result.objectCreated : undefined;
  if (!object?._id) throw new ApiError(502, `Nessie did not return the created ${resourceName}.`);
  return object;
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
  // serialize identity changes in this single-process demo.
  let identityQueue = Promise.resolve();
  const conversations = new Map();
  const chatClients = new Map();
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
    return refreshUser(user);
  }

  async function matchingCustomers(name) {
    const normalized = normalizeName(name);
    return (await nessie.customers.list()).filter(
      (customer) => normalizeName(customerDisplayName(customer)) === normalized,
    );
  }

  async function customerCandidates(customers) {
    return Promise.all(
      customers.map(async (customer) => {
        const accounts = await nessie.accounts.listByCustomer(customer._id);
        return {
          customerId: customer._id,
          name: customerDisplayName(customer),
          accounts: accounts.map((account) => ({
            accountId: account._id,
            nickname: account.nickname,
            type: account.type,
            balance: account.balance,
          })),
        };
      }),
    );
  }

  async function resolveCustomer(name, customerId) {
    const matches = await matchingCustomers(name);
    if (customerId) {
      const selected = matches.find((customer) => customer._id === customerId);
      if (!selected) throw new ApiError(400, "customerId does not match the requested name.");
      return selected;
    }
    if (matches.length > 1) {
      const error = new ApiError(409, "More than one Nessie customer uses this display name.");
      error.code = "AMBIGUOUS_NESSIE_CUSTOMER";
      error.candidates = await customerCandidates(matches);
      throw error;
    }
    return matches[0];
  }

  async function ensureAccount(customer, profile) {
    const accounts = await nessie.accounts.listByCustomer(customer._id);
    const existing =
      accounts.find((account) => account.type?.toLowerCase() === "checking") || accounts[0];
    if (existing) return existing;
    const result = await nessie.accounts.create(customer._id, {
      type: "Checking",
      nickname: customerDisplayName(customer) || profile.name,
      rewards: 0,
      balance: 500,
    });
    return createdObject(result, "account");
  }

  async function adoptCustomer(customer, requestedProfile) {
    const name = customerDisplayName(customer) || requestedProfile.name;
    const account = await ensureAccount(customer, requestedProfile);
    const existing = await store.getUserByCustomerId(customer._id);
    if (existing) {
      const profile = { ...existing.profile, name, campus: "Virginia Tech" };
      return store.updateUser(existing.id, {
        customerId: customer._id,
        accountId: account._id,
        profile,
        syncedAt: new Date().toISOString(),
      });
    }
    const merchantResult = await nessie.merchants.create({
      name: `${name} on Dorm.io`,
      category: "Campus marketplace",
      address: campusAddress,
      geocode: campusGeocode,
    });
    return store.createUser({
      id: randomUUID(),
      sessionHashes: [],
      customerId: customer._id,
      accountId: account._id,
      merchantId: createdObject(merchantResult, "merchant")._id,
      profile: { ...requestedProfile, name, campus: "Virginia Tech" },
      createdAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    });
  }

  async function refreshUser(user) {
    const customer = await nessie.customers.get(user.customerId);
    return adoptCustomer(customer, user.profile);
  }

  function isParticipant(conversation, userId) {
    return conversation.buyerUserId === userId || conversation.sellerUserId === userId;
  }

  async function publicConversation(conversation, viewerId) {
    const listing = await store.getListing(conversation.listingId);
    const otherUserId =
      conversation.buyerUserId === viewerId
        ? conversation.sellerUserId
        : conversation.buyerUserId;
    const otherUser = await store.getUser(otherUserId);
    return {
      id: conversation.id,
      listing: listing
        ? { id: listing.id, title: listing.title, price: listing.price }
        : { id: conversation.listingId, title: "Listing unavailable" },
      otherUser: { id: otherUserId, name: otherUser?.profile?.name || "Dorm.io user" },
      messages: conversation.messages,
      createdAt: conversation.createdAt,
    };
  }

  async function conversationsFor(userId) {
    const visible = [...conversations.values()].filter((conversation) =>
      isParticipant(conversation, userId),
    );
    return Promise.all(visible.map((conversation) => publicConversation(conversation, userId)));
  }

  function pushChats(userId) {
    const clients = chatClients.get(userId);
    if (!clients?.size) return;
    conversationsFor(userId).then((items) => {
      const event = `event: chats\ndata: ${JSON.stringify({ conversations: items })}\n\n`;
      for (const client of clients) {
        try {
          client.write(event);
        } catch {
          clients.delete(client);
        }
      }
    }).catch(() => {});
  }

  function notifyConversation(conversation) {
    pushChats(conversation.buyerUserId);
    pushChats(conversation.sellerUserId);
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
        const selected =
          body.name === undefined && body.customerId === undefined && existing
            ? await refreshUser(existing)
            : await resolveCustomer(profile.name, body.customerId);
        if (selected) {
          const user = selected.customerId ? selected : await adoptCustomer(selected, profile);
          sendJson(response, 200, {
            user: publicUser(user),
            profile: user.profile,
            ...(await walletSnapshot(nessie, user.accountId)),
          }, await attachSession(user));
          return;
        }

        const created = await marketplace.createUser({
          customer: customerInput(profile),
          account: { balance: 500 },
          merchant: {
            name: `${profile.name} on Dorm.io`,
            category: "Campus marketplace",
            address: campusAddress,
            geocode: campusGeocode,
          },
        });
        const user = await store.createUser({
          id: randomUUID(),
          sessionHashes: [],
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
          await attachSession(user),
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
        const sameName = normalizeName(profile.name) === normalizeName(user.profile.name);
        const customer = sameName
          ? await nessie.customers.get(user.customerId)
          : await resolveCustomer(profile.name, body.customerId);
        if (customer && customer._id !== user.customerId) {
          const matched = await adoptCustomer(customer, profile);
          sendJson(response, 200, {
            user: publicUser(matched), profile: matched.profile, switched: true,
            ...(await walletSnapshot(nessie, matched.accountId)),
          }, await attachSession(matched));
          return;
        }
        if (!sameName) {
          await Promise.all([
            nessie.customers.update(user.customerId, customerInput(profile)),
            nessie.accounts.update(user.accountId, { nickname: profile.name }),
          ]);
        }
        const nessieProfile = customer
          ? { ...profile, name: customerDisplayName(customer) }
          : profile;
        const updated = await store.updateUser(user.id, { profile: nessieProfile, updatedAt: new Date().toISOString(), syncedAt: new Date().toISOString() });
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

      if (request.method === "GET" && url.pathname === "/api/chats") {
        const user = await requireUser(request);
        sendJson(response, 200, { conversations: await conversationsFor(user.id) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/chats/events") {
        const user = await requireUser(request);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        response.write(`event: chats\ndata: ${JSON.stringify({ conversations: await conversationsFor(user.id) })}\n\n`);
        const clients = chatClients.get(user.id) || new Set();
        clients.add(response);
        chatClients.set(user.id, clients);
        const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 25_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
          if (clients.size === 0) chatClients.delete(user.id);
        });
        return;
      }

      const conversationListingMatch = url.pathname.match(
        /^\/api\/listings\/([a-f0-9-]+)\/conversations$/i,
      );
      if (request.method === "POST" && conversationListingMatch) {
        const buyer = await requireUser(request);
        const listing = await store.getListing(conversationListingMatch[1]);
        if (!listing || listing.deletedAt) throw new ApiError(404, "listing not found.");
        if (!listing.sellerUserId) throw new ApiError(409, "seller chat is unavailable.");
        if (listing.sellerUserId === buyer.id) {
          throw new ApiError(400, "you cannot start a conversation with yourself.");
        }
        let conversation = [...conversations.values()].find(
          (item) =>
            item.listingId === listing.id &&
            item.buyerUserId === buyer.id &&
            item.sellerUserId === listing.sellerUserId,
        );
        if (!conversation) {
          conversation = {
            id: randomUUID(),
            listingId: listing.id,
            buyerUserId: buyer.id,
            sellerUserId: listing.sellerUserId,
            messages: [],
            createdAt: new Date().toISOString(),
          };
          conversations.set(conversation.id, conversation);
        }
        notifyConversation(conversation);
        sendJson(response, 200, { conversation: await publicConversation(conversation, buyer.id) });
        return;
      }

      const chatMessageMatch = url.pathname.match(
        /^\/api\/chats\/([a-f0-9-]+)\/messages$/i,
      );
      if (request.method === "POST" && chatMessageMatch) {
        const user = await requireUser(request);
        const conversation = conversations.get(chatMessageMatch[1]);
        if (!conversation) throw new ApiError(404, "conversation not found.");
        if (!isParticipant(conversation, user.id)) {
          throw new ApiError(403, "you are not part of this conversation.");
        }
        const body = await readJson(request);
        if (typeof body.text !== "string" || !body.text.trim()) {
          throw new ApiError(400, "message text is required.");
        }
        const message = {
          id: randomUUID(),
          senderUserId: user.id,
          senderName: user.profile.name,
          text: body.text.trim().slice(0, 2_000),
          createdAt: new Date().toISOString(),
        };
        conversation.messages.push(message);
        notifyConversation(conversation);
        sendJson(response, 201, {
          message,
          conversation: await publicConversation(conversation, user.id),
        });
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
        const storedSeller = await store.getUser(listing.sellerUserId);
        const seller = storedSeller ? await refreshUser(storedSeller) : undefined;
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
        ...(error.code ? { code: error.code } : {}),
        ...(error.candidates ? { candidates: error.candidates } : {}),
      });
    }
  };
}
