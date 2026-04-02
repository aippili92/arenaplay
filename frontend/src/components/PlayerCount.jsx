import React from 'react';

export default function PlayerCount({ count }) {
  return (
    <div className="player-count-badge">
      <span className="player-count-dot" />
      <span>
        {typeof count === 'number' ? count.toLocaleString() : count} live
      </span>
    </div>
  );
}
