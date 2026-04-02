# 20 — Decision Log

Every architectural decision in ArenaPlay, with rationale and rejected alternatives.

---

## D-001: Shared inbound channel for answers (MVP)

**Date:** 2026-04-02
**Decision:** Use `game.{gameId}.answers.inbound` (one channel) instead of `game.{gameId}.answers.{playerId}` (one channel per player).

**Rationale:** Per-player channels require the backend to subscribe to N channels (up to 10K) via channel groups, adding setup complexity for a demo. The shared inbound channel requires one subscription and works immediately.

**Alternatives considered:**
- Per-player channels + channel groups → correct production pattern; documented as the upgrade path in doc 07
- Sharded inbound channels (16 shards via CRC32 hash) → the right pattern at 100K+; overkill for MVP

**Tradeoff:** The shared inbound channel allows Player A to publish a message claiming to be Player B. Mitigated by Function validation. Not acceptable for production without per-player channels.

---

## D-002: Client-side timer for PAM token refresh

**Date:** 2026-04-02
**Decision:** Client sets a timer at token receipt; refreshes proactively at T-20 minutes.

**Rationale:** Proactive Server Push requires server-side expiry tracking for all active tokens (10K entries). Just-in-Time 403 handling causes mid-game answer failures. Client-side timer is decentralized and invisible to the user.

**Alternatives considered:**
- Proactive Server Push → correct for high-security systems; too much server state for a game
- Just-in-Time 403 → simpler code but bad UX (player loses a round's points)

**Tradeoff:** If the client tab is suspended for >20 minutes (mobile background tab), the timer doesn't fire. Handle this in production by checking token expiry on tab focus event.

---

## D-003: Counter pattern for player count instead of native presence

**Date:** 2026-04-02
**Decision:** Backend-managed counter with 5-second publish cadence.

**Rationale:** 1,650x cheaper in transactions at 10K players. `hereNow` at 10K returns 200KB+ payloads. Join/leave storm during lobby.

**Alternatives considered:**
- Native presence with `withPresence: true` → correct for rooms under ~500 players
- Native presence on server-side only (no client delivery) + Functions counter → production approach; not needed for MVP

**Tradeoff:** 5-second lag on count updates. Player count is decorative in ArenaPlay — exact real-time accuracy is not a functional requirement.

---

## D-004: `onBefore` Function for answer validation (not `onAfter`)

**Date:** 2026-04-02
**Decision:** Answer Validator runs as onBefore handler.

**Rationale:** Duplicate answers must be blocked before delivery to the backend. onAfter runs post-delivery — the backend would receive the duplicate before the Function could reject it.

**Alternatives considered:**
- onAfter + backend deduplication → backend must handle duplicates regardless; defeats the purpose
- Server-side validation only (no Function) → adds a server round-trip for every answer; increases latency

**Tradeoff:** onBefore adds Function execution time to the message path. At 15ms KV latency, total onBefore overhead is ~20–30ms. For an answer submission (not latency-sensitive), this is acceptable.

---

## D-005: Local KV Store word list for chat moderation (not external API)

**Date:** 2026-04-02
**Decision:** Chat moderator uses a local banned-word list in KV Store.

**Rationale:** External moderation API (Perspective API) adds 50–200ms latency to every chat message in an onBefore handler. The 10-second Function timeout also limits recovery from slow API calls. KV Store read is ~15ms.

**Alternatives considered:**
- Perspective API in onBefore → too slow; risks timeout
- Perspective API in onAfter → correct production pattern (async: deliver then remove if flagged); save for v2

**Tradeoff:** Local word list only catches known bad words. ML-based moderation (semantic understanding) requires onAfter approach.

---

## D-006: `incrCounter` for reaction energy (not `get + set`)

**Date:** 2026-04-02
**Decision:** Use `kvStore.incrCounter()` for the crowd energy accumulator.

**Rationale:** `incrCounter` is atomic (eliminates race conditions under concurrent writes), costs 1 external call (vs 2 for get+set), and returns the new value (no second read needed for threshold check).

**Alternatives considered:**
- `kvStore.get` + `kvStore.set` → race condition at high concurrency + 2 calls
- In-memory accumulation (no KV) → Functions are stateless; no in-memory state between executions

**Tradeoff:** None. `incrCounter` is strictly better for this use case.

---

## D-007: Score Calculator as On-Request (not embedded in FastAPI)

**Date:** 2026-04-02
**Decision:** Score calculation lives in a PubNub Functions On-Request endpoint.

**Rationale:** Demonstrates the On-Request trigger type (useful for interview), runs on PubNub edge, stateless pure computation with 0 external calls (no timeout risk).

**Alternatives considered:**
- Score calculation in FastAPI only → simpler; perfectly valid for production
- Score calculation in onAfter → wrong granularity (runs per-message, not after full answer window)

**Tradeoff:** An extra HTTP hop from FastAPI to the Functions endpoint. For a demo, the architectural illustration value outweighs the latency cost. Production systems might well compute scores in FastAPI directly.

---

## D-008: React + Vite for frontend (no component library)

**Date:** 2026-04-02
**Decision:** Plain React with custom CSS, no UI library.

**Rationale:** UI libraries (shadcn, Chakra, MUI) produce recognizable AI-generated-demo aesthetics. Custom CSS lets us build a distinctive dark game-show design that looks intentional and professional.

**Alternatives considered:**
- Vanilla JS (no build step) → simpler, but harder to maintain state across reconnects and game phases
- Vue or Svelte → React is industry standard; easier for a demo audience to follow

**Tradeoff:** More CSS to write. Worth it for the visual distinctiveness.

---

## D-009: Persist player UUID in localStorage

**Date:** 2026-04-02
**Decision:** Player ID is generated once and persisted in localStorage as `arenaPlayUserId`.

**Rationale:** If a player refreshes the page or their tab crashes, they reconnect as the same user with the same score. Their answer history in PubNub Message Persistence is tied to this UUID. Without persistence, refresh = ghost user + lost score.

**Alternatives considered:**
- Session storage → cleared on tab close; players lose identity on refresh
- Backend-assigned UUID → requires login state; too heavy for a game join flow

**Tradeoff:** If the player clears localStorage, they get a new identity and lose their game history. Acceptable for a game show use case.
