const currencies = Object.freeze([
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CNY", "INR", "KRW", "MXN", "BRL", "CHF",
]);

export function createCurrencyService({ fetch: fetchImpl = globalThis.fetch } = {}) {
  const cache = new Map();
  return Object.freeze({
    async rate(currency) {
      if (!currencies.includes(currency)) throw new Error("Unsupported currency.");
      if (currency === "USD") return { base: "USD", quote: "USD", rate: 1, date: null };
      const cached = cache.get(currency);
      if (cached && Date.now() - cached.cachedAt < 3_600_000) return cached.value;
      const response = await fetchImpl(`https://api.frankfurter.dev/v2/rate/USD/${currency}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Exchange-rate lookup failed with status ${response.status}.`);
      const body = await response.json();
      if (!Number.isFinite(body.rate) || body.rate <= 0) throw new Error("Exchange-rate lookup returned an invalid rate.");
      const value = { base: "USD", quote: currency, rate: body.rate, date: body.date || null };
      cache.set(currency, { value, cachedAt: Date.now() });
      return value;
    },
  });
}

export const supportedCurrencies = currencies;
