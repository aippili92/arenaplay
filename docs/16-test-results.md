# 16 — Test Results

Last updated: 2026-04-02

---

## Backend Integration Tests (Manual + curl)

All tests run against `http://localhost:9000` with the backend started via `uvicorn backend.main:app --port 9000`.

### Health Check
```
GET /health → 200 {"status": "ok", "service": "arenaplay-backend"}
```
✅ PASS

### Create Game
```
POST /api/games/ {host_id, host_display_name, questions: [{question_id, text, options[], correct, time_limit}]}
→ 200 {gameId, joinCode, hostToken (PAM base64), gameState}
```
✅ PASS — PAM token issued, `correct` field stripped from returned questions, `join_code` is 6-char uppercase alphanumeric

### Join Game (by join code)
```
POST /api/games/{joinCode}/join {join_code, display_name, player_id}
→ 200 {playerId, playerToken (PAM base64), ttl: 120, gameState}
```
✅ PASS — backend resolves join code via `get_game_by_code()` fallback, player added to game.players

### Start Game
```
POST /api/games/{gameId}/start
→ 200 {ok: true, phase: "question", firstQuestion: {...}}
```
✅ PASS — `current_round` advances from -1 to 0, phase changes to QUESTION

### Broadcast Question
```
POST /api/games/{gameId}/question
→ 200 {type: "QUESTION_BROADCAST", roundNumber: 0, options: [...array...], ...}
```
✅ PASS — published to PubNub `game.*.questions` channel, options returned as array (not dict)

### Submit Answer
```
POST /api/games/{gameId}/answer {player_id, answer: "B", round_number: 0}
→ 200 {recorded: true}
```
✅ PASS — duplicate returns `{recorded: false}`, wrong round returns `{recorded: false}`

### Reveal Answer + Scoring
```
POST /api/games/{gameId}/reveal
→ 200 [{playerId, displayName, score, rank, delta}]
```
✅ PASS — first correct answerer gets 150 pts (100 + 50 speed bonus), wrong answer gets 0, leaderboard sorted

### End Game
```
POST /api/games/{gameId}/end
→ 200 {ok: true, finalLeaderboard: [...], winnerId: "..."}
```
✅ PASS — GAME_ENDED published to `host.control` channel

---

## Backend Unit Tests (Python)

Tests run via `python3 -c "..."` against the game_store module directly.

### record_answer idempotency
- First answer recorded: ✅ True
- Duplicate answer: ✅ False (no second record)

### calculate_and_apply_scores
- First correct answerer: ✅ 150 pts (100 + 50 speed bonus)
- Second correct answerer: ✅ 145 pts (100 + 45 speed bonus)
- Wrong answer: ✅ 0 pts
- Unregistered player ID: ✅ skipped (guard added)

### advance_round
- First call on new game (current_round=-1): ✅ returns questions[0], sets current_round=0
- After all questions exhausted: ✅ returns None, sets phase=ENDED

### _sanitise_game_state
- Returns game state with `correct` key absent from all questions: ✅
- `current_question` also sanitised: ✅

---

## Frontend Build Verification

```
npm run build → vite build
✓ 46 modules transformed.
dist/index.html                   0.68 kB │ gzip:   0.38 kB
dist/assets/index-*.css          16.31 kB │ gzip:   3.61 kB
dist/assets/index-*.js          419.36 kB │ gzip: 109.11 kB
✓ built in 584ms
```
✅ PASS — zero TypeScript errors, zero build warnings

---

## Known Issues / Limitations

| Issue | Impact | Notes |
|-------|--------|-------|
| PAM must be enabled on keyset | Players can subscribe without a valid token if PAM off | Enable Access Manager in Admin Portal |
| In-memory state lost on restart | All games gone if uvicorn restarts | Expected for demo; prod would use Redis/Postgres |
| Client-side countdown not sync'd to server | Timer drift across devices | Acceptable for demo; prod: server-issued start timestamp |
| PubNub Functions not deployed | answer-validator, reaction-aggregator, chat-moderator, score-calculator all offline | Manual deploy via Admin Portal → Functions |
| No game expiry | Abandoned games stay in memory forever | Add TTL cleanup for production |

---

## Smoke Test Procedure

1. `cd arenaplay && ./start.sh`
2. Open `http://localhost:9001` → click **Create Game** (use sample questions, any host name)
3. Note the 6-character join code shown in the header
4. Open a second tab → enter the join code and a player name → **Join Game**
5. Tab 1 (host): click **Start Game →** → question appears on both tabs
6. Tab 2 (player): click an answer tile
7. Tab 1 (host): click **Reveal Answer** → correct tile highlights, bar chart shows distribution, leaderboard updates
8. Tab 1 (host): click **Next Round →** → new question appears
9. After all questions: click **End Game** → final leaderboard shown on both tabs

Expected: all 9 steps complete without errors in the browser console.
