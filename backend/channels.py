"""
ArenaPlay — PubNub Channel Name Helpers

All channel names for the ArenaPlay platform live here.
Changing a channel name in one place updates both backend and (via the JS copy) frontend.

Naming convention: dot-separated hierarchy → game.{gameId}.{purpose}
This enables future wildcard subscribe: game.abc123.*
"""


def questions(game_id: str) -> str:
    """Host publishes questions; all players subscribe. Persisted for catch-up."""
    return f"game.{game_id}.questions"


def answers_inbound(game_id: str) -> str:
    """
    All player answers land here. Functions onBefore validates and caps frequency.
    MVP: single shared inbound channel.
    Production upgrade path: game.{gameId}.answers.{playerId} per player with PAM regex.
    """
    return f"game.{game_id}.answers.inbound"


def leaderboard(game_id: str) -> str:
    """Backend publishes score updates after each round. Persisted for catch-up."""
    return f"game.{game_id}.leaderboard"


def reactions(game_id: str) -> str:
    """Players publish batched emoji bursts. Ephemeral — not persisted."""
    return f"game.{game_id}.reactions"


def chat(game_id: str) -> str:
    """Player chat. Functions onBefore moderates. Persisted for history."""
    return f"game.{game_id}.chat"


def crowd_energy(game_id: str) -> str:
    """Functions onAfter (reactions) publishes aggregated energy score. Ephemeral."""
    return f"game.{game_id}.crowd.energy"


def host_control(game_id: str) -> str:
    """Host publishes control events (start, reveal, end). Persisted for state sync."""
    return f"game.{game_id}.host.control"


def player_count(game_id: str) -> str:
    """Backend counter pattern: publishes {count: N} every 5s. Replaces native presence."""
    return f"game.{game_id}.player.count"


def player_notifications(player_id: str) -> str:
    """Backend publishes personalized alerts (rank change, bonus points). Persisted."""
    return f"player.{player_id}.notifications"


def illuminate_events(game_id: str) -> str:
    """Backend streams behavioral events to Illuminate for adaptive logic."""
    return f"illuminate.{game_id}.events"


# All channels a player should subscribe to for a given game
def player_subscribe_channels(game_id: str, player_id: str) -> list[str]:
    return [
        questions(game_id),
        leaderboard(game_id),
        reactions(game_id),
        chat(game_id),
        crowd_energy(game_id),
        host_control(game_id),
        player_count(game_id),
        player_notifications(player_id),
    ]


# All channels the host should subscribe to for a given game
def host_subscribe_channels(game_id: str) -> list[str]:
    return [
        answers_inbound(game_id),
        reactions(game_id),
        chat(game_id),
        crowd_energy(game_id),
        player_count(game_id),
    ]
