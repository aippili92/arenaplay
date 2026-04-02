# 15 — QA Strategy & Test Matrix

**Invoking: `pubnub-qa-planner`**

---

## Scope

Full QA coverage for ArenaPlay's PubNub integration: message delivery, presence counter, PAM, Functions, reconnection, and scale scenarios.

---

## Prerequisites

- PubNub **test keyset** (separate from production) with Message Persistence enabled
- Environment: `PUBNUB_PUBLISH_KEY`, `PUBNUB_SUBSCRIBE_KEY`, `PUBNUB_SECRET_KEY` set to test values
- Backend running on `localhost:8000`
- Use unique `gameId` per test run to avoid cross-test interference
- Heartbeat timeout set to 10s for faster presence tests (set in PubNub config)

---

## Test Matrix

| ID | Category | Test Case | Steps | Expected Result | Priority |
|----|----------|-----------|-------|----------------|----------|
| T01 | Delivery | Question fan-out to N players | 10 players join, host broadcasts question | All 10 receive QUESTION_BROADCAST within 2s | P0 |
| T02 | Delivery | Answer submission reaches backend | Player publishes answer | Backend receives answer, records in `round_answers` | P0 |
| T03 | PAM | Unauthorized leaderboard publish | Player attempts `pubnub.publish` to `game.X.leaderboard` | 403 — publish blocked | P0 |
| T04 | PAM | Player cannot spoof another player's answer | Player A sets `playerId: "player-B"` in answer message | Function receives and records with player A's actual channel identity; at MVP level, functional test of frequency cap | P0 |
| T05 | PAM | Token expiry blocks operations | Wait for token TTL, attempt publish | 403 after TTL | P0 |
| T06 | PAM | Token refresh restores access | Let token expire, call `/api/token/refresh`, retry publish | Publish succeeds after refresh | P0 |
| T07 | Functions | Answer validator blocks duplicate | Submit same answer twice in same round | Second submit returns 403 / abort | P0 |
| T08 | Functions | Answer validator blocks invalid format | Submit `{answer: "Z"}` (invalid option) | Publish aborted, error returned | P0 |
| T09 | Functions | Chat moderator blocks banned word | Send chat message with word in banned list | Message never delivered to subscribers | P0 |
| T10 | Functions | Chat moderator passes clean message | Send normal chat message | Message delivered to all subscribers | P0 |
| T11 | Functions | Reaction aggregator accumulates score | Publish 50 reaction bursts | `game.X.crowd.energy` receives one CROWD_ENERGY_UPDATE | P1 |
| T12 | Reconnect | Player catches up after brief disconnect | Subscribe, receive 2 messages, drop connection for 5s, reconnect | `fetchMessages` returns missed messages on PNReconnectedCategory | P0 |
| T13 | Reconnect | Player catches up after question broadcast missed | Drop connection before QUESTION_BROADCAST, reconnect | Player sees current question via fetchMessages | P0 |
| T14 | Reconnect | Player score preserved across reconnect | Score after round 2, disconnect, reconnect | Score unchanged, GET /api/games/{id} returns same score | P1 |
| T15 | Presence | Player count updates on join | Start game, 5 players join | `game.X.player.count` shows 5 within 10s | P1 |
| T16 | Presence | Player count decrements on leave | 5 players joined, 2 disconnect | Count drops to 3 within 40s (heartbeat timeout) | P1 |
| T17 | Ordering | Leaderboard arrives after reveal | Host triggers reveal | ANSWER_REVEAL arrives before SCORES_UPDATED (or at same timetoken order) | P1 |
| T18 | Game flow | Full round happy path | Host creates game → players join → question → answers → reveal → scores | All state transitions correct, all players receive each event | P0 |
| T19 | Game flow | Empty round (no answers) | Host reveals with no players answering | ANSWER_REVEAL sent, distribution all zeros, leaderboard unchanged | P1 |
| T20 | Game flow | Game ends at last round | Host clicks next after final round | `advance_round` returns None, GAME_ENDED published | P1 |
| T21 | Scale | 10 simultaneous answer submissions | 10 clients all publish answers at same time | All 10 accepted (frequency cap: first per player), no race condition | P1 |
| T22 | Scale | Reaction batching reduces traffic | 1 client taps reactions 20 times in 500ms | Only 1 REACTION_BURST message published | P1 |
| T23 | Security | secretKey not in any HTTP response | Create game, join game, refresh token | No `secret_key` or `sec-c-*` in any API response | P0 |
| T24 | Security | Player token grants correct permissions | Inspect granted token | Token has write on `answers.inbound`, read-only on `questions`, no write on `leaderboard` | P0 |
| T25 | Correctness | Speed bonus calculation | First correct answer (instant) vs last correct answer (at 29s) | First gets ~+50, last gets ~0 | P1 |

---

## Edge Cases

1. **Player submits after 30-second window closes:** Host has already triggered `/reveal`. Backend is in REVEAL phase. Player publishes to `answers.inbound`. The answer is not in `round_answers` (round was cleared). Score = 0. No Function abort — the Function only deduplicates per round number, not per time. Future: add round-open state to the KV cap check.

2. **Host refreshes page mid-game:** Host loses the `hostToken` from memory. They need to request a new token. `/api/token/refresh` requires the existing game to still be in memory on the backend. If backend restarts, game state is lost (in-memory store). For demo: don't restart the backend during a game.

3. **Two players use the same `displayName`:** The system deduplicates by `player_id` (UUID), not `displayName`. Leaderboard may show two "Alice" entries. Future: validate uniqueness of displayName at join time.

4. **Player joins after game has started:** Currently blocked (409 response). Future: allow late join with score starting at 0, show "late joiner" badge.

5. **Chat message exactly on the banned-word boundary:** If `text` contains the banned word as a substring (e.g., "assassin" contains "ass"), it's blocked. Implement word-boundary checking for production.

6. **fetchMessages returns 0 results (persistence disabled):** Reconnect flow silently degrades — player gets current state from HTTP only. No error thrown. This is the graceful degradation path.

7. **Token refresh during a question:** Player receives new token via `/api/token/refresh` and calls `pubnub.setToken()`. They were in the middle of a 30-second countdown. The token swap is live — no interruption. This is the beauty of the client-side timer strategy.

---

## Environment Considerations

- Use a **dedicated test keyset** — never run automated tests against production keys
- Generate unique `gameId` per test: `game_id = f"test-{uuid.uuid4().hex[:8]}"`
- PubNub test cleanup: channels auto-expire from `hereNow` after heartbeat timeout; history cleanup requires deleting messages via API
- Heartbeat settings for faster tests: set `heartbeatInterval: 5, presenceTimeout: 15` in test PubNub config
- Async test framework: use `pytest-asyncio` for Python tests, `vitest` with `--timeout 30000` for JS tests
- Network simulation for reconnect tests: use browser DevTools → Network → Offline, or `tc netem` on Linux
