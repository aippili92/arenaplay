# 04 — PubNub Integration

> How ArenaPlay uses the PubNub platform — SDK patterns, message contracts, and the subscriber/publisher split between backend and frontend.

---

## Integration Model

```
                    PubNub Network
                 ┌─────────────────┐
Backend (Python) │                 │  Frontend (React)
   Publisher     │  Fan-out relay  │   Subscriber
   PAM server    │  <100ms SLA     │   Publisher (answers, chat)
                 └─────────────────┘
```

The backend is the **authority** — it publishes game events and grants tokens.
The frontend is the **real-time nerve** — it subscribes and publishes answers/reactions directly.

---

## Backend: PubNub Python SDK

**File**: `backend/pubnub_service.py`

```python
config = PNConfiguration()
config.publish_key = settings.PUBNUB_PUBLISH_KEY
config.subscribe_key = settings.PUBNUB_SUBSCRIBE_KEY
config.secret_key = settings.PUBNUB_SECRET_KEY   # server-side only
config.user_id = "arenaplay-backend-server"
config.ssl = True
pubnub = PubNub(config)
```

### Async publish wrapper

The Python SDK is synchronous. To avoid blocking FastAPI's event loop we run it in a thread pool:

```python
async def publish(channel: str, message: dict) -> dict:
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        lambda: pubnub.publish().channel(channel).message(message).sync()
    )
    return {"timetoken": result.result.timetoken}
```

**Why `get_running_loop()` not `get_event_loop()`**: In Python 3.10+, `get_event_loop()` is deprecated inside coroutines. `get_running_loop()` returns the already-running loop without creating a new one, which is always the correct call inside an `async def`.

### PAM token grants

```python
async def grant_host_token(game_id, host_id):
    envelope = await loop.run_in_executor(
        None,
        lambda: pubnub.grant_token()
            .ttl(240)
            .authorized_uuid(host_id)
            .channels([...])
            .sync()
    )
    return envelope.result.token
```

`secret_key` is required for token grants. It never leaves the backend.

---

## Frontend: PubNub JS SDK

**File**: `frontend/src/pubnubClient.js`

```javascript
export function createPubNubClient(userId) {
  return new PubNub({
    publishKey: import.meta.env.VITE_PUBNUB_PUBLISH_KEY,
    subscribeKey: import.meta.env.VITE_PUBNUB_SUBSCRIBE_KEY,
    userId,
    // secretKey intentionally omitted
  });
}
```

`userId` is persisted in `localStorage` so the same identity survives page refresh.

### Setting a PAM token

```javascript
const pubnub = createPubNubClient(userId);
pubnub.setToken(tokenFromBackend);  // called in App.jsx after join/create
```

`setToken()` attaches the token to all subsequent publishes and subscribes. No reconnect needed.

### Subscription hook

**File**: `frontend/src/hooks/usePubNubListener.js`

```javascript
pubnubClient.addListener(listener);
pubnubClient.subscribe({ channels });
// cleanup:
return () => {
  pubnubClient.removeListener(listener);
  pubnubClient.unsubscribe({ channels });
};
```

Always clean up listeners on unmount — leaking listeners causes duplicate message delivery.

### Reconnect catch-up

```javascript
if (statusEvent.category === 'PNReconnectedCategory') {
  pubnubClient.fetchMessages({
    channels,
    start: lastTimetokenRef.current,  // last seen message
    count: 100,
  }).then(({ channels: chData }) => {
    const missed = Object.values(chData).flat();
    missed.sort((a, b) => a.timetoken > b.timetoken ? 1 : -1);
    missed.forEach(msg => onMessage(msg));
  });
}
```

Timetokens are 17-digit integers (10ths of microseconds). Sorting them as strings works because they're zero-padded to the same length.

---

## Message Contract

All messages use a `type` discriminator field. This is the same contract in both JS (`channels.js`) and Python (`models.py`).

| Type | Publisher | Channel | Payload |
|------|-----------|---------|---------|
| `GAME_STARTED` | Backend | `host.control` | `{gameId, totalRounds}` |
| `QUESTION_BROADCAST` | Backend | `questions` | `{questionId, text, options, timeLimit, roundNumber}` |
| `ANSWER_SUBMITTED` | Player frontend | `answers.inbound` | `{playerId, answer, roundNumber, submittedAt}` |
| `ANSWER_REVEAL` | Backend | `host.control` | `{correctAnswer, distribution, roundNumber}` |
| `SCORES_UPDATED` | Backend | `leaderboard` | `{leaderboard[], totalPlayers}` |
| `REACTION_BURST` | Player frontend | `reactions` | `{reactions: [{emoji, count}]}` |
| `CHAT_MESSAGE` | Player frontend | `chat` | `{displayName, text, sentAt}` |
| `CROWD_ENERGY_UPDATE` | Function | `crowd.energy` | `{energy}` |
| `PLAYER_COUNT_UPDATE` | Backend | `player.count` | `{count}` |
| `GAME_ENDED` | Backend | `host.control` | `{finalLeaderboard, winnerId}` |

**Why a `type` field?** Multiple event types share channels (e.g., `host.control` carries `GAME_STARTED`, `ANSWER_REVEAL`, `GAME_ENDED`). A discriminator lets subscribers switch on event type without inspecting channel name.

---

## Who Subscribes to What

### Host subscribes to:
- `game.{id}.questions` — receives own broadcasts (for PubNub timeline confirmation)
- `game.{id}.answers.inbound` — sees live answers streaming in (for distribution chart)
- `game.{id}.leaderboard` — receives its own SCORES_UPDATED
- `game.{id}.reactions`, `.chat`, `.crowd.energy`, `.host.control`, `.player.count`

### Player subscribes to:
- `game.{id}.questions` — receives QUESTION_BROADCAST
- `game.{id}.leaderboard` — receives SCORES_UPDATED with their delta
- `game.{id}.reactions`, `.chat`, `.crowd.energy`, `.host.control`, `.player.count`
- `player.{playerId}.notifications` — personalised events (future use)

### Backend subscribes to: nothing
The backend is **publish-only** (push model). Game state lives in memory (`game_store.py`). The REST API mutates state and publishes events — no subscription loop needed for the MVP.

> **Production note**: At scale you'd want the backend to subscribe to `answers.inbound` to validate and record answers server-side without relying on client HTTP calls. For MVP we use a dual-path: PubNub publish (for live distribution) + REST call (for scoring).

---

## Key SDK Behaviours to Know

| Behaviour | Detail |
|-----------|--------|
| Message ordering | PubNub delivers in publish order within a channel. Cross-channel ordering is not guaranteed. |
| Duplicate detection | No built-in dedup — the answer validator Function handles per-player frequency capping. |
| Message persistence | Enabled per keyset. Messages are stored and retrievable via `fetchMessages` for up to 30 days (free tier: 1 day). |
| Subscribe reconnect | SDK auto-reconnects. `PNReconnectedCategory` fires on success — hook into this for catch-up. |
| Signal vs Publish | Signals: ephemeral, 64B max, no persistence, no Functions trigger. Publish: persisted, 32KB max, Functions-enabled. |
