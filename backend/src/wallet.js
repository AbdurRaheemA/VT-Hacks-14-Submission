function completedTotal(items) {
  if (!Array.isArray(items)) throw new TypeError('Invalid wallet ledger.');
  return items
    .filter(item => !['cancelled', 'pending'].includes(item.status))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

export async function walletSnapshot(nessie, accountId) {
  const account = await nessie.accounts.get(accountId);
  // Missing resources support lightweight clients; failed requests must propagate.
  const totals = await Promise.all(['deposits', 'withdrawals', 'purchases'].map(async resource =>
    completedTotal(await (nessie[resource]?.listByAccount?.(accountId) ?? [])),
  ));
  const [deposits, withdrawals, purchases] = totals;
  const baseBalance = Number(account.balance);
  if (!Number.isFinite(baseBalance)) throw new TypeError('Invalid wallet balance.');
  return {
    account: {
      ...account,
      base_balance: baseBalance,
      balance: Math.round((baseBalance + deposits - withdrawals - purchases) * 100) / 100,
    },
    ledger: { deposits, withdrawals, purchases },
  };
}
