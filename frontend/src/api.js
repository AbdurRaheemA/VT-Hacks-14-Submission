async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The wallet service is unavailable.');
  return body;
}

export function getWallet() {
  return request('/api/wallet');
}

export function depositTestCredits({ amount, provider, checkoutId }) {
  return request('/api/wallet/deposits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount, provider, checkoutId }),
  });
}
