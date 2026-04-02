# 10 — PubNub Functions Design

---

## ELI5 Version

PubNub Functions are like bouncers and scorekeepers that live right at the venue entrance (the "edge"), not in your office building (your server).

- The **answer validator** bouncer checks: "Is this a valid answer? Did this person already answer?" — if not, they're turned away at the door before anyone inside even knows they tried.
- The **chat moderator** bouncer checks: "Is this message clean?" — blocked messages never enter the venue.
- The **reaction scorekeeper** sits inside and tallies up emoji reactions — they don't block anyone from entering, they just keep score.
- The **score calculator** is a calculator service you can call whenever you need final scores.

The venue analogy matters: Functions run at PubNub's edge, close to where messages originate. This means they add minimal latency and they scale with PubNub's network, not your server.

---

## The 3-Call Budget Constraint

**This is the most important constraint in Functions design.**

Every Function execution can make at most 3 external calls combined across:
- `kvstore.get()` and `kvstore.set()` / `kvstore.incrCounter()`
- `pubnub.publish()`, `pubnub.fire()`, `pubnub.signal()`
- `xhr.fetch()` (external HTTP calls)

Exceed 3 and the execution fails with `"execution calls exceeds"`. The message may be lost (for onBefore) or the side effect silently skipped (for onAfter).

**This constraint drives every design decision below.**

---

## Function 1: Answer Validator

| Property | Value |
|----------|-------|
| **Trigger** | `onBefore` publish |
| **Channel** | `game.{gameId}.answers.inbound` |
| **External calls used** | 2 (kvstore.get + kvstore.set) |
| **Can abort message** | YES — `request.abort()` |

```javascript
// functions/answer-validator.js
export default async (request) => {
  const kvStore = require('kvstore');
  const msg = request.message;

  // Validate required fields
  if (!msg.gameId || !msg.playerId || !msg.questionId || !msg.roundNumber) {
    return request.abort('Missing required fields');
  }
  if (!['A', 'B', 'C', 'D'].includes(msg.answer)) {
    return request.abort('Invalid answer choice');
  }

  // Frequency cap: one answer per player per round
  const capKey = `cap:${msg.gameId}:${msg.playerId}:${msg.roundNumber}`;
  const existing = await kvStore.get(capKey);   // Call 1
  if (existing) return request.abort('Duplicate answer');
  await kvStore.set(capKey, '1', 3600);          // Call 2

  return request.ok();
};
```

**Why `onBefore`?** The duplicate check must prevent delivery. If we used `onAfter`, the second answer would already be delivered to the backend before we could stop it. `onBefore` runs synchronously in the message path — `abort()` drops the message before it reaches any subscriber.

**Why KV Store for the cap?** Functions are stateless. The cap must persist across multiple Function executions (multiple player submissions within the same round). KV Store is the only persistence available within the Functions runtime.

**The TTL on the cap key (3600s = 1 hour):** Without a TTL, KV Store entries accumulate indefinitely. 10K players × 10 rounds = 100K keys per game. With a 1-hour TTL, they auto-expire. This prevents KV Store bloat across many game sessions.

**What the cap key prevents at scale:** Without this, a player could call PubNub's publish endpoint directly (bypassing the frontend) in a loop, submitting 100 answers per second. The Function rejects any answer after the first for a given player+round combination.

---

## Function 2: Reaction Aggregator

| Property | Value |
|----------|-------|
| **Trigger** | `onAfter` publish |
| **Channel** | `game.{gameId}.reactions` |
| **External calls used** | 1–2 (incrCounter, optionally publish) |
| **Can abort message** | NO — onAfter runs after delivery |

```javascript
// functions/reaction-aggregator.js
export default async (request) => {
  const kvStore = require('kvstore');
  const pubnub = require('pubnub');
  const msg = request.message;

  if (!msg.gameId || !Array.isArray(msg.reactions)) return request.ok();

  const burst = msg.reactions.reduce((sum, r) => sum + (r.count || 1), 0);

  // incrCounter is atomic AND returns the new value — 1 call instead of get+set
  const newScore = await kvStore.incrCounter(`energy:${msg.gameId}`, burst); // Call 1

  // Publish crowd energy update every time we cross a multiple of 50
  if (newScore % 50 < burst) {
    await pubnub.publish({                                                    // Call 2
      channel: `game.${msg.gameId}.crowd.energy`,
      message: { type: 'CROWD_ENERGY_UPDATE', gameId: msg.gameId, score: newScore, ts: Date.now() }
    });
  }

  return request.ok();
};
```

**Why `onAfter`?** Aggregation is a side effect — it doesn't need to block or modify message delivery. Players should see each other's emoji reactions immediately (the reaction message is delivered first), then the crowd energy score updates asynchronously.

