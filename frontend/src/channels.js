/**
 * ArenaPlay — PubNub Channel Name Helpers (JavaScript mirror of backend/channels.py)
 *
 * Single source of truth for channel names on the frontend.
 * Keep this in sync with backend/channels.py.
 */

export const ch = {
  questions:     (gameId) => `game.${gameId}.questions`,
  answersInbound:(gameId) => `game.${gameId}.answers.inbound`,
  leaderboard:   (gameId) => `game.${gameId}.leaderboard`,
  reactions:     (gameId) => `game.${gameId}.reactions`,
  chat:          (gameId) => `game.${gameId}.chat`,
  crowdEnergy:   (gameId) => `game.${gameId}.crowd.energy`,
  hostControl:   (gameId) => `game.${gameId}.host.control`,
  playerCount:   (gameId) => `game.${gameId}.player.count`,
  notifications: (playerId) => `player.${playerId}.notifications`,

  /** All channels a player subscribes to */
  playerChannels: (gameId, playerId) => [
    `game.${gameId}.questions`,
    `game.${gameId}.leaderboard`,
    `game.${gameId}.reactions`,
    `game.${gameId}.chat`,
    `game.${gameId}.crowd.energy`,
    `game.${gameId}.host.control`,
    `game.${gameId}.player.count`,
    `player.${playerId}.notifications`,
  ],

  /** All channels a host subscribes to */
  hostChannels: (gameId) => [
    `game.${gameId}.questions`,
    `game.${gameId}.answers.inbound`,
    `game.${gameId}.leaderboard`,
    `game.${gameId}.reactions`,
    `game.${gameId}.chat`,
    `game.${gameId}.crowd.energy`,
    `game.${gameId}.host.control`,
    `game.${gameId}.player.count`,
  ],
};

/** Event type constants — match backend models.py EventType */
export const EventType = {
  GAME_CREATED:       'GAME_CREATED',
  PLAYER_JOINED:      'PLAYER_JOINED',
  QUESTION_BROADCAST: 'QUESTION_BROADCAST',
  ANSWER_SUBMITTED:   'ANSWER_SUBMITTED',
  ANSWER_REVEAL:      'ANSWER_REVEAL',
  SCORES_UPDATED:     'SCORES_UPDATED',
  REACTION_BURST:     'REACTION_BURST',
  CHAT_MESSAGE:       'CHAT_MESSAGE',
  ROUND_COMPLETE:     'ROUND_COMPLETE',
  GAME_ENDED:         'GAME_ENDED',
  PLAYER_RECONNECTED: 'PLAYER_RECONNECTED',
  BONUS_TRIGGERED:    'BONUS_TRIGGERED',
  CROWD_ENERGY_UPDATE:  'CROWD_ENERGY_UPDATE',
  GAME_STARTED:         'GAME_STARTED',
  PLAYER_COUNT_UPDATE:  'PLAYER_COUNT_UPDATE',
};
