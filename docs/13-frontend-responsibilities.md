# 13 — Frontend Responsibilities

> What the React frontend owns, how it manages state, and where PubNub events drive UI transitions.

---

## Component Tree

```
App.jsx                       ← top-level state machine (join | host | player)
├── JoinScreen.jsx            ← landing page: create or join a game
├── HostDashboard.jsx         ← host control surface
│   ├── Leaderboard.jsx       ← sorted player rankings
│   ├── AnswerDistribution.jsx← A/B/C/D bar chart
│   ├── ChatPanel.jsx         ← read-only chat view
│   └── PlayerCount.jsx       ← live player count badge
└── PlayerGame.jsx            ← player experience
    ├── QuestionCard.jsx      ← question + answer tiles + countdown
    ├── Leaderboard.jsx       ← same component, highlights current player
    ├── ReactionStrip.jsx     ← emoji reaction buttons
    ├── ChatPanel.jsx         ← read-write chat
    └── PlayerCount.jsx       ← same badge
```

---

## App.jsx — State Machine

```
"join" ──create──► "host"
      └──join───► "player"
"host" ──leave───► "join"
"player" ──leave─► "join"
```

Each transition:
1. Creates a new PubNub client (`createPubNubClient(userId)`)
2. Calls `pubnub.setToken(token)` if PAM is enabled
3. Stores everything in `gameContext` (passed as prop to child)

On leave: `pubnub.unsubscribeAll()` + `pubnub.destroy()` before clearing state. This prevents orphaned subscriptions and listener leaks.

### UUID persistence

```javascript
export function getOrCreateUserId() {
  let id = localStorage.getItem('arenaPlayUserId');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('arenaPlayUserId', id); }
  return id;
}
```

Same userId across page refreshes = same PubNub identity = PAM token still valid. Changing browser or private browsing = new UUID (expected behaviour for a demo).

---

## usePubNubListener.js — Subscription Hook

```javascript
export function usePubNubListener(pubnubClient, channels, onMessage, onStatus) {
  const lastTimetokenRef = useRef(null);
  useEffect(() => {
    // ...addListener + subscribe
    return () => { removeListener; unsubscribe; };
  }, [pubnubClient, channels.join(',')]);
}
```

### Why `channels.join(',')` as dependency?

Arrays are compared by reference in React's dependency array. `useMemo(() => ch.playerChannels(...), [gameId, playerId])` creates a stable array identity but if that ever breaks, we'd get infinite subscribe loops. Using `channels.join(',')` compares the string representation, which only changes when the actual channel list changes.

### Catch-up on reconnect

```javascript
if (statusEvent.category === 'PNReconnectedCategory') {
  pubnubClient.fetchMessages({ channels, start: lastTt, count: 100 })
    .then(({ channels: chData }) => {
      const missed = Object.values(chData).flat();
      missed.sort((a, b) => a.timetoken > b.timetoken ? 1 : -1);
      missed.forEach(msg => onMessage(msg));
    });
}
```

`lastTimetokenRef` tracks the timetoken of the last received message. On reconnect, we fetch everything published after that point. This ensures a player who lost connection for 30 seconds doesn't miss a question or the reveal.

---

## HostDashboard.jsx — Event Handling

Subscribes to all 8 host channels via `useMemo(() => ch.hostChannels(gameId), [gameId])`.

### Phase state machine

```
lobby ──startAndBroadcast──► question
question ──revealAnswer────► reveal
reveal ──nextRound─────────► question   (if more rounds)
reveal ──endGame───────────► ended
```

State driven by:
1. **API calls** (button clicks → REST → update local state)
2. **PubNub events** (QUESTION_BROADCAST sets phase='question', ANSWER_REVEAL sets correctAnswer)

Both paths update state — API call is the primary path, PubNub event is the confirmation (and handles the case where another admin tab triggers an action).

### Live answer distribution

```javascript
case EventType.ANSWER_SUBMITTED: {
  const ans = msg.answer;
  if (ans && ['A','B','C','D'].includes(ans)) {
    setDistribution(prev => ({ ...prev, [ans]: (prev[ans] || 0) + 1 }));
  }
}
```

The host subscribes to `answers.inbound` and increments its local distribution counter per message. This gives a real-time bar chart effect as answers stream in.

On `ANSWER_REVEAL`, distribution is replaced by the backend's authoritative snapshot (which uses the actual `round_answers` dict, not the potentially duplicated stream count).

---

## PlayerGame.jsx — Event Handling

Subscribes to player channels via `useMemo(() => ch.playerChannels(gameId, playerId), [gameId, playerId])`.

### Answer submission — dual path

```javascript
// Path 1: PubNub publish (for live distribution on host side)
pubnub.publish({ channel: ch.answersInbound(gameId), message: {...} });

// Path 2: REST (for backend scoring)
fetch(`/api/games/${gameId}/answer`, { method: 'POST', body: {...} });
```

PubNub publish is fire-and-forget from the player's perspective. The REST call is also fire-and-forget (catch logged, not shown to user). If either fails:
- PubNub fails: host's distribution chart won't show this answer
- REST fails: player won't get score for this round

Both are acceptable degradation modes for a demo.

### Countdown timer

```javascript
timerRef.current = setInterval(() => {
  setTimeLeft(prev => {
    if (prev <= 1) { stopTimer(); return 0; }
    return prev - 1;
  });
}, 1000);
```

Client-side timer. Not synchronised with server time. Acceptable for a demo; production would need server-issued start timestamp and client-computed delta.

---

## useReactionBatcher.js — Batching

```javascript
// 500ms window: collect taps, publish once
batchRef.current[emoji] = (batchRef.current[emoji] || 0) + 1;
clearTimeout(timerRef.current);
timerRef.current = setTimeout(() => {
  pubnub.publish({ channel, message: { type: 'REACTION_BURST', reactions: [...] } });
  batchRef.current = {};
}, 500);
```

Without batching, rapid tapping (10 taps/sec × 1000 players) = 10,000 publishes/sec. With 500ms batching, each player emits at most 2 publishes/sec = 2,000 publishes/sec. At PubNub's transaction pricing, this is a 5x cost reduction.

---

## Channels.js — Frontend Channel Helpers

Mirrors `backend/channels.py` exactly. Any channel name change must be made in both files.

```javascript
export const ch = {
  questions:     (gameId) => `game.${gameId}.questions`,
  answersInbound:(gameId) => `game.${gameId}.answers.inbound`,
  // ...
  playerChannels: (gameId, playerId) => [...],
  hostChannels:   (gameId) => [...],
};
```

Both `playerChannels` and `hostChannels` return arrays (not computed lazily) to work correctly with `channels.join(',')` in the hook.

---

## Environment Variables (Vite)

```
VITE_PUBNUB_PUBLISH_KEY=pub-c-...
VITE_PUBNUB_SUBSCRIBE_KEY=sub-c-...
```

In `frontend/.env`. Vite bundles these into the JS at build time. They are visible to anyone with DevTools — this is expected and secure because:
- Publish key without a PAM token → blocked by PAM (if enabled)
- Subscribe key alone → can only receive messages, not publish
- `secretKey` is **never** in `.env` or the frontend
