# Loop backend

JavaScript wrappers for the [Nessie banking simulation API](https://nessieisreal.com/docs), plus marketplace-oriented helpers for customer wallets, credit top-ups, purchases, seller proceeds, withdrawals, and payment requests.

## Setup

The existing `backend/.env` should contain:

```dotenv
NESSIE_TOKEN=your_nessie_api_key
```

`DORMIO_DATA_FILE` is optional. By default, app-user mappings, listings, orders,
and idempotency records are stored in `backend/data/app.json`, which is ignored
by Git.

Use Node.js 20.12 or newer. No package installation is required.

```sh
cd backend
npm test
npm run example
```

The example is read-only. It loads `.env` through Node's `--env-file` option.

Run the wallet API alongside Vite during development:

```sh
cd backend
npm run dev
```

In a second terminal:

```sh
cd frontend
npm run dev
```

The frontend proxies `/api` requests to `http://localhost:3001`. On first use,
the backend searches Nessie by normalized display name. It adopts a unique
existing customer and checking account, or creates them when none exists. The
local store keeps their IDs against an opaque HttpOnly session.

## App-user identity

- `POST /api/session` creates or resumes the current app user.
- `PUT /api/profile` updates the app profile and its Nessie customer name.
- `GET /api/wallet` and `POST /api/wallet/deposits` operate on that user's
  mapped checking account.
- `GET|POST /api/listings` persist user-owned listings.
- `POST /api/listings/:id/purchase` resolves both users server-side and records
  a buyer purchase plus seller deposit through Nessie.
- `POST /api/listings/:id/conversations` opens a buyer-seller conversation.
- `GET /api/chats` and `POST /api/chats/:id/messages` read and send messages.
- `GET /api/chats/events` streams live conversation updates with server-sent
  events.

Demo access is by name: `POST /api/session` with `{ "name": "John String" }`
opens the matching Nessie customer and wallet. Keep the returned cookie for
subsequent wallet requests. Matching ignores case and extra spaces. Sessions
refresh the customer name and checking-account mapping from Nessie.

Saving an existing name in Profile switches to that user's profile and wallet.
Saving an unused name renames the current user. New sessions with unused names
create new Nessie users. When multiple Nessie customers share a name, the API
returns `409 AMBIGUOUS_NESSIE_CUSTOMER`; the frontend asks the user to choose by
account details and a short customer-ID suffix. A submitted customer ID is
accepted only when it belongs to the requested name. This deliberately provides
demo access without identity verification.

Nessie is authoritative for customer names, checking accounts, deposits,
withdrawals, purchases, and wallet balances. The local store remains
authoritative only for concepts Nessie does not model: sessions, profile bio and
year, merchant linkage, listings, orders, and idempotency records.

Chats are intentionally held only in backend memory. Only the listing's buyer
and seller can read or send messages, and every open browser receives live
updates. Restarting the backend clears all conversations.

## Raw Nessie wrapper

```js
import { createNessieClientFromEnv } from "./src/index.js";

const nessie = createNessieClientFromEnv();

const customers = await nessie.customers.list();
const deposits = await nessie.deposits.listByAccount(accountId);
const customerDeposits = await nessie.deposits.listByCustomer(customerId);
const purchases = await nessie.purchases.listByAccount(accountId);
```

The client exposes:

- `customers`: `list`, `get`, `getByAccount`, `create`, `update`
- `accounts`: `list`, `get`, `listByCustomer`, `create`, `update`, `delete`
- `deposits`: `list`, `get`, `listByAccount`, `listByCustomer`, `create`, `update`, `delete`
- `withdrawals`: `get`, `listByAccount`, `create`, `update`, `delete`
- `purchases`: `get`, `listByAccount`, `listByMerchant`, `listByMerchantAndAccount`, `create`, `update`, `delete`
- `bills`: `get`, `listByAccount`, `listByCustomer`, `create`, `update`, `delete`
- `merchants`: `list`, `get`, `create`, `update`

All methods return the decoded Nessie response and throw `NessieHttpError` for non-success responses. Read requests retry transient failures; write requests are never retried automatically.

## Marketplace helpers

```js
import { createMarketplaceService, createNessieClientFromEnv } from "./src/index.js";

const marketplace = createMarketplaceService(createNessieClientFromEnv());

await marketplace.addCredits(accountId, 50);

// When the identifier you have is a Nessie customer ID:
await marketplace.addCreditsForCustomer(customerId, 50);
const wallet = await marketplace.getCustomerWallet(customerId);
console.log(wallet.account.base_balance, wallet.account.balance);

await marketplace.purchaseItem({
  buyerAccountId,
  sellerAccountId,
  merchantId,
  amount: 20,
  itemId: listingId,
});

await marketplace.withdrawEarnings(sellerAccountId, 20);
```

Suggested mapping:

- one Nessie customer and checking account per app user
- one Nessie merchant per seller profile
- a deposit for a user's credit top-up
- a purchase on the buyer's account plus a matching deposit to the seller's account
- a withdrawal when the seller cashes out
- an optional bill for a pending payment request

Keep listing ownership, order state, seller-to-merchant mappings, and idempotency keys in the app database. Nessie does not provide atomic settlement across a buyer purchase and seller deposit. If the seller deposit fails after the purchase succeeds, `purchaseItem` throws `MarketplaceSettlementError` with the successful purchase response in `error.details`; persist that state and retry or reconcile the seller credit from the backend.

Nessie customer IDs and account IDs are different. Use `accounts.listByCustomer`,
`deposits.listByCustomer`, or the customer-aware marketplace helpers when starting
from a customer ID. The current Nessie sandbox records deposits without updating
the account object's stored `balance`; `walletSnapshot` and `getCustomerWallet`
therefore expose both `base_balance` and a derived `balance` calculated from
completed deposits, withdrawals, and purchases.
