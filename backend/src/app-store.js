import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

const emptyState = () => ({ users: {}, listings: {}, orders: {}, idempotency: {} });

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export const normalizeName = name => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function createAppStore({ filePath, initialState } = {}) {
  let state = initialState ? copy(initialState) : emptyState();
  let loading;
  let writes = Promise.resolve();

  async function load() {
    if (!filePath) return;
    if (loading) return loading;
    loading = (async () => {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      state = {
        users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
        listings: parsed.listings && typeof parsed.listings === "object" ? parsed.listings : {},
        orders: parsed.orders && typeof parsed.orders === "object" ? parsed.orders : {},
        idempotency:
          parsed.idempotency && typeof parsed.idempotency === "object" ? parsed.idempotency : {},
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    })();
    return loading;
  }

  async function persist() {
    if (!filePath) return;
    const snapshot = JSON.stringify(state, null, 2);
    writes = writes.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(`${filePath}.tmp`, `${snapshot}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(`${filePath}.tmp`, filePath);
    });
    await writes;
  }

  return Object.freeze({
    async getUserBySession(hash) {
      await load();
      return copy(Object.values(state.users).find(user => user.sessionHash === hash || user.sessionHashes?.includes(hash)));
    },
    async getUserByName(name) {
      await load();
      return copy(Object.values(state.users).find(user => normalizeName(user.profile.name) === normalizeName(name)));
    },
    async getUser(id) {
      await load();
      return copy(state.users[id]);
    },

    async createUser(user) {
      await load();
      if (state.users[user.id]) throw new Error("user already exists.");
      state.users[user.id] = copy(user);
      await persist();
      return copy(user);
    },

    async updateUser(id, changes) {
      await load();
      if (!state.users[id]) return undefined;
      state.users[id] = { ...state.users[id], ...copy(changes), id };
      await persist();
      return copy(state.users[id]);
    },

    async listListings() {
      await load();
      return copy(Object.values(state.listings));
    },

    async getListing(id) {
      await load();
      return copy(state.listings[id]);
    },

    async createListing(listing) {
      await load();
      if (state.listings[listing.id]) throw new Error("listing already exists.");
      state.listings[listing.id] = copy(listing);
      await persist();
      return copy(listing);
    },

    async updateListing(id, changes) {
      await load();
      if (!state.listings[id]) return undefined;
      state.listings[id] = { ...state.listings[id], ...copy(changes), id };
      await persist();
      return copy(state.listings[id]);
    },

    async deleteListing(id) {
      await load();
      if (!state.listings[id]) return false;
      delete state.listings[id];
      await persist();
      return true;
    },

    async createOrder(order) {
      await load();
      if (state.orders[order.id]) throw new Error("order already exists.");
      state.orders[order.id] = copy(order);
      await persist();
      return copy(order);
    },

    async getIdempotency(key) {
      await load();
      return copy(state.idempotency[key]);
    },

    async putIdempotency(key, value) {
      await load();
      state.idempotency[key] = copy(value);
      await persist();
      return copy(value);
    },
  });
}
