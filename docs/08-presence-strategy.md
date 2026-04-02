# 08 — Presence & Player Count Strategy

---

## ELI5 Version

Imagine 10,000 people walking into a stadium at the same time, and each person shouts "I'm here!" the moment they arrive. That's 10,000 shouts at once. Everyone inside the stadium hears all 10,000 shouts, plus they try to count them at the same time. Total chaos.

That's what PubNub's native presence does at scale. It's designed for small rooms (under ~100 people). For 10,000 simultaneous players, you need a smarter approach: a **counter**.

Instead of everyone announcing themselves, they quietly sign in at the front desk. The front desk keeps a running count and posts an update every 5 seconds: "Current attendees: 9,823." Everyone sees one update every 5 seconds, not 10,000 individual announcements.

---

## Why Native Presence Fails at 10K Players

PubNub Presence works by firing events to a presence channel (`{channel}-pnpres`) every time a user joins or leaves.

At 10,000 players joining a game in a 5-minute pre-game window:
- Rate of join events: ~33/second
- Every subscriber to the presence channel receives every join event
- If all 10K players have `withPresence: true`: **10K subscribers × 33 events/sec = 330K delivery transactions/second**

That's the storm. Three specific problems:

1. **Transaction cost**: 330K transactions/second × 5 minutes = ~99M transactions just for presence during lobby
2. **`hereNow` payload size**: a `hereNow` query at 10K players returns a JSON array of 10K UUIDs — roughly 200KB+ per API call. If clients poll every 5 seconds, they're each downloading 200KB every 5 seconds.
3. **Heartbeat thundering herd**: at 10K players, simultaneous heartbeat signals create spikes in PubNub's network tier

**Presence is designed for rooms, not stadiums.**

---

## The Counter Pattern

ArenaPlay uses a server-managed counter instead of native presence.

```
┌─────────────────────────────────────────────────────┐
│                     FastAPI Backend                  │
│                                                      │
│  player_count["game-abc123"] = 9823                  │
│                                                      │
│  asyncio background task (every 5 seconds):          │
│    → publish to game.abc123.player.count:            │
│      {"type": "PLAYER_COUNT_UPDATE", "count": 9823}  │
└─────────────────────────────────────────────────────┘
```

Player joins → `POST /api/games/{gameId}/join` increments the counter.
Player disconnects → heartbeat timeout (30s silence) decrements the counter.

All clients subscribe to `game.{gameId}.player.count`. They receive one small update every 5 seconds. No matter how many players there are, every client receives the same 1 message per 5 seconds.

**Transaction cost comparison:**

| Approach | 10K players, 5 min | 10K players, 30 min game |
|----------|-------------------|--------------------------|
| Native presence | ~99M transactions | ~594M transactions |
| Counter pattern | 6 publishes/30s × 10K subs = 60K/30s | 360K total |
| Reduction | **1,650x cheaper** | |

---

## Heartbeat and Disconnect Detection

For the player count to be accurate, the backend needs to know when a player disconnects.

**MVP approach:** Players send a lightweight `signal` to `game.{gameId}.heartbeat` every 10 seconds. A PubNub Signal is:
- Max 64 bytes (just `{pid: "player-uuid-001"}` = ~30 bytes)
- Not persisted
- Low cost

FastAPI tracks `last_seen[player_id]` timestamps. A background task checks every 30 seconds — if a player hasn't been seen in 30 seconds, they're considered disconnected and the count is decremented.

```python
async def heartbeat_checker():
    while True:
        await asyncio.sleep(30)
        now = time.time()
        for game in all_active_games():
            for pid, player in list(game.players.items()):
                if now - player.last_seen > 30:
                    # Player disconnected
                    del game.players[pid]
```

**Production approach:** Use native PubNub presence on a dedicated `game.{gameId}.heartbeat` channel — but subscribe to its `-pnpres` channel **only on the backend**, not on player clients. A PubNub Function `onAfter` on the presence channel increments/decrements the KV Store counter atomically. The backend never receives a flood of presence events — it only reads the counter.

---

## When to Use Native Presence

Native presence is excellent — for the right scale. Use it when:

| Use Case | Player Count | Appropriate? |
|----------|-------------|-------------|
| Private trivia room (friends) | 2–20 | ✅ Yes — perfect |
| Small tournament bracket | 20–100 | ✅ Yes |
| Mid-size event | 100–500 | ⚠️ Use with caution — disable `hereNow` polling |
| ArenaPlay public game | 1K–10K | ❌ No — use counter pattern |
| Live broadcast / streaming | 10K+ | ❌ No — counter pattern required |

The cutoff is roughly 500 concurrent users on a presence-enabled channel. Above that, the delivery transaction cost and `hereNow` payload size make native presence impractical without tuning.

**Presence tuning (if you use it at mid-scale):**
```javascript
const pubnub = new PubNub({
  // ...
  heartbeatInterval: 30,   // default 300 — reduce heartbeat frequency
  presenceTimeout: 90,     // default 300 — how long before a timeout fires
})
```

Longer heartbeat intervals = fewer heartbeat transactions = lower cost. But it also means slower disconnect detection. This is a tradeoff you explicitly tune per use case.

---

## Interview Answer: "Why not just use PubNub presence?"

> "Native presence is designed for rooms, not stadiums. At 10K simultaneous joins, the presence channel receives a burst of ~33 join events per second, and every subscribing client processes all of them. With 10K subscribers, that's 330K delivery transactions per second just to tell people someone joined.
>
> Additionally, `hereNow` at 10K players returns a 200KB+ JSON payload per call. If clients poll every 5 seconds, the bandwidth cost alone is prohibitive.
>
> The counter pattern costs 1 publish × 10K deliveries every 5 seconds — roughly 1,650x cheaper. The tradeoff is that we lose individual UUID tracking (we know the COUNT but not WHO is online), which is acceptable for a game show where the player count is a display metric, not a functional requirement."
