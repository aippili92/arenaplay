# 11 — Scaling Analysis

---

## ELI5 Version

Imagine a postal service for the internet. When you send a postcard to 1 person, that's 1 delivery. When you send the same postcard to 10,000 people, that's 10,000 deliveries — even though you wrote the card once.

PubNub charges for deliveries, not writes. So when the host publishes one question to 10,000 players, PubNub counts that as 10,001 "transactions" (1 publish + 10,000 deliveries). This is the fan-out model, and it's what makes real-time at scale expensive to naively implement — but PubNub's infrastructure is built to handle exactly this.

Understanding the math lets you size your keyset tier, predict costs, and identify bottlenecks before they hit production.

---

## 10K Players — Per Round Transaction Estimate

A "round" = 30 seconds of gameplay. Here's the math for one round:

| Operation | Publishes | Deliveries | Functions Executions | Notes |
|-----------|-----------|-----------|---------------------|-------|
| Question broadcast | 1 | 10,000 | 0 | 1 publish → 10K subscribers |
| Answer submissions | 10,000 | 1 (backend only) | 10,000 (onBefore) | Each player publishes once |
| Answer reveal | 1 | 10,000 | 0 | Backend → all players |
| Scores updated | 1 | 10,000 | 0 | Backend → all players |
| Reactions (batched) | ~3,333 raw → ~667 published | 667 × 10K subscribers | 667 (onAfter) | 500ms client batching reduces 5x |
| Chat (moderate volume) | 60 | 60 × 10,000 = 600K | 60 (onBefore) | 2 messages/sec × 30s |
| Player count update | 6 | 6 × 10,000 = 60K | 0 | Every 5s, 6 in 30s |
| Crowd energy updates | ~13 | 13 × 10,000 = 130K | — | From reaction aggregator |
| **Round total** | **~14K** | **~870K** | **~10.7K** | |

**Full game (10 rounds):**
- Publishes: ~140K
- Deliveries: ~8.7M
- Functions executions: ~107K

---

## Fan-Out Math: Question Broadcast

This is the most important single transaction in the system.

```
Host publishes 1 message to game.abc123.questions
PubNub has 10,000 active subscribers on that channel
PubNub delivers to all 10,000 simultaneously

Transaction count: 1 publish + 10,000 deliveries = 10,001 transactions
Delivery time: <100ms to 95th percentile globally (PubNub SLA)
Delivery time: <30ms for nearby clients (regional edge nodes)
```

This is why PubNub exists. Building this yourself would require:
- Maintaining 10,000 WebSocket connections
- A connection manager that doesn't become a bottleneck
- A fan-out queue that handles the burst delivery
- Regional infrastructure for global latency

PubNub's edge network handles all of this. The host's single publish triggers 10,000 near-simultaneous deliveries — the host client never touches those 10,000 connections.

---

## Reaction Storm Analysis

Without client-side batching, reactions are the biggest threat to cost and stability:

**Unmitigated:**
```
10,000 players × 1 reaction tap every 3 seconds = 3,333 publishes/sec
Each publish triggers onAfter Function: 3,333 Function executions/sec
Each Function writes to KV Store: 3,333 KV operations/sec → contention
```

**With 500ms client batching:**
```
Each client collects taps for 500ms → 1 publish per 500ms per client
10,000 clients × 2 publishes/sec = 20,000 publishes/sec (still high!)
Wait — most players don't react every 500ms. Realistic: 20% active → 4,000/sec
After batching: ~800 publishes/sec → manageable
```

The math shows that even with batching, a fully engaged crowd is high-volume. The reaction aggregator's 50-reaction threshold before publishing to `crowd.energy` prevents the downstream crowd energy channel from being similarly flooded.

**KV Store race condition at high frequency:**
If 800 executions/sec all try to `incrCounter('energy:gameId')` simultaneously, is there contention? PubNub's `incrCounter` is atomic — designed for concurrent writes. No race condition. This is why `incrCounter` (1 call) is used instead of `get + set` (2 calls + race condition).

---

## What Breaks First at 100K Players

At 10K, everything works. At 100K, three things break:

### 1. Chat Fan-Out Becomes Dominant Cost
```
100K players × 60 chat messages/round × 100K deliveries = 600M deliveries/round
At 10 rounds: 6B delivery transactions/session
```

This is the single biggest scaling problem. Solutions:
- **Message sampling**: Functions onBefore on chat randomly drops 90% of messages at 100K+ (players see a sample of the chat activity, not every message)
- **Chat paging**: don't deliver all messages to all subscribers; use `fetchMessages` for history instead of live delivery

### 2. Backend Channel Subscription
The backend subscribes to `game.{gameId}.answers.inbound`. At 10K: 1 channel. At 100K: still 1 channel (the shared inbound channel scales fine). ✅ Not actually a problem with the inbound channel pattern.

If using per-player answer channels: 100K channels → 50 channel groups of 2,000 each. The backend needs to maintain subscriptions to 50 channel groups — still manageable, but requires horizontal scaling of backend workers.

### 3. Score Calculation Latency
Aggregating 100K answers in the score calculator Function (On-Request, 10s timeout) — at 100K answers with speed bonuses, the computation itself is fast, but network delivery from FastAPI to the Function endpoint has overhead. At extreme scale, consider:
- Stream answers to FastAPI via Functions `onAfter` as they arrive
- FastAPI aggregates in-memory during the 30s window
- After window closes, compute scores locally (no Function call needed)

---

## 100K → 1M: What Changes

| Concern | 100K Solution | 1M Solution |
|---------|--------------|------------|
| Chat fan-out | Message sampling in Functions | "Popular mode" — players see only a feed of top-reacted messages |
| Answer ingest | Single inbound channel | Sharded inbound: 16 channels `answers.inbound.{0..15}`, players hash to shard |
| Leaderboard | Full leaderboard broadcast | Top 100 only; personalized rank for each player via `player.{pid}.notifications` |
| KV Store counters | `incrCounter` | Redis Cluster (lower latency, higher throughput, shard by gameId) |
| Functions KV | Fine at 100K | Rate limits at 1M — move aggregation to FastAPI + Redis |
| Presence counter | FastAPI in-memory | Distributed counter in Redis with CAS (Compare-And-Swap) |
| Backend | Single server | Multiple workers behind load balancer, stateless (move game state to Redis) |

The architectural principle at 1M: **move state out of FastAPI and into Redis**. FastAPI becomes stateless, horizontally scalable. Redis becomes the source of truth for game state, player counts, and answer aggregation.

---

## Cost Model (Approximate)

PubNub pricing is transaction-based. Rough estimate for one 10K-player, 10-round game session:

| Component | Transactions | Cost at $0.0002/1K (estimate) |
|-----------|-------------|------------------------------|
| Delivers (~8.7M) | 8,700,000 | $1.74 |
| Publishes (~140K) | 140,000 | $0.03 |
| Functions (~107K) | 107,000 | included in higher tiers |
| **Total** | **~9M** | **~$1.77 per game session** |

At 1,000 game sessions/day: ~$1,770/day. Manageable for a commercial product — and PubNub enterprise plans have volume discounts that dramatically reduce the per-transaction cost.

**Chat is the cost multiplier.** Disabling chat (or sampling it at scale) reduces delivery transactions by ~70%.
