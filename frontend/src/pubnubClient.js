import PubNub from 'pubnub';

/**
 * Create a PubNub client with the given userId.
 * userId is persisted in localStorage — never regenerated.
 * Token is set separately via client.setToken(token) after backend grant.
 */
export function createPubNubClient(userId) {
  if (!userId) throw new Error('userId is required to create a PubNub client');

  return new PubNub({
    publishKey: import.meta.env.VITE_PUBNUB_PUBLISH_KEY,
    subscribeKey: import.meta.env.VITE_PUBNUB_SUBSCRIBE_KEY,
    userId,
    // secretKey is NEVER included here — server-side only
  });
}

/** Get or generate a persistent userId from localStorage */
export function getOrCreateUserId() {
  const key = 'arenaPlayUserId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
