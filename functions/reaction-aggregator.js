/**
 * ArenaPlay — Reaction Aggregator
 * Trigger: After Publish (onAfter)
 * Channel: game.{gameId}.reactions
 *
 * Runs after the reaction burst is delivered to subscribers.
 * Does not block delivery — this is a side effect only.
 *
 * Maintains a running crowd energy score in KV Store.
 * Every 50+ accumulated reactions, publishes an updated crowd.energy score.
 * The crowd.energy channel drives the Illuminate trigger threshold.
 *
 * Call budget: 3 per execution.
 * This function uses 1–2:
 *   - kvstore.incrCounter (atomic increment + returns new value) = 1 call
 *   - pubnub.publish (conditional, only at threshold) = 1 call
 *
 * Why incrCounter instead of get + set?
 *   get + set would cost 2 calls AND introduce a race condition when 10K players
 *   are reacting simultaneously. incrCounter is atomic — safe under high concurrency.
 */
export default async (request) => {
  const kvStore = require('kvstore');
  const pubnub = require('pubnub');
  const msg = request.message;

  if (!msg.gameId || !Array.isArray(msg.reactions)) {
    return request.ok(); // Malformed reaction — skip silently, don't block
  }

  const gameId = msg.gameId;
  const burst = msg.reactions.reduce((sum, r) => sum + (r.count || 1), 0);

  // Call 1: atomic increment — returns the new total
  const newScore = await kvStore.incrCounter(`energy:${gameId}`, burst);

  // Publish an energy update every time we cross a multiple of 50 reactions.
  // The modulo check detects threshold crossings without needing a separate read.
  // Example: previous=48, burst=5, new=53. 53%50=3, burst=5 → 3 < 5 → crossed.
  if (newScore % 50 < burst) {
    // Call 2: publish crowd energy score to the crowd.energy channel
    await pubnub.publish({
      channel: `game.${gameId}.crowd.energy`,
      message: {
        type: 'CROWD_ENERGY_UPDATE',
        gameId,
        score: newScore,
        ts: Date.now(),
      },
    });
  }

  return request.ok();
};

/**
 * Design notes:
 *
 * Why onAfter and not onBefore?
 *   Aggregation is a side effect — we don't want to add latency to reaction delivery.
 *   Players should see each other's emojis immediately. The energy score update
 *   can happen asynchronously.
 *
 * The 50-reaction threshold:
 *   Publishing on every reaction would cost 2 calls per execution (incrCounter + publish)
 *   at 333 executions/sec = 666 PubNub API calls/sec just for crowd energy.
 *   The threshold reduces crowd.energy publishes by ~50x while still being reactive.
 *   Tune this value: lower threshold = more real-time energy meter; higher = less traffic.
 *
 * Illuminate integration:
 *   The crowd.energy channel feeds Illuminate. Configure an Illuminate rule:
 *   "if score crosses 500 within 60s, trigger BONUS_TRIGGERED event."
 *   FastAPI listens on illuminate.{gameId}.events and broadcasts a bonus question.
 */
