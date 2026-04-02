# 17 — Observability & Debugging

> How to diagnose problems in ArenaPlay during a live session. Real steps, not generic advice.

---

## During a Live Game: What to Watch in Admin Portal

Navigate to **PubNub Admin Portal → Keysets → Debug Console** (or use the dedicated game monitoring).

### Key metrics to watch live:

| Metric | Where | What it means | Alert threshold |
|--------|-------|--------------|----------------|
| Messages/sec | Debug Console | Real-time publish rate | Spike > 5K/s = reaction storm |
| Function errors | Functions → My Module → Logs | onBefore aborts + runtime errors | Any `execution calls exceeds` error |
| Presence occupancy | Debug Console → Presence | Should be 0 (we use counter pattern) | If non-zero: Functions heartbeat issue |
| Message latency | Functions → Logs → timestamps | onBefore execution time | > 200ms = KV Store contention |

---

## Diagnostic 1: Players Are Reporting Delayed Message Delivery

**Symptom:** Questions arrive 2–5 seconds late on some players' screens.

**Step 1 — Isolate to PubNub or the backend:**
```bash
# Backend: measure time from host button click to PubNub publish
# Add timing log in routes/games.py:
import time
start = time.time()
await publish(channels.questions(game_id), payload)
logger.info("Publish to questions took %.3fs", time.time() - start)
```

If backend publish takes <50ms, the delay is in PubNub delivery. If >200ms, the issue is in FastAPI.

**Step 2 — Check PubNub Function latency:**
Admin Portal → Functions → My Module → Logs
Look for entries on `game.{id}.answers.inbound` with execution time. If onBefore is showing 2–5s, the KV Store is under pressure.

**Step 3 — Check for subscriber overload:**
If the game has 10K+ subscribers and chat is active, the chat channel may be producing millions of delivery transactions. Check transactions/sec in the Admin Portal dashboard — if it's pegged at your keyset's tier limit, messages are being queued.

**Fix options:**
- Reduce chat delivery (increase Functions moderation threshold to drop more messages)
- Contact PubNub support to upgrade keyset tier
- Enable channel-level rate limiting via Functions

---

## Diagnostic 2: Player Count Is Wrong

**Symptom:** Host sees "1,200 players" but the game clearly has more/fewer.

**Step 1 — Check the counter update logs:**
```python
# In main.py player_count_publisher, add:
logger.info("Publishing player count %d for game %s", len(game.players), game.game_id)
```

**Step 2 — Check if players are being double-counted:**
If a player refreshes the page, `POST /api/games/{gameId}/join` is called again. Check `add_player` in `game_store.py` — it should be idempotent (if player_id already exists, update don't duplicate).

**Step 3 — Check heartbeat timeout detection:**
If the heartbeat checker is running, verify `last_seen` timestamps are updating. Log the checker:
```python
logger.debug("Checking heartbeats: %d active players", len(game.players))
```

**Root cause if players are being removed too aggressively:** The 30-second heartbeat timeout is too short. Increase to 60 seconds or raise the signal frequency from every 10s to every 5s.

---

## Diagnostic 3: PubNub Function Failure

**Symptom:** Players can submit answers without hitting the frequency cap. Or chat messages with banned words are getting through.

**Step 1 — Check Function logs:**
Admin Portal → Functions → [Module] → Logs
Look for:
- `execution calls exceeds` → the Function hit the 3-call budget. Review the code.
- `TypeError: Cannot read property...` → runtime error in the Function code.
- `KV Store: timeout` → KV Store latency issue under load.

**Step 2 — Test the Function directly:**
Admin Portal → Functions → [Module] → Test Payload
Send a test message and watch the execution output in real-time.

**Step 3 — Check if the Function is deployed:**
Admin Portal → Functions → confirm the Function status is "Running". A deployment failure shows "Error".

**Step 4 — Verify channel pattern:**
If the channel configured in the Function is `game.*.answers.inbound` but the actual channel is `game.ABC123.answers.inbound`, confirm the wildcard pattern matches. Test with an exact channel name first, then switch to wildcard.

---

## Diagnostic 4: 403 Errors on Player Publish

**Symptom:** `pubnub.publish` returns a 403 on the answers or reactions channel.

**Cause 1 — PAM not enabled on keyset:**
The token grant succeeded (no error) but returned an empty string. The client called `pubnub.setToken("")` which does nothing. Fixed: check if token is empty after join:
```javascript
if (token) pubnub.setToken(token);
else console.warn('[ArenaPlay] PAM not enabled — running without access tokens');
```

**Cause 2 — Token expired:**
Check token TTL. The client-side refresh timer should have fired. Check browser console for "Token refreshed" logs.

**Cause 3 — Wrong channel in grant:**
The player token grants write on `game.{gameId}.answers.inbound`. Verify the channel name in the publish call exactly matches. Case-sensitive.

**Cause 4 — Authorized UUID mismatch:**
PAM v3 tokens include an `authorized_uuid` field. If `pubnub.userId` doesn't match the `authorized_uuid` in the token, all operations return 403.
```javascript
// Verify in browser console:
console.log(pubnub.userId); // should match the playerId in the token
```

---

## Diagnostic 5: Messages Out of Order

**Symptom:** Leaderboard updates appear before the answer reveal, or questions arrive out of order.

**PubNub guarantees ordering per channel** — messages on a single channel arrive in publish order. If messages appear out of order, it's a client-side rendering issue, not a PubNub issue.

**Check:** Are you rendering messages as they arrive without timetoken sorting? After a reconnect catch-up, `fetchMessages` results are mixed with live message events. Sort by timetoken:
```javascript
setMessages(prev =>
  [...prev, newMsg]
    .sort((a, b) => BigInt(a.timetoken) < BigInt(b.timetoken) ? -1 : 1)
    .filter((m, i, arr) => arr.findIndex(x => x.timetoken === m.timetoken) === i)
);
```

The `BigInt` comparison is necessary because PubNub timetokens are 17-digit integers — larger than JavaScript's safe integer range (`Number.MAX_SAFE_INTEGER` = 15 digits).
