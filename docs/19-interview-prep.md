# 19 — SA Interview Prep: ArenaPlay Knowledge Briefing

> This is the document to read the morning of the interview.
> Structure: concept → what it is → how ArenaPlay uses it → what a Principal SA would ask → strong answer.

---

## 1. Channel Design

**What it is:** PubNub channels are named pub/sub topics. Publishers push to them; subscribers receive from them. Channel naming conventions affect wildcards, PAM pattern matching, and your ability to reason about message flow.

**How ArenaPlay uses it:** Hierarchical dot-separated names: `game.{gameId}.{purpose}`. This enables future wildcard subscribe (`game.abc123.*`), consistent PAM regex matching, and immediately obvious publisher/subscriber ownership.

**What the Principal SA would ask:** "Why not just use one channel for everything in a game?"

**Strong answer:** "Separate channels give you independent control over persistence, PAM permissions, and Function triggers. If everything is on one channel, a player's answer and the host's question are in the same permission bucket — you can't grant read-only on questions without also granting read on answers. Separate channels also let you enable persistence on leaderboard and chat (players need history) while keeping reactions ephemeral without extra configuration. Channel separation is the architectural expression of functional separation."

---

## 2. Timetokens

**What it is:** PubNub timetokens are 17-digit integers representing time in tenths of microseconds since a specific epoch (January 1, 2000 UTC in PubNub's system — actually it's standard Unix epoch × 10,000,000). Every published message has a timetoken. They are the canonical ordering mechanism.

**How ArenaPlay uses it:** The player client stores the `timetoken` of every received message in a React ref (`lastSeenTimetoken`). On reconnect, the client calls `fetchMessages({start: lastSeenTimetoken})` to retrieve exactly the messages it missed — no duplicates, no gaps.

**What the Principal SA would ask:** "What happens if two players submit answers at the exact same millisecond?"

**Strong answer:** "PubNub timetokens resolve to 100-nanosecond precision — effectively guaranteeing a unique ordering even for simultaneous submissions. The channel serializes message delivery; even if two players hit submit at the 'same' millisecond, PubNub assigns distinct timetokens and the messages are ordered deterministically. In ArenaPlay's scoring, the speed bonus uses the timetoken directly: `speedBonus = f(answerTimetoken - questionTimetoken)`. This gives sub-millisecond fair ordering."

---

## 3. Presence at Scale

**What it is:** PubNub Presence fires join/leave/timeout events and provides `hereNow`/`whereNow` APIs. It's designed for tracking who is online on a channel.

**How ArenaPlay uses it:** ArenaPlay deliberately avoids native presence at 10K+ players. Instead: server-managed counter + background publish to `game.{gameId}.player.count` every 5 seconds.

**What the Principal SA would ask:** "Why not just enable presence? Isn't that what it's for?"

**Strong answer:** "Presence is designed for rooms, not stadiums. At 10K players joining a game in a 5-minute window, you get 33 join events per second on the presence channel. With 10K subscribers all receiving those events, that's 330K delivery transactions per second — just for people joining. `hereNow` at 10K players also returns a 200KB+ JSON payload per query. The counter pattern costs 60K transactions every 30 seconds (1 publish × 10K subscribers × 6 updates) vs 330K/second for native presence — roughly 1,650x cheaper. The tradeoff: we lose individual UUID tracking and get eventual consistency (5-second lag on the count). For a game show, 'live player count' with 5s lag is perfectly acceptable."

---

## 4. PubNub Functions Constraints

**What it is:** PubNub Functions are edge-hosted serverless JS. Before Publish (onBefore) runs synchronously in the message path; After Publish (onAfter) runs asynchronously after delivery; On Request is a REST endpoint.

**How ArenaPlay uses it:** 4 functions: answer validator (onBefore), reaction aggregator (onAfter), chat moderator (onBefore), score calculator (onRequest).

**What the Principal SA would ask:** "Why is the chat moderator using a local word list instead of the Perspective API?"

**Strong answer:** "The 10-second Function timeout is the hard constraint. An external moderation API like Perspective typically takes 50–200ms minimum — plus our answer validator already uses 2 of our 3 external call slots if it's on the same execution. In an onBefore handler, that 200ms is added to every single chat message's delivery latency. For a live game, that's unacceptable. The right production pattern is: use onBefore with a local KV Store list for instant blocking of known bad content, AND use onAfter with Perspective API for asynchronous detection — if flagged, publish a 'message removed' event. That way delivery is instant AND moderation is thorough, just not synchronous."

**What the Principal SA would ask:** "What's the 3-call limit in Functions?"

**Strong answer:** "KV reads, KV writes, XHR calls, and PubNub publish/fire/signal all share a combined limit of 3 external calls per Function execution. This is the most important constraint to design around. In the answer validator, I use 2 calls: `kvStore.get` (duplicate check) + `kvStore.set` (set the cap flag). In the reaction aggregator, I use `incrCounter` as a single atomic call instead of get+set — that saves one call AND eliminates the race condition from concurrent writes. The score calculator uses 0 external calls — it's pure math."

