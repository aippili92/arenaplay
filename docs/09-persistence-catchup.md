# 09 — Persistence & Catch-up Strategy

---

## ELI5 Version

PubNub can remember the last N messages on a channel — like a DVR for your game. If you miss something because your wifi dropped, you can rewind and catch up. But only if you enabled "recording" on that channel. And the DVR remote (your timetoken) tells you exactly where you left off.

---

## Which Channels Store History and Why

| Channel | Persist? | Reason | Retention |
|---------|---------|--------|-----------|
| `game.{id}.questions` | **YES** | Reconnecting player must see current question | 24h |
| `game.{id}.answers.inbound` | **YES** | Audit log for score disputes and fraud detection | 72h |
| `game.{id}.leaderboard` | **YES** | Player reconnects and sees current standings | 24h |
| `game.{id}.chat` | **YES** | Chat scroll history — players expect this | 48h |
| `game.{id}.host.control` | **YES** | Reconnecting player needs current game phase (started? reveal? ended?) | 24h |
| `player.{pid}.notifications` | **YES** | Player may have been offline when bonus points were awarded | 24h |
| `game.{id}.reactions` | **NO** | Stale emoji bursts add no value — nobody cares about reactions from 10 minutes ago |
| `game.{id}.crowd.energy` | **NO** | Historical energy scores are irrelevant |
| `game.{id}.player.count` | **NO** | Always current; counter pattern makes history useless |

**How to enable:** In PubNub Admin Portal → Keysets → Message Persistence → enable, then set default retention. Individual channel retention can be set via API.

---

## The Timetoken as a Cursor

Every PubNub message has a **timetoken** — a 17-digit integer representing time in 100-nanosecond intervals since PubNub's epoch. It's:
- Unique per message (no two messages on the same channel share a timetoken)
- Ordered (higher timetoken = later in time)
- Used as a cursor for history pagination

```
Timeline: ───────────────────────────────────────────────────────▶
Messages: [Q1][Q2][A1][Reveal1][Score1]...[dropout]...[Q3][Score3]
Timetokens: 17149000 17149100 17149200 17149300 17149400     17149800 17150000
                                                   ↑ lastSeenTimetoken
```

On reconnect: `fetchMessages({start: lastSeenTimetoken})` returns everything after the cursor — no duplicates, no gaps.

---

## The Reconnect Flow — Step by Step

```
1. Player's network drops during round 4.
   - SDK fires status event: PNDisconnectedCategory
   - Player's last seen timetoken stored in React ref: 17149400000000000

2. Network recovers.
   - SDK automatically reconnects (PNReconnectedCategory fires)
   - usePubNubListener hook handles this event

3. Catch-up fetch:
   pubnubClient.fetchMessages({
     channels: [questions, leaderboard, hostControl],
     start: '17149400000000000',
     count: 100
   })
   Returns: QUESTION_BROADCAST for round 5, ANSWER_REVEAL for round 4, SCORES_UPDATED

4. Messages are sorted by timetoken and replayed:
   - Round 4 reveal: player sees correct answer, score update for round 4
   - Round 5 question: player sees current active question

5. HTTP catch-up:
   fetch('/api/games/{gameId}')
   Returns: {phase: 'question', currentRound: 5, currentQuestion: {...}, players: {...}}

6. UI reconciles: shows round 5 question with 30-second timer already counting down.
   (Timer is client-side — it restarts from the broadcastAt timestamp in the message)

7. Player answers round 5 normally.
```

**Edge cases:**
- Player missed the answer reveal AND the next question: `fetchMessages` returns both. UI replays the reveal first, then transitions to the new question.
- Player was offline for the entire game: `fetchMessages` returns the full game history. UI fast-forwards to GAME_ENDED state.
- Player's token expired during disconnect: before the catch-up, the client checks token TTL and refreshes first.

---

## Pagination for Long Sessions

`fetchMessages` returns a maximum of 100 messages per call (configurable up to 100). For a 10-round game, history is short. For long sessions, paginate:

```javascript
async function fetchAllMissed(pubnub, channels, startTimetoken) {
  let start = startTimetoken;
  let allMessages = [];

  while (true) {
    const { channels: data } = await pubnub.fetchMessages({ channels, start, count: 100 });
    const batch = Object.values(data).flat();
    if (batch.length === 0) break;

    batch.sort((a, b) => (a.timetoken > b.timetoken ? 1 : -1));
    allMessages = [...allMessages, ...batch];

    // If we got a full page, there may be more — advance cursor
    if (batch.length < 100) break;
    start = batch[batch.length - 1].timetoken;
  }

  return allMessages;
}
```

ArenaPlay's MVP uses `count: 100` (sufficient for a 10-round game). Production sessions with more activity would use paginated fetch.

---

## What Happens When Message Persistence Is Disabled

If you deploy ArenaPlay to a keyset without Message Persistence enabled:
- `fetchMessages` returns empty results
- Players who disconnect and reconnect see the current live state (from HTTP GET `/api/games/{id}`) but miss any messages that arrived during their outage
- Reconnecting mid-question: player sees the current question (from HTTP) but not the context of what happened before
- This is graceful degradation — the app still works, catch-up is just incomplete

For a demo: enable Message Persistence on the keyset. It's a checkbox in Admin Portal → Keysets.
