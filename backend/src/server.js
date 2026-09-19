import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createApiHandler } from "./api.js";
import { createAppStore } from "./app-store.js";
import { createNessieClientFromEnv } from "./nessie/client.js";
import { createMarketplaceService } from "./marketplace.js";
import { createTranslationService } from "./translation.js";
import { createCurrencyService } from "./currency.js";

const port = Number(process.env.PORT || 3001);
const nessie = createNessieClientFromEnv();
const marketplace = createMarketplaceService(nessie);
const translationService = createTranslationService();
const currencyService = createCurrencyService();
const store = createAppStore({
  filePath: process.env.DORMIO_DATA_FILE
    ? resolve(process.env.DORMIO_DATA_FILE)
    : fileURLToPath(new URL("../data/app.json", import.meta.url)),
});
const handler = createApiHandler({
  nessie,
  marketplace,
  store,
  translationService,
  currencyService,
  secureCookies: process.env.NODE_ENV === "production",
});

createServer(handler).listen(port, () => {
  console.log(`Loop backend listening on http://localhost:${port}`);
});
