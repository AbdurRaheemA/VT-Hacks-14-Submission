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
the backend creates one Nessie customer, checking account, and seller merchant,
then stores their IDs against an opaque HttpOnly session. Account and customer
IDs are resolved by the backend and are never accepted from the browser.

## App-user identity

- `POST /api/session` creates or resumes the current app user.
- `PUT /api/profile` updates the app profile and its Nessie customer name.
- `GET /api/wallet` and `POST /api/wallet/deposits` operate on that user's
  mapped checking account.
- `GET|POST /api/listings` persist user-owned listings.
- `POST /api/listings/:id/purchase` resolves both users server-side and records
  a buyer purchase plus seller deposit through Nessie.

This is hackathon-grade anonymous session authentication, not production student
login. Production should replace it with the university identity provider while
retaining the server-side user/customer/account mapping.

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
