# 14 — Implementation Status

Last updated: 2026-04-02

---

## Feature Checklist

### Backend (FastAPI + PubNub Python SDK)

| Feature | Status | File |
|---------|--------|------|
| Game creation endpoint | ✅ Complete | `routes/games.py` |
| Player join endpoint | ✅ Complete | `routes/games.py` |
| Start game + broadcast GAME_STARTED | ✅ Complete | `routes/games.py` |
| Broadcast question to players | ✅ Complete | `routes/games.py` |
| Reveal answer + calculate scores | ✅ Complete | `routes/games.py` |
| Advance to next round | ✅ Complete | `routes/games.py` |
| End game + final leaderboard | ✅ Complete | `routes/games.py` |
| PAM host token grant | ✅ Complete | `pubnub_service.py` |
| PAM player token grant | ✅ Complete | `pubnub_service.py` |
| Token refresh endpoint | ✅ Complete | `routes/tokens.py` |
| Player count background task (counter pattern) | ✅ Complete | `main.py` |
| Score calculation with speed bonus | ✅ Complete | `game_store.py` |
| Answer sanitisation (strip correct from API response) | ✅ Complete | `routes/games.py` |

### PubNub Functions

| Function | Status | File |
|----------|--------|------|
| Answer Validator (onBefore) | ✅ Complete | `functions/answer-validator.js` |
| Reaction Aggregator (onAfter) | ✅ Complete | `functions/reaction-aggregator.js` |
| Chat Moderator (onBefore) | ✅ Complete | `functions/chat-moderator.js` |
| Score Calculator (onRequest) | ✅ Complete | `functions/score-calculator.js` |
| **Functions deployed to PubNub** | ⏳ Manual step | Admin Portal → Functions |

### Frontend (React + PubNub JS SDK)

| Feature | Status | File |
|---------|--------|------|
| Join screen (player + host) | ✅ Complete | `components/JoinScreen.jsx` |
| Host dashboard | ✅ Complete | `components/HostDashboard.jsx` |
| Player game view | ✅ Complete | `components/PlayerGame.jsx` |
| Question card with A/B/C/D tiles | ✅ Complete | `components/QuestionCard.jsx` |
| Answer distribution bar chart | ✅ Complete | `components/AnswerDistribution.jsx` |
| Animated leaderboard | ✅ Complete | `components/Leaderboard.jsx` |
| Emoji reactions + batching | ✅ Complete | `components/ReactionStrip.jsx` + `hooks/useReactionBatcher.js` |
| Chat panel | ✅ Complete | `components/ChatPanel.jsx` |
| Player count badge | ✅ Complete | `components/PlayerCount.jsx` |
| PubNub subscription + reconnect hook | ✅ Complete | `hooks/usePubNubListener.js` |
| UUID persistence (localStorage) | ✅ Complete | `pubnubClient.js` |
| PAM token set on client | ✅ Complete | `App.jsx` |
| Dark game-show CSS theme | ✅ Complete | `styles/index.css` |
| Vite proxy to backend | ✅ Complete | `vite.config.js` |

### Documentation

| Document | Status |
|----------|--------|
| 00 Home | ✅ |
| 03 System Architecture | ✅ |
| 05 Channel Taxonomy | ✅ |
| 07 Auth Strategy | ✅ |
| 08 Presence Strategy | ✅ |
| 09 Persistence & Catch-up | ✅ |
| 10 Functions Design | ✅ |
| 11 Scaling Analysis | ✅ |
| 15 QA Strategy | ✅ |
| 17 Observability | ✅ |
| 18 Anti-Patterns | ✅ |
| 19 Interview Prep | ✅ |
| 20 Decision Log | ✅ |
| 21 Open Questions | ✅ |

### Bug Fixes Applied (2026-04-02)

| Fix | File |
|-----|------|
| `Question.options` changed from `dict` to `list` — matches frontend array rendering | `models.py` |
| Added `AnswerRequest` model + `POST /{id}/answer` endpoint — backend now records player answers | `models.py`, `routes/games.py` |
| `asyncio.get_event_loop()` → `get_running_loop()` — Python 3.10+ correctness | `pubnub_service.py` |
| `calculate_and_apply_scores` guards against unregistered player IDs | `game_store.py` |
| JoinScreen field names, response fields, and SAMPLE_QUESTIONS format all fixed | `JoinScreen.jsx` |
| App.jsx passes `userId` to JoinScreen, includes `joinCode`/`questions` in gameContext | `App.jsx` |
| HostDashboard: uses initial questions, added `correctAnswer` state, shows join code | `HostDashboard.jsx` |
| PlayerGame: submits answer to both PubNub and REST endpoint | `PlayerGame.jsx` |

### Pending

| Item | Blocker |
|------|---------|
| Verify PAM enabled on keyset | Manual check in Admin Portal |
| Deploy Functions to PubNub | Manual step in Admin Portal → Functions |
