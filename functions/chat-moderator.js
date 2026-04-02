/**
 * ArenaPlay — Chat Moderator
 * Trigger: Before Publish (onBefore)
 * Channel: game.{gameId}.chat
 *
 * Checks chat messages against a banned-word list stored in KV Store.
 * Aborts the message before delivery if a match is found.
 *
 * Call budget: 3 per execution. This function uses 1: kvstore.get.
 *
 * Why local KV Store list and NOT an external moderation API?
 *   An external API call (e.g., Perspective API) would consume 1 of our 3 calls
 *   AND typically takes 50–200ms — added to every chat message in a before-publish
 *   handler. That's unacceptable latency in a live game.
 *
 *   Production upgrade: use onAfter + an async moderation API. The message
 *   delivers immediately; if flagged, publish a "message removed" event to the
 *   channel. This is the standard pattern for low-latency moderated chat.
 */
export default async (request) => {
  const kvStore = require('kvstore');
  const msg = request.message;

  if (!msg.text || typeof msg.text !== 'string') {
    return request.ok(); // No text content — pass through
  }

  // Call 1: load banned word list from KV Store
  // Pre-populate this in the PubNub Admin Portal → Functions → KV Store:
  //   key: "banned_words"  value: ["badword1","badword2","badword3"]
  const raw = await kvStore.get('banned_words');
  if (!raw) {
    return request.ok(); // No list configured — pass everything through
  }

  let banned;
  try {
    banned = JSON.parse(raw);
  } catch {
    return request.ok(); // Malformed list — fail open
  }

  const lowerText = msg.text.toLowerCase();
  if (banned.some((word) => lowerText.includes(word.toLowerCase()))) {
    return request.abort('Message blocked by moderation');
  }

  return request.ok();
};
