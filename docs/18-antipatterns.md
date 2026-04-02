# 18 — Common Mistakes & Anti-Patterns

> These are the 7 things that will get you flagged in a PubNub code review. ArenaPlay deliberately avoids all of them. Know WHY they're wrong, not just that they are.

---

## 1. Using Publish for Typing Indicators (Signals Misuse)

**The mistake:**
```javascript
// Wrong
pubnub.publish({ channel: 'game.x.chat', message: { typing: true, userId: 'p-001' } });
```

**The problem:**
- Typing indicators fire dozens of times per minute per user
- Each Publish persists to message history (if enabled) → chat history fills with typing noise
- Each Publish triggers any onBefore/onAfter Functions on the channel → unnecessary Function executions
- Costs more: Publish is more expensive than Signal per operation

**The fix:**
```javascript
// Correct
pubnub.signal({ channel: 'game.x.chat', message: { typing: true, userId: 'p-001' } });
```

Signals: max 64 bytes, not persisted, don't trigger Functions, lower cost. Perfect for ephemeral state.

**In ArenaPlay:** Player heartbeats use Signals. If we used Publish, every 10-second heartbeat from 10K players would create 10K history entries per minute on the heartbeat channel.

---

## 2. Enabling Presence on Every Channel

**The mistake:**
```javascript
pubnub.subscribe({ channels: allGameChannels, withPresence: true }); // on all channels
```

**The problem:**
- Presence fires join/leave/timeout events on every subscribed channel
- At 10K players, each channel generates 10K join events during lobby
- If presence is on 8 channels: 80K join events to process
- `hereNow` on 8 channels at 10K players: 8 × 200KB API responses per poll

**The fix:** Only enable presence where you need per-user tracking. For ArenaPlay, we don't use native presence at all at this scale — we use the counter pattern. If you need presence for debugging, enable it on a single dedicated heartbeat channel, server-side only.

---

## 3. Publishing Raw Reactions Without Client-Side Batching

**The mistake:**
```javascript
// On every emoji tap — potentially 10 times per second per player
pubnub.publish({ channel: `game.x.reactions`, message: { emoji: '🔥', userId: 'p-001' } });
```

**The problem at 10K players:**
- 10K players × 10 taps/sec = 100K publishes/second
- Each publish triggers onAfter reaction aggregator Function → 100K Function executions/sec
- 100K × KV Store incrCounter at $rate = massive cost spike
- Functions KV Store rate limits will be hit

**The fix (ArenaPlay's approach):**
```javascript
// useReactionBatcher.js — collect for 500ms, publish once
const buffer = new Map();
// ... accumulate taps in buffer
// After 500ms:
pubnub.publish({
  channel: `game.x.reactions`,
  message: { type: 'REACTION_BURST', reactions: Array.from(buffer.entries()).map(([emoji, count]) => ({emoji, count})), windowMs: 500 }
});
```

10K players × 2 publishes/sec (after batching) = 20K/sec → manageable.

---

## 4. Client-Side secretKey

**The mistake:**
```javascript
// In your React app, pubnub-config.js
const pubnub = new PubNub({
  publishKey: 'pub-xxx',
  subscribeKey: 'sub-xxx',
  secretKey: 'sec-xxx',  // 🚨 NEVER DO THIS
  userId: 'user-123'
});
```

**The problem:**
The `secretKey` grants the ability to call `grant_token()` with any permissions on any channel. A user opening DevTools → Sources → your bundled JS file would see it in seconds. They could then:
- Grant themselves permanent admin access to your entire keyset
- Grant themselves write access to the leaderboard channel (fake scores)
- Revoke tokens for all other users (DoS the game)
- Read every persisted message on every channel

There is no recovery from a leaked secretKey except key rotation — which requires re-deploying every client that has a hardcoded key.

**The fix:** secretKey lives ONLY in FastAPI's environment variable, loaded from `.env`. It is never in any file that gets bundled for the browser. PubNub code reviewer will flag this as CRITICAL.

---

## 5. Not Persisting UUID Across Sessions

**The mistake:**
```javascript
// Generate a new UUID on every page load
const userId = crypto.randomUUID(); // new every time
const pubnub = new PubNub({ userId, ... });
```

**The problems:**
- Every page refresh creates a "new user" in PubNub's presence system
- Old UUID gets a `timeout` presence event after heartbeat interval → ghost user
- Player reconnecting mid-game gets a new identity, can't claim their existing score
- Message history tied to old UUID is inaccessible
- PAM token issued for old UUID is useless

**The fix (ArenaPlay's approach):**
```javascript
// On every app load
let userId = localStorage.getItem('arenaPlayUserId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('arenaPlayUserId', userId);
}
const pubnub = new PubNub({ userId, ... });
```

One UUID per browser. Survives refresh. Consistent identity across reconnects.

---

## 6. Ignoring Timetokens for Ordering

**The mistake:**
```javascript
pubnub.addListener({
  message: (event) => {
    messages.push(event.message);  // Just append — assume delivery order = publish order
  }
});
```

**The problem:**
On reconnect, `fetchMessages` returns historical messages starting from a timetoken. If you don't use the timetoken to deduplicate, you'll replay messages you already received. If you don't sort by timetoken, messages from history and live messages may interleave in the wrong order. The SDK delivers live messages in order, but history + live together requires timetoken-based reconciliation.

**The fix:**
```javascript
pubnub.addListener({
  message: (event) => {
    lastSeenTimetoken.current = event.timetoken; // Always update
    setMessages(prev => {
      const exists = prev.some(m => m.timetoken === event.timetoken);
      if (exists) return prev; // Dedup
      return [...prev, event].sort((a, b) =>
        BigInt(a.timetoken) < BigInt(b.timetoken) ? -1 : 1
      );
    });
  }
});
```

Note: timetokens are 17-digit integers — larger than JavaScript's safe integer range. Use `BigInt` for comparison.

---

## 7. Slow External API Call in Before-Publish Function

**The mistake:**
```javascript
// In an onBefore handler on the chat channel
export default async (request) => {
  const response = await xhr.fetch('https://api.perspectiveapi.com/v1alpha1/comments:analyze', {
    method: 'POST',
    body: JSON.stringify({ comment: { text: request.message.text }, ... })
  });
  const result = JSON.parse(response.body);
  if (result.score > 0.8) return request.abort('Flagged by moderation');
  return request.ok();
};
```

**The problem:**
- Perspective API response time: 50–500ms
- This is an `onBefore` handler — that latency is added to EVERY chat message delivery
- At 500ms overhead: every chat message takes half a second longer to deliver
- Under load, Perspective API might be slower → Function approaches 10s timeout
- If Function times out → behavior undefined for that message

**The fix (ArenaPlay's approach):**
1. `onBefore` handler uses local KV Store word list (~15ms) for obvious bad words
2. Production addition: `onAfter` handler calls Perspective API asynchronously. If flagged, backend publishes a "message_removed" event. Message delivers instantly; moderation catches up.

The rule: **Never put a slow external call in an `onBefore` handler.**
