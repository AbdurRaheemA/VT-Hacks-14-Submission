async function request(path, options) {
  let response;
  const unavailable = 'Cannot reach the Dorm.io backend. Start it with npm start in the backend folder, then try again.';
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    throw new Error(unavailable);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || unavailable);
    error.status = response.status;
    error.code = body.code;
    error.candidates = body.candidates;
    throw error;
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(unavailable);
  return body;
}

let sessionRequest;
export function bootstrapSession(profile, customerId) {
  if (sessionRequest) return sessionRequest;
  const { avatar, ...metadata } = profile;
  sessionRequest = request('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: metadata, customerId }),
  }).finally(() => { sessionRequest = undefined; });
  return sessionRequest;
}

export function updateProfile(profile, customerId) {
  const { avatar, ...metadata } = profile;
  return request('/api/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: metadata, customerId }),
  });
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

export function getListings() {
  return request('/api/listings');
}

export function getExchangeRate(currency) {
  return request(`/api/exchange-rate?currency=${encodeURIComponent(currency)}`);
}

export function createListing(listing) {
  return request('/api/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(listing),
  });
}

export function deleteListing(id) {
  return request(`/api/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function purchaseListing(id, checkoutId) {
  return request(`/api/listings/${encodeURIComponent(id)}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkoutId }),
  });
}

export function getConversations() {
  return request('/api/chats');
}

export function createConversation(listingId) {
  return request(`/api/listings/${encodeURIComponent(listingId)}/conversations`, {
    method: 'POST',
  });
}

export function sendChatMessage(conversationId, text) {
  return request(`/api/chats/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function subscribeToChats(onConversations) {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource('/api/chats/events', { withCredentials: true });
  source.addEventListener('chats', event => {
    try {
      onConversations(JSON.parse(event.data).conversations || []);
    } catch {
      // ignore malformed live updates
    }
  });
  return () => source.close();
}