**Why `incrCounter` instead of `get + set`?**
1. It costs 1 call instead of 2, leaving budget for the conditional publish
2. It's atomic — safe under concurrent writes. At 800 reaction publishes/sec, many Function executions run simultaneously. `get + set` has a race condition: two executions can both `get(0)`, both compute `newScore = 1`, and both `set(1)` — losing the second increment. `incrCounter` is atomic and always produces the correct cumulative result.

**The threshold calculation `newScore % 50 < burst`:** This detects when the counter crosses a multiple of 50, without needing a separate read. If the previous value was 48 and we add a burst of 5 (new = 53), then `53 % 50 = 3` and `3 < 5` → we crossed. If previous was 45 and burst is 2 (new = 47), then `47 % 50 = 47` and `47 < 2` → no crossing. Clean, no extra KV read.

---

## Function 3: Chat Moderator

| Property | Value |
|----------|-------|
| **Trigger** | `onBefore` publish |
| **Channel** | `game.{gameId}.chat` |
| **External calls used** | 1 (kvstore.get) |
| **Can abort message** | YES |

```javascript
// functions/chat-moderator.js
export default async (request) => {
  const kvStore = require('kvstore');
  const text = (request.message.text || '').toLowerCase();

  const raw = await kvStore.get('banned_words'); // Call 1
  if (!raw) return request.ok();                 // No list = pass everything

  let banned;
  try { banned = JSON.parse(raw); }
  catch { return request.ok(); }                 // Malformed list = fail open

  if (banned.some(word => text.includes(word.toLowerCase()))) {
    return request.abort('Message blocked by moderation');
  }
  return request.ok();
};
```

**Pre-populate in Admin Portal → KV Store:**
```json
Key: "banned_words"
Value: ["badword1", "badword2", "spam"]
```

**Why fail open on malformed list?** In production chat, blocking all messages because of a misconfigured KV entry is worse than letting a few bad words through. Fail-open is the right default; the admin can fix the KV entry without downtime.

**Production upgrade:** Use `onAfter` + async call to Perspective API for ML-based moderation. `onBefore` with local list = fast but limited. `onAfter` with ML = thorough but asynchronous (deliver first, then remove if flagged).

---

## Function 4: Score Calculator

| Property | Value |
|----------|-------|
| **Trigger** | `onRequest` (REST endpoint) |
| **Method** | POST |
| **Path** | `/score` |
| **External calls used** | 0 (pure computation) |

```javascript
// functions/score-calculator.js
export default async (request) => {
  const { correctAnswer, answers = [], questionOpenedAt, timeLimit = 30 } =
    JSON.parse(request.params.body || '{}');

  const timeWindowMs = timeLimit * 1000;

  const scores = answers.map(a => {
    if (a.answer !== correctAnswer) {
      return { playerId: a.playerId, correct: false, base: 0, speedBonus: 0, total: 0 };
    }
    // Speed bonus: 0–50 pts, linearly scaled by time to answer
    const elapsed = Math.min(a.submittedAt - questionOpenedAt, timeWindowMs);
    const speedBonus = Math.round((1 - elapsed / timeWindowMs) * 50);
    return { playerId: a.playerId, correct: true, base: 100, speedBonus, total: 100 + speedBonus };
  });

  return request.respond({ status: 200, body: JSON.stringify({ scores }) });
};
```

**Why `onRequest` and not `onBefore` or `onAfter`?**
Scoring requires all answers for the round — it's a batch operation that runs after the 30-second window closes. `onBefore/onAfter` run per-message (wrong granularity). `onRequest` is a REST endpoint that FastAPI calls explicitly with the full answer set after the window. This is the correct trigger type for aggregation-after-window patterns.

**Why 0 external calls?** Score calculation is pure arithmetic. No KV Store, no external API. This means the Function never fails due to the 3-call limit, regardless of how many players or answers are in the batch.

---

## Functions Deployment Checklist

These Functions must be created in the PubNub Admin Portal → Functions:

| Function | Module Name | Event Type | Channel |
|----------|-------------|-----------|---------|
| Answer Validator | `arenaplay-answer-validator` | Before Publish | `game.*.answers.inbound` |
| Reaction Aggregator | `arenaplay-reaction-aggregator` | After Publish | `game.*.reactions` |
| Chat Moderator | `arenaplay-chat-moderator` | Before Publish | `game.*.chat` |
| Score Calculator | `arenaplay-score-calculator` | On Request | — |

For the channel patterns: `game.*.answers.inbound` — confirm your keyset supports the `*` wildcard pattern in Function channel configuration. If not, configure per-game (or use the shared inbound channel pattern without wildcards and deploy one Function per keyset covering all games).

After deploying the chat moderator, add the `banned_words` key in **Admin Portal → Functions → My Instance → KV Store**.
