import React, { useState, useCallback, useEffect } from 'react';
import { useReactionBatcher } from '../hooks/useReactionBatcher.js';

const EMOJIS = ['🔥', '⚡', '🎯', '😱', '👏'];

/**
 * Floating emoji reaction bar. Batches sends via useReactionBatcher.
 * Also displays incoming reaction bursts as floating animations.
 */
export default function ReactionStrip({ pubnubClient, channel, incomingReactions = [] }) {
  const { sendReaction } = useReactionBatcher(pubnubClient, channel);
  const [floaters, setFloaters] = useState([]);

  // Show floaters when reactions arrive from other players
  useEffect(() => {
    if (!incomingReactions.length) return;
    const newFloaters = incomingReactions.flatMap(({ emoji, count }) =>
      Array.from({ length: Math.min(count, 5) }, (_, i) => ({
        id: Date.now() + Math.random() + i,
        emoji,
        xOffset: Math.random() * 80 - 40,
      }))
    );
    setFloaters((prev) => [...prev.slice(-15), ...newFloaters]);
    const ids = new Set(newFloaters.map((f) => f.id));
    const t = setTimeout(() => setFloaters((prev) => prev.filter((f) => !ids.has(f.id))), 1500);
    return () => clearTimeout(t);
  }, [incomingReactions]);

  // Add a floater when user clicks
  const handleClick = useCallback(
    (emoji) => {
      sendReaction(emoji);
      const id = Date.now() + Math.random();
      const xOffset = Math.random() * 60 - 30; // -30 to +30 px
      setFloaters((prev) => [...prev.slice(-12), { id, emoji, xOffset }]);
      setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id));
      }, 1500);
    },
    [sendReaction]
  );

  return (
    <div className="reaction-strip-wrapper">
      {/* Floating emojis */}
      <div className="floaters" aria-hidden="true">
        {floaters.map((f) => (
          <span
            key={f.id}
            className="floater"
            style={{ left: `calc(50% + ${f.xOffset}px)` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      <div className="reaction-strip">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className="reaction-btn"
            onClick={() => handleClick(emoji)}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
