import { useRef, useCallback } from 'react';
import { EventType } from '../channels.js';

const WINDOW_MS = 500;

/**
 * Batch emoji reactions into one REACTION_BURST message per 500ms window.
 * Prevents reaction storms when 10K+ players tap at once.
 *
 * @param {PubNub|null} pubnubClient
 * @param {string} channel  — the reactions channel (ch.reactions(gameId))
 * @returns {{ sendReaction: (emoji: string) => void }}
 */
export function useReactionBatcher(pubnubClient, channel) {
  // Map of emoji → count accumulated in current window
  const bufferRef = useRef({});
  const timerRef = useRef(null);

  const flush = useCallback(() => {
    const buffer = bufferRef.current;
    const entries = Object.entries(buffer);
    if (!entries.length || !pubnubClient || !channel) return;

    // Reset buffer before async publish to avoid double-flush
    bufferRef.current = {};
    timerRef.current = null;

    const reactions = entries.map(([emoji, count]) => ({ emoji, count }));

    pubnubClient
      .publish({
        channel,
        message: {
          type: EventType.REACTION_BURST,
          reactions,
          windowMs: WINDOW_MS,
        },
      })
      .catch((err) => {
        console.warn('[ArenaPlay] Reaction batch publish failed:', err);
      });
  }, [pubnubClient, channel]);

  const sendReaction = useCallback(
    (emoji) => {
      // Accumulate into buffer
      bufferRef.current[emoji] = (bufferRef.current[emoji] || 0) + 1;

      // Start a window timer if not already running
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, WINDOW_MS);
      }
    },
    [flush]
  );

  return { sendReaction };
}
