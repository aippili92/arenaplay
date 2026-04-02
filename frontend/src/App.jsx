import React, { useState, useEffect } from 'react';
import { getOrCreateUserId, createPubNubClient } from './pubnubClient.js';
import JoinScreen from './components/JoinScreen.jsx';
import HostDashboard from './components/HostDashboard.jsx';
import PlayerGame from './components/PlayerGame.jsx';

/**
 * Top-level state machine:
 *   "join"   → landing page
 *   "host"   → host dashboard
 *   "player" → player game view
 */
export default function App() {
  const [view, setView] = useState('join');
  const [gameContext, setGameContext] = useState(null);

  // Persistent userId — created once, stored forever in localStorage
  const [userId] = useState(() => getOrCreateUserId());

  // Clean up PubNub client when navigating back to join
  useEffect(() => {
    if (view === 'join' && gameContext?.pubnub) {
      gameContext.pubnub.destroy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function handleHostCreate({ gameId, joinCode, displayName, token, questions }) {
    const pubnub = createPubNubClient(userId);
    if (token) pubnub.setToken(token);
    setGameContext({ gameId, joinCode, playerId: userId, displayName, token, pubnub, isHost: true, questions });
    setView('host');
  }

  function handlePlayerJoin({ gameId, joinCode, playerId, displayName, token }) {
    const pubnub = createPubNubClient(userId);
    if (token) pubnub.setToken(token);
    setGameContext({ gameId, joinCode, playerId, displayName, token, pubnub, isHost: false });
    setView('player');
  }

  function handleLeave() {
    if (gameContext?.pubnub) {
      gameContext.pubnub.unsubscribeAll();
      gameContext.pubnub.destroy();
    }
    setGameContext(null);
    setView('join');
  }

  return (
    <div className="app-root">
      {view === 'join' && (
        <JoinScreen
          userId={userId}
          onHostCreate={handleHostCreate}
          onPlayerJoin={handlePlayerJoin}
        />
      )}
      {view === 'host' && gameContext && (
        <HostDashboard gameContext={gameContext} onLeave={handleLeave} />
      )}
      {view === 'player' && gameContext && (
        <PlayerGame gameContext={gameContext} onLeave={handleLeave} />
      )}
    </div>
  );
}
