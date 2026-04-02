/**
 * ArenaPlay — Answer Validator
 * Trigger: Before Publish (onBefore)
 * Channel: game.{gameId}.answers.inbound
 *
 * Runs at the PubNub edge before the message is delivered to any subscriber.
 * Two jobs:
 *   1. Validate the answer payload format
 *   2. Enforce one-answer-per-player-per-round (frequency cap via KV Store)
 *
 * Call budget: 3 external calls per execution (kvstore + pubnub + xhr combined).
 * This function uses exactly 2: kvstore.get + kvstore.set
 */
export default async (request) => {
  const kvStore = require('kvstore');
  const msg = request.message;

  // --- 1. Format validation ---
  if (!msg.gameId || !msg.playerId || !msg.questionId || !msg.roundNumber) {
    return request.abort('Missing required fields: gameId, playerId, questionId, roundNumber');
  }

  if (!['A', 'B', 'C', 'D'].includes(msg.answer)) {
    return request.abort('Invalid answer: must be A, B, C, or D');
  }

  // --- 2. Frequency cap ---
  // Key is scoped to game + player + round so it auto-namespaces correctly.
  // TTL of 3600s (1 hour) ensures KV entries don't accumulate indefinitely.
  const capKey = `cap:${msg.gameId}:${msg.playerId}:${msg.roundNumber}`;

  // Call 1: check if player already answered this round
  const existing = await kvStore.get(capKey);
  if (existing) {
    return request.abort('Duplicate answer: already submitted for this round');
  }

  // Call 2: set the cap flag
  await kvStore.set(capKey, '1', 3600);

  return request.ok();
};

/**
 * Design notes (for interview reference):
 *
 * Why onBefore and not onAfter?
 *   onBefore runs synchronously in the message path — the abort() prevents the
 *   duplicate from ever reaching any subscriber. onAfter runs after delivery, so
 *   a second answer would already be delivered before we could stop it.
 *
 * Why KV Store for the frequency cap and not the request context?
 *   PubNub Functions are stateless per execution. The cap needs to persist across
 *   multiple player publishes within the same round. KV Store is the right tool.
 *
 * Why not validate against the game state (correct answer, open round)?
 *   That would require an XHR call to the FastAPI backend, consuming our 3rd
 *   external call slot. Keep the Function lean — FastAPI is the source of truth
 *   for round state; the Function only needs to enforce "one answer per player".
 *
 * Production upgrade: move to game.{gameId}.answers.{playerId} per-player channels
 *   with PAM v3 regex granting each player write access only to their own channel.
 *   This enforces player identity at the network layer instead of the application layer.
 */
