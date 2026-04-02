# 05 — Channel Taxonomy

---

## ELI5 Version

Think of channels like TV stations. Station 1 is where the host broadcasts questions (everyone can watch, only the host can broadcast). Station 2 is where players call in with their answers (only the player can call in on their own line). Station 3 is the live leaderboard (everyone watches, only the scoreboard operator updates it). And so on.

Each station has a clear job. If everything were on one station, chaos. Separate channels give you clean separation of responsibilities, independent permissions, and targeted persistence.

---

## Naming Convention

```
game.{gameId}.{purpose}        ← game-scoped channels
player.{playerId}.{purpose}    ← player-scoped channels
illuminate.{gameId}.{purpose}  ← analytics channels
```

Dot-separated hierarchy enables:
1. Future wildcard subscribe: `game.abc123.*` subscribes to all channels for a game
2. PAM regex matching: `game\.abc123\..*` grants permissions across all game channels in one pattern
3. Human readability: the channel name tells you exactly who publishes and what it carries

---

## Complete Channel Reference

### `game.{gameId}.questions`
| Field | Value |
|-------|-------|
| **Publisher** | FastAPI backend (Python SDK) — after host triggers via HTTP API |
| **Subscribers** | All players (JS SDK), host client (JS SDK) |
| **Message frequency** | 1 per round × ~10 rounds = ~10 messages/session |
| **Persistence** | **YES** — players reconnecting need to see the current question |
| **Native presence** | NO |
| **PAM — Host** | read + write |
| **PAM — Player** | read only |
| **PAM — Backend** | write (full access) |

Why persistence: A player who drops and reconnects mid-round needs to see the current question. `fetchMessages({start: lastSeenTimetoken})` retrieves it.

---

### `game.{gameId}.answers.inbound`
| Field | Value |
|-------|-------|
| **Publisher** | Each player (JS SDK) |
| **Subscribers** | FastAPI backend (Python SDK), Functions onBefore |
| **Message frequency** | Up to 10,000 per round (one per player) |
| **Persistence** | **YES** — audit log, score replay, fraud detection |
| **Native presence** | NO |
| **PAM — Host** | read |
| **PAM — Player** | write only (all players share this channel in MVP) |
| **PAM — Backend** | read |

**Production upgrade:** Replace with `game.{gameId}.answers.{playerId}` per-player channels. Each player token grants write ONLY on their own answer channel — enforcing identity at the network layer. Backend subscribes via 5 channel groups of 2,000 each.

---

### `game.{gameId}.leaderboard`
| Field | Value |
|-------|-------|
| **Publisher** | FastAPI backend (Python SDK) |
| **Subscribers** | All players, host |
| **Message frequency** | 1–2 per round (after scoring) |
| **Persistence** | **YES** — players catch up to current standings on reconnect |
| **Native presence** | NO |
| **PAM — Host** | read |
| **PAM — Player** | read only |
| **PAM — Backend** | write |

---

### `game.{gameId}.reactions`
| Field | Value |
|-------|-------|
| **Publisher** | Players (JS SDK) — **client-side 500ms batch window** |
| **Subscribers** | All players (visual feedback), backend (via Functions onAfter aggregator) |
| **Message frequency** | ~667 batched publishes/round (from 3,333 raw taps) |
| **Persistence** | **NO** — ephemeral. Stale emoji bursts have zero value. |
| **Native presence** | NO |
| **PAM — Host** | read |
| **PAM — Player** | read + write |
| **PAM — Backend** | read |

The 500ms batch window is enforced client-side: the `useReactionBatcher` hook collects all taps within a 500ms window and publishes a single `REACTION_BURST` message with emoji counts. This reduces transactions ~5x.

---

