import { createNessieClientFromEnv } from "../src/index.js";

const nessie = createNessieClientFromEnv();
const customers = await nessie.customers.list();

console.log(customers);
