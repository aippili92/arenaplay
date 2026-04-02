import { useEffect, useRef } from 'react';

/**
 * Subscribe to PubNub channels, fire callbacks on messages and status events.
 * Persists lastTimetoken so reconnects can fetch missed messages.
 *
 * @param {PubNub|null} pubnubClient
 * @param {string[]} channels
 * @param {(event: object) => void} onMessage
 * @param {(status: object) => void} [onStatus]
 */
export function usePubNubListener(pubnubClient, channels, onMessage, onStatus) {
  // Persist timetoken across renders without causing re-renders
  const lastTimetokenRef = useRef(null);

  useEffect(() => {
    if (!pubnubClient || !channels || channels.length === 0) return;

    const listener = {
      message: (event) => {
        // Track the latest timetoken for catch-up on reconnect
        if (event.timetoken) {
          lastTimetokenRef.current = event.timetoken;
        }
        onMessage(event);
      },

      status: (statusEvent) => {
        if (onStatus) onStatus(statusEvent);

        // On reconnect, fetch any messages we may have missed
        if (statusEvent.category === 'PNReconnectedCategory') {
          const lastTt = lastTimetokenRef.current;
          if (lastTt) {
            pubnubClient
              .fetchMessages({
                channels,
                start: lastTt,
                count: 100,
              })
              .then(({ channels: chData }) => {
                // Replay missed messages in order
                const missed = Object.values(chData).flat();
                missed.sort((a, b) => (a.timetoken > b.timetoken ? 1 : -1));
                missed.forEach((msg) => {
                  if (msg.timetoken) lastTimetokenRef.current = msg.timetoken;
                  onMessage(msg);
                });
              })
              .catch((err) => {
                console.warn('[ArenaPlay] fetchMessages on reconnect failed:', err);
              });
          }
        }
      },
    };

    pubnubClient.addListener(listener);
    pubnubClient.subscribe({ channels });

    return () => {
      pubnubClient.removeListener(listener);
      pubnubClient.unsubscribe({ channels });
    };
  // Re-subscribe when channels array identity changes (stable reference expected from caller)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubnubClient, channels.join(',')]);

  return { lastTimetokenRef };
}
