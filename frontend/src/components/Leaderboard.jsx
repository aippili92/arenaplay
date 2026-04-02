import React, { useRef, useEffect, useState } from 'react';

const RANK_ICONS = { 1: '🥇', 2: '🥈', 3: '🥉' };

/**
 * Animated leaderboard. Top-10 players, highlighted row for current player.
 * Score deltas shown briefly when scores update.
 */
export default function Leaderboard({ players = [], highlightId }) {
  const prevScoresRef = useRef({});
  const [deltas, setDeltas] = useState({});

  useEffect(() => {
    const prev = prevScoresRef.current;
    const newDeltas = {};
    players.forEach((p) => {
      const prevScore = prev[p.playerId] ?? p.score;
      const diff = p.score - prevScore;
      if (diff > 0) newDeltas[p.playerId] = `+${diff}`;
    });
    if (Object.keys(newDeltas).length > 0) {
      setDeltas(newDeltas);
      // Clear deltas after 2.5s
      const timer = setTimeout(() => setDeltas({}), 2500);
      return () => clearTimeout(timer);
    }
    // Update stored scores
    const next = {};
    players.forEach((p) => { next[p.playerId] = p.score; });
    prevScoresRef.current = next;
  }, [players]);

  // Sync stored scores after delta effect settles
  useEffect(() => {
    const next = {};
    players.forEach((p) => { next[p.playerId] = p.score; });
    prevScoresRef.current = next;
  }, [players]);

  const top10 = players.slice(0, 10);

  return (
    <div className="leaderboard">
      <h3 className="leaderboard-title">Leaderboard</h3>
      {top10.length === 0 && (
        <p className="leaderboard-empty">No players yet…</p>
      )}
      <div className="leaderboard-rows">
        {top10.map((player, idx) => {
          const rank = idx + 1;
          const isMe = player.playerId === highlightId;
          const delta = deltas[player.playerId];
          return (
            <div
              key={player.playerId}
              className={`leaderboard-row ${isMe ? 'leaderboard-row--me' : ''}`}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <span className="lb-rank">
                {RANK_ICONS[rank] || <span className="lb-rank-num">{rank}</span>}
              </span>
              <span className="lb-name">{player.displayName}</span>
              <span className="lb-score">
                {player.score.toLocaleString()}
                {delta && (
                  <span className="lb-delta">{delta}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
