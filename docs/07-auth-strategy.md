# 07 — Auth & PAM Strategy

---

## ELI5 Version

Imagine a concert. The host has an "all access" backstage pass — they can go anywhere. Players have a "general admission" wristband — they can watch but not mess with the stage equipment.

PubNub Access Manager (PAM) works the same way. The **token** is a cryptographically signed wristband issued by your server. PubNub enforces it at the network layer — a player with a general admission token literally cannot publish to the questions channel, no matter what they put in their code.

---

## The Three-Party Model

This is how PAM v3 is designed to work. There are exactly three parties:

```
1. Client (player/host browser)
        ↓ "I am user X, please give me access to game Y"
2. FastAPI Backend (YOUR server — holds the secretKey)
        ↓ calls grant_token() with specific permissions
3. PubNub Network
        ↓ returns a signed token
        → Backend sends token to client
        → Client calls pubnub.setToken(token)
        → All subsequent PubNub operations are authorized by that token
```

The `secretKey` NEVER leaves the FastAPI backend. It never appears in a response. It never appears in frontend code. This is not optional.

---

## Token Types

### Host Token (TTL: 240 minutes)

```python
pubnub.grant_token() \
    .ttl(240) \
    .authorized_uuid(host_id) \
    .channels([
        Channel.id(f"game.{game_id}.questions").read().write(),
        Channel.id(f"game.{game_id}.host.control").read().write(),
        Channel.id(f"game.{game_id}.answers.inbound").read(),
        Channel.id(f"game.{game_id}.leaderboard").read(),
        Channel.id(f"game.{game_id}.reactions").read(),
        Channel.id(f"game.{game_id}.chat").read().write(),
        Channel.id(f"game.{game_id}.crowd.energy").read(),
        Channel.id(f"game.{game_id}.player.count").read(),
    ]) \
    .sync()
```

**Why 240 minutes?** A live game session can last up to 2 hours. With margin for setup/teardown, 4 hours is the right TTL. No mid-session refresh needed for the host.

**Why not longer?** Longer TTLs increase the blast radius if a token leaks. 30-day tokens are convenient but dangerous. 4 hours is enough and limits exposure.

### Player Token (TTL: 120 minutes)

```python
pubnub.grant_token() \
    .ttl(120) \
    .authorized_uuid(player_id) \
    .channels([
        Channel.id(f"game.{game_id}.questions").read(),
        Channel.id(f"game.{game_id}.answers.inbound").write(),   # players SUBMIT answers
        Channel.id(f"game.{game_id}.leaderboard").read(),
        Channel.id(f"game.{game_id}.reactions").read().write(),
        Channel.id(f"game.{game_id}.chat").read().write(),
        Channel.id(f"game.{game_id}.crowd.energy").read(),
        Channel.id(f"game.{game_id}.host.control").read(),
        Channel.id(f"game.{game_id}.player.count").read(),
        Channel.id(f"player.{player_id}.notifications").read(),
    ]) \
    .sync()
```

**Key restriction:** Players get `write` on `answers.inbound` and their own `notifications` channel. They do NOT get `write` on `questions`, `leaderboard`, or `host.control`. A malicious player cannot fake a leaderboard update.

**Why 120 minutes?** Shorter than the host token — more frequent rotation reduces risk. A player joining mid-game might disconnect and rejoin; 2 hours is enough for any session.

---

## Token Refresh Flow

**Strategy: Client-Side Timer** (chosen over Proactive Server Push and Just-in-Time 403)

```
On token received:
  ttl = 120 min
  refreshAt = now + (120 - 20) min = now + 100 min

  setTimeout(() => {
    fetch('/api/token/refresh', {body: {gameId, playerId, role: 'player'}})
      .then(r => r.json())
      .then(({token}) => pubnub.setToken(token))
  }, refreshAt - now)
```

`pubnub.setToken(newToken)` updates the token in-place. No disconnect, no resubscribe. The player never notices.

**Why not Proactive Server Push?**
The server would need to track the expiry time of every active player token (up to 10K entries), run a timer for each, and push new tokens. That's significant server-side state. For a game session, it's not worth the complexity.

**Why not Just-in-Time 403?**
When a player's token expires mid-game and they try to submit an answer, they get a 403. The answer is rejected. The player loses points for that round because of a token expiry — not their fault. Bad user experience.

**Client-Side Timer wins:** proactive, decentralized, zero server state, invisible to the user.

---

## PAM Enforcement: How It Prevents Cheating

**Scenario: Player A tries to publish to `game.X.leaderboard` to fake a score.**

```
Player A calls: pubnub.publish({channel: 'game.X.leaderboard', message: {fake: 'score'}})

PubNub checks: Does Player A's token have write permission on game.X.leaderboard?
Answer: NO. Token was granted with read-only on leaderboard.

PubNub returns: 403 Forbidden
Message never delivered.
```

This enforcement happens at the PubNub network layer — not in your application code, not in a Function. It's cryptographic and cannot be bypassed.

**Scenario: Player A tries to publish to `game.X.host.control` to trigger a fake game end.**

Same result — player token has only read on host.control. 403.

---

## Production Upgrade: Per-Player Answer Channels

The MVP uses `game.{gameId}.answers.inbound` — all players share one write channel. PAM grants every player write on this channel. A malicious player could publish an answer claiming to be another player.

The production pattern:
```python
# Each player gets write on ONLY their own answer channel
Channel.id(f"game.{game_id}.answers.{player_id}").write()
```

With PAM v3 regex matching:
```python
# Or use a channel pattern for all channels in the game
# game.abc123.answers.player-uuid-001 → matches
# game.abc123.answers.player-uuid-002 → does NOT match (different player_id)
```

This enforces player identity at the network layer. No player can spoof another player's answer channel because their token doesn't grant write on that channel.

**Why MVP skips this:** Per-player channels require the backend to subscribe to one channel per player — at 10K players, that's 10K channel subscriptions (use channel groups for this). Channel groups must be managed server-side, adding setup complexity. For a demo, the shared inbound channel with Function-level validation is sufficient.

---

## Token Size Limit

PAM v3 tokens have a **32 KiB size limit**. With 10K channel permission entries (one per player's answer channel), the token could grow large. The solution: use regex patterns in the token instead of explicit channel lists.

```python
# Instead of 10K explicit channels:
Channel.id(f"game.{game_id}.answers.player-1").write()
Channel.id(f"game.{game_id}.answers.player-2").write()
# ... × 10K

# Use regex (PAM v3 supports RE2 patterns):
ChannelPattern.id(f"game\\.{game_id}\\.answers\\..*").write()
# One entry instead of 10K — token stays small
```

This is a critical production consideration. A token with 10K explicit channels would exceed the 32 KiB limit.
