import {
  NessieConfigurationError,
  NessieHttpError,
  NessieNetworkError,
  NessieTimeoutError,
} from "./errors.js";

export const NESSIE_BASE_URL = "https://prod-api.nessieisreal.com";

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function segment(value, name = "id") {
  return encodeURIComponent(requiredString(value, name));
}

function createResources(request) {
  return {
    customers: {
      list: (options) => request("GET", "/customers", { options }),
      get: (id, options) => request("GET", `/customers/${segment(id)}`, { options }),
      getByAccount: (accountId, options) =>
        request("GET", `/accounts/${segment(accountId, "accountId")}/customer`, { options }),
      create: (body, options) => request("POST", "/customers", { body, options }),
      update: (id, body, options) =>
        request("PUT", `/customers/${segment(id)}`, { body, options }),
    },

    accounts: {
      list: (filters = {}, options) => request("GET", "/accounts", { query: filters, options }),
      get: (id, options) => request("GET", `/accounts/${segment(id)}`, { options }),
      listByCustomer: (customerId, options) =>
        request("GET", `/customers/${segment(customerId, "customerId")}/accounts`, { options }),
      create: (customerId, body, options) =>
        request("POST", `/customers/${segment(customerId, "customerId")}/accounts`, {
          body,
          options,
        }),
      update: (id, body, options) =>
        request("PUT", `/accounts/${segment(id)}`, { body, options }),
      delete: (id, options) => request("DELETE", `/accounts/${segment(id)}`, { options }),
    },

    deposits: {
      list: (options) => request("GET", "/deposits", { options }),
      get: (id, options) => request("GET", `/deposits/${segment(id)}`, { options }),
      listByAccount: (accountId, options) =>
        request("GET", `/accounts/${segment(accountId, "accountId")}/deposits`, { options }),
      listByCustomer: async (customerId, options) => {
        const accounts = await request(
          "GET",
          `/customers/${segment(customerId, "customerId")}/accounts`,
          { options },
        );
        const groups = await Promise.all(
          accounts.map(async (account) => {
            const deposits = await request("GET", `/accounts/${segment(account._id)}/deposits`, {
              options,
            });
            return deposits.map((deposit) => ({
              ...deposit,
              account_id: deposit.account_id || account._id,
            }));
          }),
        );
        return groups.flat();
      },
      create: (accountId, body, options) =>
        request("POST", `/accounts/${segment(accountId, "accountId")}/deposits`, {
          body,
          options,
        }),
      update: (id, body, options) =>
        request("PUT", `/deposits/${segment(id)}`, { body, options }),
      delete: (id, options) => request("DELETE", `/deposits/${segment(id)}`, { options }),
    },

    withdrawals: {
      get: (id, options) => request("GET", `/withdrawal/${segment(id)}`, { options }),
      listByAccount: (accountId, options) =>
        request("GET", `/accounts/${segment(accountId, "accountId")}/withdrawals`, { options }),
      create: (accountId, body, options) =>
        request("POST", `/accounts/${segment(accountId, "accountId")}/withdrawals`, {
          body,
          options,
        }),
      update: (id, body, options) =>
        request("PUT", `/withdrawal/${segment(id)}`, { body, options }),
      delete: (id, options) => request("DELETE", `/withdrawal/${segment(id)}`, { options }),
    },

    purchases: {
      get: (id, options) => request("GET", `/purchase/${segment(id)}`, { options }),
      listByAccount: (accountId, options) =>
        request("GET", `/accounts/${segment(accountId, "accountId")}/purchases`, { options }),
      listByMerchant: (merchantId, options) =>
        request("GET", `/merchants/${segment(merchantId, "merchantId")}/purchases`, { options }),
      listByMerchantAndAccount: (merchantId, accountId, options) =>
        request(
          "GET",
          `/merchants/${segment(merchantId, "merchantId")}/accounts/${segment(accountId, "accountId")}/purchases`,
          { options },
        ),
      create: (accountId, body, options) =>
        request("POST", `/accounts/${segment(accountId, "accountId")}/purchases`, {
          body,
          options,
        }),
      update: (id, body, options) =>
        request("PUT", `/purchase/${segment(id)}`, { body, options }),
      delete: (id, options) => request("DELETE", `/purchase/${segment(id)}`, { options }),
    },

    bills: {
      get: (id, options) => request("GET", `/bills/${segment(id)}`, { options }),
      listByAccount: (accountId, options) =>
        request("GET", `/accounts/${segment(accountId, "accountId")}/bills`, { options }),
      listByCustomer: (customerId, options) =>
        request("GET", `/customers/${segment(customerId, "customerId")}/bills`, { options }),
      create: (accountId, body, options) =>
        request("POST", `/accounts/${segment(accountId, "accountId")}/bills`, {
          body,
          options,
        }),
      update: (id, body, options) =>
        request("PUT", `/bills/${segment(id)}`, { body, options }),
      delete: (id, options) => request("DELETE", `/bills/${segment(id)}`, { options }),
    },

    merchants: {
      list: (options) => request("GET", "/merchants", { options }),
      get: (id, options) => request("GET", `/merchants/${segment(id)}`, { options }),
      create: (body, options) => request("POST", "/merchants", { body, options }),
      update: (id, body, options) =>
        request("PUT", `/merchants/${segment(id)}`, { body, options }),
    },
  };
}

