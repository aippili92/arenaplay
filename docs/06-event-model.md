# 06 — Event Model

> Every message ArenaPlay publishes, with exact payload shapes, the channel it travels on, and the timing within the game lifecycle.

---

## Game Lifecycle → Event Sequence

```
HOST ACTION              PUBNUB EVENT             PLAYER SEES
─────────────────────────────────────────────────────────────────
Create game              (none yet)               —

[Players join via code]  —                        Join lobby screen

POST /start  ────────►  GAME_STARTED             Phase: lobby (wait)
POST /question ──────►  QUESTION_BROADCAST       Timer starts, tiles appear

[Players tap an answer]  ANSWER_SUBMITTED ──────► Host: distribution animates
                         (via PubNub + REST)

POST /reveal  ───────►  ANSWER_REVEAL            Correct tile lights up
             │          SCORES_UPDATED ──────────► Leaderboard animates
             └──────────────────────────────────────────────────►

POST /next   ────────►  QUESTION_BROADCAST       Timer resets, new question

POST /end    ────────►  GAME_ENDED               Final leaderboard, game over
```

---

## Event Payloads

### `GAME_STARTED`
**Channel**: `game.{gameId}.host.control`
**Publisher**: Backend (POST /start)

```json
{
  "type": "GAME_STARTED",
  "gameId": "abc-123",
  "totalRounds": 5
}
```

### `QUESTION_BROADCAST`
**Channel**: `game.{gameId}.questions`
**Publisher**: Backend (POST /question or POST /next)

```json
{
  "type": "QUESTION_BROADCAST",
  "gameId": "abc-123",
  "roundNumber": 0,
  "questionId": "q1",
  "text": "What does PubNub use?",
  "options": ["REST", "Pub/Sub", "SOAP", "RPC"],
  "timeLimit": 30
}
```

**Note**: `correct` is intentionally omitted. The answer is only revealed by the host via `ANSWER_REVEAL`.

`options` is a positional array: index 0=A, 1=B, 2=C, 3=D.

### `ANSWER_SUBMITTED`
**Channel**: `game.{gameId}.answers.inbound`
**Publisher**: Player frontend (direct publish)

```json
{
  "type": "ANSWER_SUBMITTED",
  "gameId": "abc-123",
  "playerId": "uuid-player",
  "displayName": "Bob",
  "questionId": "q1",
  "roundNumber": 0,
  "answer": "B",
  "submittedAt": 1712000000000
}
```

This message travels through the **answer-validator Function** (onBefore) which:
1. Checks `cap:{gameId}:{playerId}:{roundNumber}` in KV — aborts if set (duplicate)
2. Sets the cap key with TTL=1h
3. Allows the message through

Separately, the player also calls `POST /api/games/{id}/answer` so the backend records the answer for scoring.

### `ANSWER_REVEAL`
**Channel**: `game.{gameId}.host.control`
**Publisher**: Backend (POST /reveal)

```json
{
  "type": "ANSWER_REVEAL",
  "gameId": "abc-123",
  "roundNumber": 0,
  "questionId": "q1",
  "correctAnswer": "B",
  "distribution": {
    "A": 3,
    "B": 18,
    "C": 2,
    "D": 1
  }
}
```

`distribution` is snapshotted **before** `calculate_and_apply_scores()` clears `round_answers`. This is the bar chart the host sees.

### `SCORES_UPDATED`
**Channel**: `game.{gameId}.leaderboard`
**Publisher**: Backend (POST /reveal)

```json
{
  "type": "SCORES_UPDATED",
  "gameId": "abc-123",
  "roundNumber": 0,
  "leaderboard": [
    { "playerId": "uuid-1", "displayName": "Bob", "score": 150, "rank": 1, "delta": 150 },
    { "playerId": "uuid-2", "displayName": "Carol", "score": 0, "rank": 2, "delta": 0 }
  ],
  "totalPlayers": 24
}
```

`delta` is the points earned **this round**. The player view displays a score popup (`+150 pts`).

### `REACTION_BURST`
**Channel**: `game.{gameId}.reactions`
**Publisher**: Player frontend (batched, 500ms window)

```json
{
  "type": "REACTION_BURST",
  "gameId": "abc-123",
  "playerId": "uuid-player",
  "reactions": [
    { "emoji": "🔥", "count": 3 },
    { "emoji": "😂", "count": 1 }
  ]
}
```

The **reaction-aggregator Function** (onAfter) atomically increments `energy:{gameId}` in KV and publishes a `CROWD_ENERGY_UPDATE` event every 50 cumulative reactions.

### `CROWD_ENERGY_UPDATE`
**Channel**: `game.{gameId}.crowd.energy`
**Publisher**: PubNub Function (reaction-aggregator)

```json
{
  "type": "CROWD_ENERGY_UPDATE",
  "gameId": "abc-123",
  "energy": 150,
  "milestone": "🔥 150 reactions!"
}
```

### `CHAT_MESSAGE`
**Channel**: `game.{gameId}.chat`
**Publisher**: Player frontend

```json
{
  "type": "CHAT_MESSAGE",
  "gameId": "abc-123",
  "playerId": "uuid-player",
  "displayName": "Bob",
  "text": "This is so fun!",
  "sentAt": 1712000000000
}
```

Passes through **chat-moderator Function** (onBefore). If text contains banned words from KV, the message is aborted and replaced with `[message removed]`.

### `PLAYER_COUNT_UPDATE`
**Channel**: `game.{gameId}.player.count`
**Publisher**: Backend background task (every 5 seconds)

```json
{
  "type": "PLAYER_COUNT_UPDATE",
  "gameId": "abc-123",
  "count": 247
}
```

Uses the **counter pattern** — publishes current `len(game.players)` on a fixed interval. Avoids native Presence which would generate 1,650x more transactions at 10K players.

### `GAME_ENDED`
**Channel**: `game.{gameId}.host.control`
**Publisher**: Backend (POST /end)

```json
{
  "type": "GAME_ENDED",
  "gameId": "abc-123",
  "finalLeaderboard": [
    { "playerId": "uuid-1", "displayName": "Bob", "score": 450, "rank": 1 }
  ],
  "winnerId": "uuid-1"
}
```

---

## Event Routing Summary

| Channel | Events |
|---------|--------|
| `game.{id}.host.control` | `GAME_STARTED`, `ANSWER_REVEAL`, `GAME_ENDED` |
| `game.{id}.questions` | `QUESTION_BROADCAST` |
| `game.{id}.answers.inbound` | `ANSWER_SUBMITTED` |
| `game.{id}.leaderboard` | `SCORES_UPDATED` |
| `game.{id}.reactions` | `REACTION_BURST` |
| `game.{id}.crowd.energy` | `CROWD_ENERGY_UPDATE` |
| `game.{id}.chat` | `CHAT_MESSAGE` |
| `game.{id}.player.count` | `PLAYER_COUNT_UPDATE` |
| `player.{id}.notifications` | (reserved for future personalised events) |

---

## Timing Guarantees

- **Fan-out latency**: PubNub SLA is <100ms median, <300ms p99 globally
- **Ordering within a channel**: Guaranteed — timetokens are monotonically increasing
- **Cross-channel ordering**: Not guaranteed — `ANSWER_REVEAL` and `SCORES_UPDATED` are published in sequence but arrive on different channels. Players handle both in the same React update cycle.
- **At-most-once delivery**: PubNub does not guarantee deduplication. The answer-validator KV cap handles duplicate answers.
