# 21 — Open Questions & Risks

---

## Unresolved Technical Questions

### OQ-1: Functions wildcard channel pattern support
**Question:** Does `game.*.answers.inbound` work as a Function trigger channel pattern on this keyset?

**Why it matters:** If not, the answer validator must be configured per-game (one deployment per `game.{gameId}.answers.inbound`). For a demo with one game, it's fine. For production at scale, wildcard is essential.

**How to validate:** Deploy the Function with channel `game.*.answers.inbound`, publish a test message to `game.TESTID.answers.inbound`, check Function logs for execution.

**Fallback:** If wildcards aren't supported, use a fixed test game ID for the demo.

---

### OQ-2: PAM enabled on current keyset?
**Question:** Is PAM v3 enabled on `pub-c-b13f7da9-...`?

**Why it matters:** If PAM is disabled, `grant_token()` fails silently (the backend logs a warning and returns an empty token string). The app works without PAM but has no channel permission enforcement — any client can publish to any channel.

**How to validate:** Run the backend, create a game, check if `hostToken` in the response is non-empty. Alternatively: Admin Portal → Keysets → Check for "Access Manager" enabled.

**Risk:** Demo with PAM disabled loses the most architecturally interesting feature. If disabled, enable it in Admin Portal before the interview demo.

---

### OQ-3: Message Persistence enabled?
**Question:** Is Message Persistence enabled on the test keyset?

**Why it matters:** Reconnect catch-up (`fetchMessages`) returns empty without it. The reconnection demo scenario won't work.

**How to validate:** Admin Portal → Keysets → Storage & Playback enabled. Or: publish a message, call `fetchMessages` for that channel, verify non-empty response.

---

## Known Gaps (MVP vs Production)

### KG-1: Per-player answer channels not implemented
**Gap:** Players share `game.{gameId}.answers.inbound`. Player identity not enforced at the network layer.
**Production fix:** Per-player channels with PAM regex. See [D-001](20-decision-log.md) and [07-auth-strategy.md](07-auth-strategy.md).

### KG-2: Game state is in-memory (no persistence)
**Gap:** If FastAPI restarts during a game, all game state is lost.
**Production fix:** Move game state to Redis with Redis persistence. Serialize `GameState` to JSON.

### KG-3: Late join not supported
**Gap:** Players who join after the game starts get a 409.
**Production fix:** Allow late join in QUESTION/REVEAL phase with score starting at 0.

### KG-4: No token expiry check on reconnect
**Gap:** If a player's network drops for longer than their token TTL (2 hours), on reconnect their token is expired. The client-side timer won't have fired (client was offline).
**Production fix:** On `PNReconnectedCategory`, check `Date.now() > tokenExpiry` before catch-up. If expired, request new token first.

### KG-5: Illuminate integration is stubs only
**Gap:** The backend streams events to `illuminate.{gameId}.events` but the BONUS_TRIGGERED callback from Illuminate is not wired to a FastAPI endpoint.
**Production fix:** Configure Illuminate rule to call a FastAPI webhook; FastAPI then publishes BONUS_TRIGGERED to `game.{gameId}.host.control`.

---

## Assumptions Made

1. **PubNub Python SDK v9 PAM v3 API:** The `Channel.id().read().write()` pattern is correct for SDK v9. If `requirements.txt` is pinned to a different version, verify the PAM grant API signature.

2. **Functions KV Store is available on the keyset:** KV Store requires a specific keyset configuration. Validate before demo.

3. **`asyncio.get_event_loop()` in FastAPI:** In FastAPI with Python 3.10+, `asyncio.get_event_loop()` inside async functions may be deprecated in favor of `asyncio.get_running_loop()`. Validate and update `pubnub_service.py` if needed.
