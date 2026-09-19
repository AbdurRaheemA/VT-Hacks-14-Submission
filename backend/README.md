# Loop backend

JavaScript wrappers for the [Nessie banking simulation API](https://nessieisreal.com/docs), plus marketplace-oriented helpers for customer wallets, credit top-ups, purchases, seller proceeds, withdrawals, and payment requests.

## Setup

The existing `backend/.env` should contain:

```dotenv
NESSIE_TOKEN=your_nessie_api_key
```

Use Node.js 20.12 or newer. No package installation is required.

```sh
cd backend
npm test
npm run example
```

The example is read-only. It loads `.env` through Node's `--env-file` option.

## Raw Nessie wrapper

```js
import { createNessieClientFromEnv } from "./src/index.js";

const nessie = createNessieClientFromEnv();

const customers = await nessie.customers.list();
const deposits = await nessie.deposits.listByAccount(accountId);
const purchases = await nessie.purchases.listByAccount(accountId);
```

The client exposes:

- `customers`: `list`, `get`, `getByAccount`, `create`, `update`
- `accounts`: `list`, `get`, `listByCustomer`, `create`, `update`, `delete`
- `deposits`: `list`, `get`, `listByAccount`, `create`, `update`, `delete`
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