function parseResponseBody(text, contentType) {
  if (text.trim() === "") return undefined;
  if (/json/i.test(contentType)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new NessieConfigurationError("baseUrl must be an absolute HTTP(S) URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new NessieConfigurationError(
      "baseUrl must use HTTP(S) without credentials, query, or fragment.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function retryDelay(attempt, retryAfter) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(250 * 2 ** attempt, 2_000);
}

export function createNessieClient({
  apiKey,
  baseUrl = NESSIE_BASE_URL,
  fetch: fetchImplementation = globalThis.fetch,
  timeoutMs = 10_000,
  maxRetries = 2,
} = {}) {
  requiredString(apiKey, "apiKey");
  if (typeof fetchImplementation !== "function") {
    throw new NessieConfigurationError("fetch must be a function.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new NessieConfigurationError("timeoutMs must be a positive integer.");
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new NessieConfigurationError("maxRetries must be an integer from 0 to 10.");
  }

  const rootUrl = normalizeBaseUrl(baseUrl);

  async function request(method, path, { body, query = {}, options = {} } = {}) {
    const requestTimeout = options.timeoutMs ?? timeoutMs;
    const requestRetries = options.maxRetries ?? maxRetries;
    const controller = new AbortController();
    const signals = [controller.signal];
    if (options.signal) signals.push(options.signal);
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    const url = new URL(path.replace(/^\//, ""), rootUrl);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("key", apiKey);

    const headers = { accept: "application/json" };
    const init = { method, headers, signal, redirect: "error" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    try {
      for (let attempt = 0; ; attempt += 1) {
        let response;
        try {
          response = await fetchImplementation(url, init);
        } catch (error) {
          if (signal.aborted) {
            if (options.signal?.aborted) throw error;
            throw new NessieTimeoutError(`Nessie request exceeded ${requestTimeout}ms.`);
          }
          if (method === "GET" && attempt < requestRetries) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
            continue;
          }
          throw new NessieNetworkError(`Network request failed for ${method} ${path}.`, {
            cause: error,
          });
        }

        const text = await response.text();
        const parsedBody = parseResponseBody(text, response.headers.get("content-type") ?? "");
        if (response.ok) return parsedBody;

        if (method === "GET" && attempt < requestRetries && retryableStatuses.has(response.status)) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelay(attempt, response.headers.get("retry-after"))),
          );
          continue;
        }

        throw new NessieHttpError({
          method,
          path,
          status: response.status,
          body: parsedBody,
          requestId:
            response.headers.get("x-request-id") ?? response.headers.get("x-amzn-requestid"),
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze(createResources(request));
}

export function createNessieClientFromEnv(env = process.env, options = {}) {
  return createNessieClient({
    ...options,
    apiKey: env.NESSIE_TOKEN,
    baseUrl: env.NESSIE_BASE_URL || options.baseUrl || NESSIE_BASE_URL,
  });
}
