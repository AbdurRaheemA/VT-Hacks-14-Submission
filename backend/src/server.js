import { createServer } from "node:http";

import { createApiHandler } from "./api.js";
import { createNessieClientFromEnv } from "./nessie/client.js";
import { createMarketplaceService } from "./marketplace.js";

const port = Number(process.env.PORT || 3001);
const nessie = createNessieClientFromEnv();
const marketplace = createMarketplaceService(nessie);
const handler = createApiHandler({
  nessie,
  marketplace,
  accountId: process.env.NESSIE_ACCOUNT_ID,
});

createServer(handler).listen(port, () => {
  console.log(`Loop backend listening on http://localhost:${port}`);
});
