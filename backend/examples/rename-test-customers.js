import { writeFile } from 'node:fs/promises';
import { createNessieClientFromEnv } from '../src/nessie/client.js';

const nessie = createNessieClientFromEnv();
try {
  const customers = await nessie.customers.list();
  if (!Array.isArray(customers)) throw new Error('Expected a customer list.');
  customers.sort((a, b) => a._id.localeCompare(b._id));
  const plan = customers.map((customer, index) => ({
    id: customer._id,
    before: { first_name: customer.first_name, last_name: customer.last_name },
    after: { first_name: `testUser${String(index + 1).padStart(2, '0')}`, last_name: '' },
  }));
  const backup = new URL(`../data/customer-names-${Date.now()}.json`, import.meta.url);
  await writeFile(backup, JSON.stringify(plan, null, 2), { flag: 'wx' });
  console.log(`Saved original names to ${backup.pathname}`);
  for (const entry of plan) {
    await nessie.customers.update(entry.id, entry.after);
    const actual = await nessie.customers.get(entry.id);
    if (actual.first_name !== entry.after.first_name || actual.last_name !== '') {
      throw new Error(`Name verification failed for customer ${entry.id}`);
    }
    console.log(`Verified ${entry.after.first_name}`);
  }
  const final = await nessie.customers.list();
  if (final.length !== plan.length || plan.some(entry => !final.some(customer =>
    customer._id === entry.id && customer.first_name === entry.after.first_name && customer.last_name === ''
  ))) throw new Error('Final customer-list verification failed.');
  console.log(`Verified all ${plan.length} customers; customer IDs are unchanged.`);
} catch (error) {
  console.error(error.name, error.message);
  if (error.body) console.error(JSON.stringify(error.body));
  process.exitCode = 1;
}