---

## 5. PAM Flow and the secretKey Rule

**What it is:** PAM v3 uses cryptographically signed tokens. The `secretKey` is used server-side only to sign `grant_token()` calls. Tokens are time-limited and permission-scoped per channel.

**How ArenaPlay uses it:** FastAPI is the sole holder of `secretKey`. Players and hosts authenticate to FastAPI, which calls `grant_token()` and returns the token to the client. Clients call `pubnub.setToken(token)`.

**What the Principal SA would ask:** "What happens if a player's token expires mid-game?"

**Strong answer:** "The client sets a timer at token receipt — at T minus 20 minutes (before the 120-minute expiry), it silently calls `/api/token/refresh` and calls `pubnub.setToken(newToken)`. No disconnect, no resubscribe. The player never notices. I chose the client-side timer strategy over Just-in-Time 403 handling because a 403 mid-game means the player's answer attempt fails — they lose points through no fault of their own. And I chose it over Proactive Server Push because that requires the server to track 10K individual expiry timestamps. The client-side timer is decentralized, stateless on the server, and invisible to the user."

**What the Principal SA would ask:** "What happens if someone puts the secretKey in their browser?"

**Strong answer:** "The secretKey is the root of all authority in the PAM system. With the secretKey, you can grant any permission on any channel to any user — including yourself read+write access to every channel forever. It's the equivalent of a root password. In browser code, it would be visible in DevTools → Sources in seconds. The code review checklist explicitly checks for `secretKey` in any file that could be bundled for the browser. In ArenaPlay, the secretKey is loaded from environment variables only in `pubnub_service.py` and never appears in any HTTP response."

---

## 6. Catch-up on Reconnect

**What it is:** When a PubNub client reconnects after a network drop, it fires a `PNReconnectedCategory` status event. If message persistence is enabled on the channel, the client can call `fetchMessages({start: lastSeenTimetoken})` to retrieve messages it missed.

**How ArenaPlay uses it:** The `usePubNubListener` hook stores the timetoken of every received message. On `PNReconnectedCategory`, it calls `fetchMessages` for the persisted channels (questions, leaderboard, hostControl), then calls `GET /api/games/{gameId}` to get current game phase. The UI reconciles both sources.

**What the Principal SA would ask:** "What exactly does the player see if they disconnect during a question and reconnect after the answer is revealed?"

**Strong answer:** "When they reconnect, `fetchMessages` returns the ANSWER_REVEAL and SCORES_UPDATED messages that were published while they were offline. The client processes these in order. Their UI transitions to the reveal state — correct answer highlighted, their score updated. If they had submitted an answer before disconnecting and it was delivered and validated (the onBefore Function ran), their score is already computed by the backend. If they disconnected before answering, they simply don't have an answer for that round — the backend treats missing answers as wrong with no points. The `/api/games/{gameId}` call also returns the current round number and phase, so if they missed the reveal entirely and the game moved on to the next question, the UI jumps directly to that state. There's no 'undo' for missed rounds — partial participation is the real-world outcome of unreliable connectivity."

---

## 7. Fan-Out Math

**What it is:** Fan-out is the ratio of subscribers to publishers. In PubNub, 1 publish to N subscribers = 1 + N transactions.

**How ArenaPlay uses it:** Question broadcast to 10K = 10,001 transactions. This is the defining performance characteristic of the system.

**What the Principal SA would ask:** "What's the fan-out transaction cost of broadcasting a question to 10,000 players, and what does PubNub's infrastructure do to make that happen in under 100ms?"

**Strong answer:** "10,001 transactions: 1 publish plus 10,000 deliveries. PubNub's global edge network — PoPs in dozens of regions — means subscribers connect to the edge node closest to them. When the host publishes, PubNub replicates the message across its edge network and delivers to each subscriber from their nearest node. The global average latency is ~30ms; nearby clients often sub-30ms. The 95th percentile is under 100ms even across regions. The host client never touches those 10,000 connections — PubNub's infrastructure handles all of it from a single publish call."

---

## 8. Signals vs. Messages

**What it is:** PubNub Signals are ephemeral, max 64 bytes, not persisted, and do not trigger Functions. Publishes are persisted (if enabled), up to 32KB, and DO trigger Functions.

**How ArenaPlay uses it:** Player heartbeats go as Signals (`{pid: "player-uuid-001"}` ≈ 30 bytes). Reactions are Publishes (they need to trigger the onAfter aggregator Function and be received by all subscribers). If reactions were Signals, Functions couldn't process them.

**What the Principal SA would ask:** "A developer on your team wants to use Signals for typing indicators in the chat. Good or bad idea?"

