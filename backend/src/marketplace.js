function positiveAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError("amount must be a positive finite number.");
  }
  return value;
}

function dateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("date must be valid.");
  return date.toISOString().slice(0, 10);
}

function completedTotal(items) {
  return items
    .filter((item) => !["cancelled", "pending"].includes(item.status))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

async function walletSnapshot(nessie, accountId) {
  const account = await nessie.accounts.get(accountId);
  const [deposits, withdrawals, purchases] = await Promise.all([
    nessie.deposits.listByAccount(accountId),
    nessie.withdrawals.listByAccount(accountId),
    nessie.purchases.listByAccount(accountId),
  ]);
  const ledger = {
    deposits: completedTotal(deposits),
    withdrawals: completedTotal(withdrawals),
    purchases: completedTotal(purchases),
  };
  return {
    account: {
      ...account,
      base_balance: Number(account.balance),
      balance:
        Number(account.balance) + ledger.deposits - ledger.withdrawals - ledger.purchases,
    },
    ledger,
  };
}

async function customerCheckingAccount(nessie, customerId) {
  const accounts = await nessie.accounts.listByCustomer(customerId);
  const account = accounts.find((item) => item.type?.toLowerCase() === "checking") || accounts[0];
  if (!account) {
    throw new MarketplaceSetupError("The customer does not have an account.", { customerId });
  }
  return account;
}

function createdObject(result, resourceName) {
  if (result && typeof result === "object" && result.objectCreated?._id) {
    return result.objectCreated;
  }
  throw new MarketplaceSetupError(
    `Nessie created the ${resourceName} but did not return objectCreated with an id.`,
    { result },
  );
}

export class MarketplaceSetupError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "MarketplaceSetupError";
    this.details = details;
  }
}

export class MarketplaceSettlementError extends Error {
  constructor(message, details, options) {
    super(message, options);
    this.name = "MarketplaceSettlementError";
    this.details = details;
  }
}

export function createMarketplaceService(nessie) {
  if (!nessie?.customers || !nessie?.accounts || !nessie?.purchases || !nessie?.deposits) {
    throw new TypeError("nessie must be a Nessie client.");
  }

  return Object.freeze({
    async createUser({ customer, account = {}, merchant }, options) {
      const customerResult = await nessie.customers.create(customer, options);
      const createdCustomer = createdObject(customerResult, "customer");
      const customerAccountName = [customer.first_name, customer.last_name]
        .filter((part) => typeof part === "string" && part.trim())
        .map((part) => part.trim())
        .join(" ");
      const accountResult = await nessie.accounts.create(
        createdCustomer._id,
        {
          type: "Checking",
          rewards: 0,
          balance: 0,
          ...account,
          nickname: customerAccountName,
        },
        options,
      );
      const accountObject = createdObject(accountResult, "account");
      let merchantResult;
      let merchantObject;
      if (merchant) {
        if (!nessie.merchants?.create) {
          throw new MarketplaceSetupError("Nessie merchant support is required for seller onboarding.");
        }
        merchantResult = await nessie.merchants.create(merchant, options);
        merchantObject = createdObject(merchantResult, "merchant");
      }
      return {
        customer: createdCustomer,
        account: accountObject,
        merchant: merchantObject,
        raw: { customer: customerResult, account: accountResult, merchant: merchantResult },
      };
    },

    addCredits(accountId, amount, { description = "Marketplace credit top-up", date, ...options } = {}) {
      return nessie.deposits.create(
        accountId,
        {
          medium: "balance",
          transaction_date: dateOnly(date),
          status: "completed",
          amount: positiveAmount(amount),
          description,
        },
        options,
      );
    },

    walletSnapshot(accountId) {
      return walletSnapshot(nessie, accountId);
    },

    async getCustomerWallet(customerId) {
      const account = await customerCheckingAccount(nessie, customerId);
      return {
        customerId,
        ...(await walletSnapshot(nessie, account._id)),
      };
    },

    async addCreditsForCustomer(
      customerId,
      amount,
      { description = "Marketplace credit top-up", date, ...options } = {},
    ) {
      const account = await customerCheckingAccount(nessie, customerId);
      const deposit = await nessie.deposits.create(
        account._id,
        {
          medium: "balance",
          transaction_date: dateOnly(date),
          status: "completed",
          amount: positiveAmount(amount),
          description,
        },
        options,
      );
      return {
        customerId,
        accountId: account._id,
        deposit,
        ...(await walletSnapshot(nessie, account._id)),
      };
    },

    async purchaseItem({
      buyerAccountId,
      sellerAccountId,
      merchantId,
      amount,
      itemId,
      description = "Marketplace purchase",
      date,
      requestOptions,
    }) {
      const settledAmount = positiveAmount(amount);
      const purchaseDate = dateOnly(date);
      const reference = itemId ? `${description} [item:${itemId}]` : description;
      const purchase = await nessie.purchases.create(
        buyerAccountId,
        {
          merchant_id: merchantId,
          medium: "balance",
          amount: settledAmount,
          purchase_date: purchaseDate,
          status: "completed",
          description: reference,
        },
        requestOptions,
      );

      try {
        const sellerCredit = await nessie.deposits.create(
          sellerAccountId,
          {
            medium: "balance",
            transaction_date: purchaseDate,
            status: "completed",
            amount: settledAmount,
            description: `${reference} seller proceeds`,
          },
          requestOptions,
        );
        return { purchase, sellerCredit, status: "settled" };
      } catch (error) {
        throw new MarketplaceSettlementError(
          "The buyer purchase succeeded, but the seller credit failed.",
          { purchase, buyerAccountId, sellerAccountId, merchantId, amount: settledAmount, itemId },
          { cause: error },
        );
      }
    },

    withdrawEarnings(
      accountId,
      amount,
      { description = "Marketplace earnings withdrawal", date, ...options } = {},
    ) {
      return nessie.withdrawals.create(
        accountId,
        {
          medium: "balance",
          transaction_date: dateOnly(date),
          status: "completed",
          amount: positiveAmount(amount),
          description,
        },
        options,
      );
    },

    createPaymentRequest(
      buyerAccountId,
      { sellerName, amount, dueDate, nickname = "Marketplace item" },
      options,
    ) {
      return nessie.bills.create(
        buyerAccountId,
        {
          status: "pending",
          payee: sellerName,
          nickname,
          payment_date: dateOnly(dueDate),
          payment_amount: positiveAmount(amount),
        },
        options,
      );
    },
  });
}