### `game.{gameId}.chat`
| Field | Value |
|-------|-------|
| **Publisher** | Players (JS SDK), host (JS SDK) |
| **Subscribers** | All players, host |
| **Message frequency** | ~2–3/sec during active game |
| **Persistence** | **YES** — players expect chat scroll history |
| **Native presence** | NO |
| **PAM — Host** | read + write |
| **PAM — Player** | read + write |
| **PAM — Backend** | read |
| **Functions** | onBefore Chat Moderator — checks local banned-word list before delivery |

---

### `game.{gameId}.crowd.energy`
| Field | Value |
|-------|-------|
| **Publisher** | Functions onAfter (reaction aggregator) — when score crosses threshold |
| **Subscribers** | Host, all players (crowd energy meter), Illuminate |
| **Message frequency** | Every ~50 reaction events (threshold-based) |
| **Persistence** | **NO** — historical energy scores are irrelevant |
| **Native presence** | NO |
| **PAM — Host** | read |
| **PAM — Player** | read |
| **PAM — Backend** | read (Illuminate handles ingestion) |

This channel feeds Illuminate. An Illuminate rule: "if `score` crosses 500 within 60s, fire BONUS_TRIGGERED." The host and players see the crowd energy meter as a live bar filling up.

---

### `game.{gameId}.host.control`
| Field | Value |
|-------|-------|
| **Publisher** | Host client (JS SDK), FastAPI backend |
| **Subscribers** | All players, backend |
| **Message frequency** | ~1–2 per round (reveal, start, next round) |
| **Persistence** | **YES** — reconnecting player needs to know current game phase |
| **Native presence** | NO |
| **PAM — Host** | read + write |
| **PAM — Player** | read only |
| **PAM — Backend** | read + write |

Carries: GAME_STARTED, ANSWER_REVEAL, ROUND_COMPLETE, GAME_ENDED, BONUS_TRIGGERED.

---

### `game.{gameId}.player.count`
| Field | Value |
|-------|-------|
| **Publisher** | FastAPI background task (every 5 seconds) |
| **Subscribers** | All players, host |
| **Message frequency** | 12 per minute |
| **Persistence** | **NO** — ephemeral count, always current |
| **Native presence** | NO — this IS the replacement for native presence |
| **PAM — All** | Backend: write. Others: read. |

See doc [08](08-presence-strategy.md) for why this exists instead of native presence.

---

### `player.{playerId}.notifications`
| Field | Value |
|-------|-------|
| **Publisher** | FastAPI backend |
| **Subscribers** | Individual player only |
| **Message frequency** | Rare — bonus points, rank change, special events |
| **Persistence** | **YES** — player may miss a notification while briefly disconnected |
| **Native presence** | NO |
| **PAM — Player** | read (their own channel only) |
| **PAM — Backend** | write |

---

### `illuminate.{gameId}.events`
| Field | Value |
|-------|-------|
| **Publisher** | FastAPI backend |
| **Subscribers** | Illuminate platform |
| **Message frequency** | Continuous stream during game |
| **Persistence** | NO (Illuminate handles its own storage) |
| **Native presence** | NO |
| **PAM — Backend** | write |

---

## What Would Go Wrong With a Different Design

**If you used one channel for everything (`game.abc123`):**
- You can't grant a player read-only on questions without also granting read on answers (which should be backend-only)
- You can't have different persistence settings (questions need history, reactions don't)
- Every Function would fire on every message regardless of type — you'd need type-based routing inside Functions, making them slower and more error-prone

**If you used flat channel names (`gameabc123questions`):**
- PAM regex patterns can't match hierarchically — each channel needs an explicit permission entry
- Wildcard subscribe doesn't work (`gameabc123*` isn't a valid pattern — wildcards require dots)
- Debugging is harder — the channel name alone doesn't tell you its purpose

**If you put player answers on a shared channel without per-player scoping:**
- Any player can claim to be any other player in their message payload
- PAM cannot distinguish "player A publishing an answer" from "player A publishing an answer claiming to be player B"
- This is why the production pattern uses `game.{gameId}.answers.{playerId}` with per-player PAM write grants
