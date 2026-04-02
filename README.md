# ArenaPlay

> Real-time multiplayer trivia game show platform — built entirely on PubNub.

A live game show engine where a host broadcasts questions to thousands of simultaneous players. Players answer in real time, compete on a leaderboard, react with emojis, and chat — all synchronized to the same broadcast moment.

Built as a working demo and SA knowledge project for a PubNub Principal SA interview.

---

## Architecture in One Sentence

The host publishes one question; PubNub fans it out to 10,000 players in under 100ms. Players publish answers to a channel where a PubNub Function validates them before delivery. FastAPI aggregates scores and publishes leaderboard updates back through PubNub.

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node 18+
- PubNub account (free tier works)
- `.env` at `/Users/adi/PycharmProjects/PubNubProjects/.env` (already configured)

### Backend
```bash
cd arenaplay/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd arenaplay/frontend
npm install
npm run dev
# → http://localhost:5173
```

### Demo flow
1. Open `http://localhost:5173` → **Create a game** (host view opens)
2. Note the 6-character join code
3. Open a second tab/window → **Join with the code** (player view)
4. Host: click "Start Game" → "Broadcast Question"
5. Player: tap an answer tile
6. Host: click "Reveal Answer" → see live distribution + updated leaderboard
7. Host: click "Next Round" or "End Game"

---

## Project Structure

```
arenaplay/
├── backend/           FastAPI + PubNub Python SDK
│   ├── channels.py    Channel name helpers (source of truth)
│   ├── config.py      Env var loading
│   ├── game_store.py  In-memory game state
│   ├── pubnub_service.py  PubNub client + PAM token grants
│   ├── models.py      Pydantic models
│   ├── main.py        FastAPI app + player count background task
│   └── routes/        HTTP endpoints
│       ├── games.py   Game lifecycle (create/join/start/question/reveal/end)
│       └── tokens.py  PAM token refresh
├── frontend/          React + Vite + PubNub JS SDK
│   └── src/
│       ├── channels.js    Channel name helpers (JS mirror of backend)
│       ├── pubnubClient.js
│       ├── hooks/
│       │   ├── usePubNubListener.js   Subscribe + reconnect catch-up
│       │   └── useReactionBatcher.js  500ms emoji batch window
│       └── components/    JoinScreen, HostDashboard, PlayerGame, etc.
├── functions/         PubNub Functions (deploy manually to Admin Portal)
│   ├── answer-validator.js    onBefore: validate + frequency cap
│   ├── reaction-aggregator.js onAfter: crowd energy score
│   ├── chat-moderator.js      onBefore: banned word list
│   └── score-calculator.js    onRequest: score computation
└── docs/              Architecture documentation (ELI5 → production depth)
    ├── 19-interview-prep.md   ← READ THIS BEFORE THE INTERVIEW
    ├── 03-system-architecture.md
    ├── 05-channel-taxonomy.md
    └── ...
```

---

## Key PubNub Features Demonstrated

| Feature | Where |
|---------|-------|
| Pub/Sub fan-out at scale | Question broadcast → 10K simultaneous deliveries |
| PAM v3 token grants | Host/player tokens with scoped channel permissions |
| Message Persistence + catch-up | Reconnect flow using timetoken cursor |
| PubNub Functions (onBefore) | Answer validation + chat moderation at the edge |
| PubNub Functions (onAfter) | Reaction aggregation — async, non-blocking |
| PubNub Functions (onRequest) | Score calculation REST endpoint |
| Signals | Player heartbeats (ephemeral, 64 bytes max) |
| Counter pattern (presence alternative) | Player count without native presence storm |
| Client-side batching | Reaction bursts — 500ms window before publish |

---

## Deploy Functions

Deploy these manually in [PubNub Admin Portal](https://admin.pubnub.com) → Functions:

| File | Trigger | Channel |
|------|---------|---------|
| `functions/answer-validator.js` | Before Publish | `game.*.answers.inbound` |
| `functions/reaction-aggregator.js` | After Publish | `game.*.reactions` |
| `functions/chat-moderator.js` | Before Publish | `game.*.chat` |
| `functions/score-calculator.js` | On Request | (POST endpoint) |

After deploying `chat-moderator`, add to its KV Store:
- Key: `banned_words`
- Value: `["spam","badword1","badword2"]`

---

## Documentation

See `docs/` for 20+ architecture documents ranging from ELI5 explanations to production-scale analysis.

Start with:
- [`docs/19-interview-prep.md`](docs/19-interview-prep.md) — interview briefing with Q&A
- [`docs/03-system-architecture.md`](docs/03-system-architecture.md) — system diagrams
- [`docs/05-channel-taxonomy.md`](docs/05-channel-taxonomy.md) — every channel explained
