# 12 — Backend Responsibilities

> What the FastAPI backend owns, why it exists, and how each component is designed.

---

## Why a Backend at All?

PubNub is the messaging layer, but you still need server-side logic for:

1. **Authority** — correct answers, scores, and game phase must live somewhere clients can't tamper with
2. **PAM token issuance** — `secret_key` can never be in the browser; the backend is the PAM server
3. **State aggregation** — `round_answers`, `game.players`, `leaderboard` need a single source of truth
4. **Orchestration** — the host's UI actions (`/start`, `/reveal`, `/next`) must be mediated, not broadcast directly

---

## Component Map

```
backend/
├── main.py          — FastAPI app, CORS, startup tasks
├── config.py        — Env var loading (PUBNUB_* keys)
├── models.py        — Pydantic models (request/response contracts)
├── game_store.py    — In-memory game state + business logic
├── pubnub_service.py — PubNub client, publish helper, PAM grants
└── routes/
    ├── games.py     — All game lifecycle endpoints
    └── tokens.py    — PAM token refresh endpoint
```

---

## game_store.py

The **single source of truth**. No database — all state lives in `_games: dict[str, GameState]`.

### Design choices

| Choice | Rationale |
|--------|-----------|
| In-memory dict | Demo scope. All state fits in RAM. Fast O(1) lookup. |
| Pydantic GameState | Schema enforcement; `.model_dump()` for JSON serialisation. |
| `current_round = -1` | First `advance_round()` increments to 0 (index of first question). Explicit sentinel avoids off-by-one confusion. |
| `record_answer` idempotency | Returns False on duplicate — defence in depth against double-submit even if the Function cap fails. |
| Speed bonus by insertion order | Python dicts preserve insertion order (3.7+). First correct answer in `round_answers` = fastest answerer. |

### Scoring formula

```python
def speed_bonus(position: int) -> int:
    return max(0, 50 - position * 5)
```

- Correct + first: 100 + 50 = **150 pts**
- Correct + second: 100 + 45 = **145 pts**
- Correct + 10th or later: 100 + 0 = **100 pts**
- Wrong: **0 pts**

---

## pubnub_service.py

Wraps the synchronous PubNub Python SDK for use in an async FastAPI application.

### Thread pool pattern

```python
loop = asyncio.get_running_loop()
result = await loop.run_in_executor(None, lambda: pubnub.publish()...sync())
```

`run_in_executor(None, ...)` uses the default ThreadPoolExecutor. The synchronous SDK call runs in a worker thread without blocking the event loop.

### PAM token grants

**Host token** (TTL=240 min):
- Channels: all 8 game channels with appropriate r/w permissions
- `authorized_uuid = host_id` — only this UUID can use the token

**Player token** (TTL=120 min):
- Channels: read on most, write only on `answers.inbound`, `reactions`, `chat`, `player.{id}.notifications`
- `authorized_uuid = player_id`

**Graceful degradation**: both grant functions catch exceptions and return `""`. The frontend can still function without a token if PAM is not enabled on the keyset (useful for local dev with a non-PAM keyset).

---

## routes/games.py

Eight REST endpoints that are the host's control surface.

### Answer security

`_sanitise_game_state()` strips the `correct` field from every question before sending game state to any client:

```python
data["questions"] = [
    {k: v for k, v in q.items() if k != "correct"}
    for q in data["questions"]
]
```

This applies to all responses — game state after create, join, and get. The correct answer only ever leaves the server in `ANSWER_REVEAL` (after the round has closed).

### Distribution snapshot timing

In `/reveal`:
```python
distribution = _answer_distribution(game.round_answers)   # snapshot FIRST
score_results = calculate_and_apply_scores(game_id)       # clears round_answers
```

`calculate_and_apply_scores` clears `round_answers` as a side effect. Snapshotting first prevents an empty distribution bar chart.

### Answer recording endpoint

`POST /{gameId}/answer` is called by the player frontend alongside their PubNub publish:

```python
ok = record_answer(game_id, req.player_id, req.answer)
return {"recorded": ok}
```

Returns `{"recorded": False}` for:
- Game not in QUESTION phase (too late)
- Wrong `round_number` (stale answer from previous round)
- Duplicate answer (player already answered)

No 4xx error on these — graceful silent discard.

---

## main.py

### Background task: player count publisher

```python
async def player_count_publisher():
    while True:
        await asyncio.sleep(5)
        for game in all_active_games():
            if game.phase != GamePhase.ENDED:
                await publish(channels.player_count(game.game_id), {
                    "type": "PLAYER_COUNT_UPDATE",
                    "count": len(game.players),
                })
```

Runs in a background `asyncio.Task` (not a thread). Publishes every 5 seconds per active game. This is the **counter pattern** — an alternative to PubNub native Presence that avoids subscription storm costs at scale.

### CORS

Configured to allow the frontend at `localhost:9001` (and `5173`, `3000` for dev flexibility). In production, restrict to exact domains.

---

## What the Backend Does NOT Do

| Item | Handled Where |
|------|--------------|
| Subscribe to PubNub | Not needed — state is mutated via REST calls |
| Persist to database | In-memory only (demo scope) |
| Schedule question timers | Client-side `setInterval` in PlayerGame.jsx |
| Enforce answer time windows | Function KV cap is the defence; backend checks phase |
| Chat moderation | PubNub Function (onBefore) — never reaches backend |
| Reaction aggregation | PubNub Function (onAfter) — never reaches backend |
