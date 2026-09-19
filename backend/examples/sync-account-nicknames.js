import { writeFile } from 'node:fs/promises';
import { createNessieClientFromEnv } from '../src/nessie/client.js';

const nessie = createNessieClientFromEnv();

try {
  const customers = await nessie.customers.list();
  const plan = [];
  for (const customer of customers) {
    const customerName = [customer.first_name, customer.last_name]
      .filter((part) => typeof part === 'string' && part.trim())
      .map((part) => part.trim())
      .join(' ');
    if (!customerName) throw new Error(`Customer ${customer._id} has no usable name.`);
    const accounts = await nessie.accounts.listByCustomer(customer._id);
    for (const account of accounts) {
      plan.push({
        customerId: customer._id,
        customerName,
        accountId: account._id,
        previousNickname: account.nickname,
      });
    }
  }

  const backup = new URL(`../data/account-nicknames-${Date.now()}.json`, import.meta.url);
  await writeFile(backup, JSON.stringify(plan, null, 2), { flag: 'wx' });
  console.log(`Saved original nicknames to ${backup.pathname}`);

  for (const entry of plan) {
    await nessie.accounts.update(entry.accountId, { nickname: entry.customerName });
    const actual = await nessie.accounts.get(entry.accountId);
    if (actual.nickname !== entry.customerName) {
      throw new Error(`Nickname verification failed for account ${entry.accountId}.`);
    }
    console.log(`Verified ${entry.customerName}: ${entry.accountId}`);
  }
  console.log(`Verified all ${plan.length} account nicknames.`);
} catch (error) {
  console.error(error.name, error.message);
  if (error.body) console.error(JSON.stringify(error.body));
  process.exitCode = 1;
}
