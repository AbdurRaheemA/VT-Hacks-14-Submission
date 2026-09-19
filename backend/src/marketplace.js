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
    async createUser({ customer, account = {} }, options) {
      const customerResult = await nessie.customers.create(customer, options);
      const createdCustomer = createdObject(customerResult, "customer");
      const accountResult = await nessie.accounts.create(
        createdCustomer._id,
        {
          type: "Checking",
          nickname: "Marketplace credits",
          rewards: 0,
          balance: 0,
          ...account,
        },
        options,
      );
      return {
        customer: createdCustomer,
        account: createdObject(accountResult, "account"),
        raw: { customer: customerResult, account: accountResult },
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