**Strong answer:** "Good idea — that's exactly what Signals are for. Typing indicators are ephemeral (nobody cares if a typing indicator is persisted), small (just {userId: 'x', typing: true} — well under 64 bytes), and high-frequency. Using Publish for typing indicators would create unnecessary history entries, trigger moderation Functions needlessly, and cost more per operation. The rule is: anything ephemeral, high-frequency, and under 64 bytes → Signal. Anything that needs to be delivered, persisted, or trigger Functions → Publish."

---

## 9. The Build vs. Buy Argument

**What it is:** Could you build ArenaPlay's real-time layer with raw WebSockets instead of PubNub?

**What the Principal SA would ask:** "Walk me through what you'd have to build yourself if you weren't using PubNub."

**Strong answer:** "To replace PubNub here, you'd need to build: a horizontally scalable WebSocket server with sticky sessions or a shared pub/sub backplane (Redis Pub/Sub or Kafka), a global edge network with regional PoPs for <100ms delivery worldwide, a connection management layer that handles reconnects, heartbeats, and presence, a message persistence layer with timetoken-based pagination, an edge compute runtime for pre-delivery validation (our Functions), and a cryptographic access control layer (our PAM).

The WebSocket server alone takes a week. Making it globally low-latency is months of infrastructure work. The total cost of the self-built infrastructure at 10K concurrent users easily exceeds $50K/year in engineering time alone, before any infrastructure cost. PubNub's total transaction cost for ArenaPlay is roughly $1.77 per 10K-player game session. For a commercial product, the build-vs-buy math is obvious."

---

## 10. GDPR and Data Considerations

**What the Principal SA would ask:** "A European player joins your game. Where does their message data go, and how long does it persist?"

**Strong answer:** "PubNub operates data centers globally, including in Europe. You can configure your keyset's data storage region — requiring all message persistence to stay in EU data centers satisfies GDPR data residency requirements. For ArenaPlay specifically: answer messages on `game.{gameId}.answers.inbound` are persisted for audit/replay. Under GDPR, a player can request deletion of their answers. PubNub's Message Delete API allows deletion by timetoken range on specific channels, giving you GDPR-compliant right-to-erasure at the message level. Reactions and player count channels are ephemeral (not persisted) — no GDPR concern. The display names stored in FastAPI's player registry are the main GDPR-relevant data store; that's a standard server-side deletion. The key architectural decision: don't store PII in channel names. `game.{gameId}.answers.{playerId}` with a UUID as playerId is fine — the UUID isn't PII until you can link it to a real person, and that mapping lives in FastAPI."

---

## 11. Illuminate Integration

**What it is:** PubNub Illuminate is a behavioral analytics engine. You stream events to it; it evaluates rules and can trigger actions (publish events, call webhooks) when behavioral thresholds are crossed.

**How ArenaPlay uses it:** The reaction aggregator publishes crowd energy scores to `game.{gameId}.crowd.energy`. An Illuminate rule fires BONUS_TRIGGERED when energy > 500 within 60 seconds. FastAPI receives this and broadcasts a bonus question.

**What the Principal SA would ask:** "What's the advantage of Illuminate over just having the backend check the threshold itself?"

**Strong answer:** "The backend COULD check the threshold in the reaction aggregator route — but then the threshold is hardcoded. If you want to change 'bonus triggers at 500 reactions' to 'bonus triggers at 300 reactions during the first 5 rounds but 500 in later rounds,' you'd need to redeploy. With Illuminate, the rule is a configuration change in the portal — no deployment. More importantly, Illuminate can evaluate multi-variate rules across multiple event streams simultaneously: 'trigger bonus if crowd energy > 300 AND answer velocity > 200/min AND at least 60% of players are active.' That kind of compound rule is difficult to evaluate in realtime in application code without significant infrastructure. Illuminate is the right tool for adaptive behavioral logic."

---

## The Three Things a Principal SA Would Flag in a Code Review

1. **Answer channel identity enforcement**: The MVP uses `game.{gameId}.answers.inbound` with shared write access. Any player can claim to be any other player by including a fake `playerId` in their message. The production fix is per-player answer channels with PAM regex. I documented this as a known gap — but in a code review, this would be a CRITICAL flag.

2. **Token refresh on disconnect + reconnect edge case**: If a player's connection drops for longer than their remaining token TTL, when they reconnect their token is expired. The client-side timer approach handles normal operation but not a 2-hour network outage. The fix: when `PNReconnectedCategory` fires, check token expiry before attempting catch-up. If expired, request a new token first.

3. **Functions KV Store key scope**: The answer validator uses `cap:${gameId}:${playerId}:${roundNumber}` as the KV key. At 10K players across many games, this accumulates many KV entries. The TTL of 3600s handles cleanup, but a burst of KV reads/writes against many keys could hit KV Store rate limits at very high scale. The production fix: use a dedicated KV namespace per game that's purged when the game ends.
