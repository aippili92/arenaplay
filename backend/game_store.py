"""
In-memory game store (local dev) or Upstash Redis (production/Vercel).

When UPSTASH_REDIS_REST_URL is set, all state is persisted to Redis so
serverless function instances share the same game data.
"""

import json
import os
import secrets
import string
import time
from typing import Optional

from .models import GamePhase, GameState, PlayerState

_JOIN_CODE_ALPHABET = string.ascii_uppercase + string.digits
GAME_TTL = 4 * 3600  # 4 hours

# ── In-memory fallback (local dev) ───────────────────────────────────────────
_games: dict[str, GameState] = {}

_USE_REDIS = bool(
    os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
)


def _get_redis():
    from upstash_redis.asyncio import Redis  # type: ignore
    url = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
    return Redis(url=url, token=token)


def _generate_join_code() -> str:
    return "".join(secrets.choice(_JOIN_CODE_ALPHABET) for _ in range(6))


# ── Redis helpers ─────────────────────────────────────────────────────────────

async def _redis_save(game: GameState) -> None:
    r = _get_redis()
    await r.set(f"game:{game.game_id}", game.model_dump_json(), ex=GAME_TTL)


async def _redis_get(game_id: str) -> Optional[GameState]:
    r = _get_redis()
    data = await r.get(f"game:{game_id}")
    if not data:
        return None
    return GameState.model_validate_json(data if isinstance(data, str) else data.decode())


async def _redis_get_by_code(join_code: str) -> Optional[GameState]:
    r = _get_redis()
    game_id = await r.get(f"code:{join_code.upper()}")
    if not game_id:
        return None
    gid = game_id if isinstance(game_id, str) else game_id.decode()
    return await _redis_get(gid)


# ── Public API ────────────────────────────────────────────────────────────────

async def save_game(game: GameState) -> None:
    if _USE_REDIS:
        await _redis_save(game)
    else:
        _games[game.game_id] = game


async def get_game(game_id: str) -> Optional[GameState]:
    if _USE_REDIS:
        return await _redis_get(game_id)
    return _games.get(game_id)


async def get_game_by_code(join_code: str) -> Optional[GameState]:
    if _USE_REDIS:
        return await _redis_get_by_code(join_code)
    for game in _games.values():
        if game.join_code == join_code.upper():
            return game
    return None


async def create_game(host_id: str, host_display_name: str, questions: list) -> GameState:
    import uuid
    game_id = str(uuid.uuid4())
    join_code = _generate_join_code()

    host_player = PlayerState(player_id=host_id, display_name=host_display_name)
    game = GameState(
        game_id=game_id,
        host_id=host_id,
        join_code=join_code,
        phase=GamePhase.LOBBY,
        players={host_id: host_player.model_dump()},
        questions=questions,
        current_round=-1,
        current_question=None,
        round_answers={},
        created_at=time.time(),
    )

    if _USE_REDIS:
        r = _get_redis()
        await r.set(f"game:{game_id}", game.model_dump_json(), ex=GAME_TTL)
        await r.set(f"code:{join_code}", game_id, ex=GAME_TTL)
    else:
        join_code_unique = join_code
        while any(g.join_code == join_code_unique for g in _games.values()):
            join_code_unique = _generate_join_code()
        game.join_code = join_code_unique
        _games[game_id] = game

    return game


async def add_player(game_id: str, player_id: str, display_name: str) -> GameState:
    game = await get_game(game_id)
    if player_id not in game.players:
        player = PlayerState(player_id=player_id, display_name=display_name)
        game.players[player_id] = player.model_dump()
    await save_game(game)
    return game


async def record_answer(game_id: str, player_id: str, answer: str) -> bool:
    """Returns False if the player already answered this round (duplicate)."""
    game = await get_game(game_id)
    if player_id in game.round_answers:
        return False
    game.round_answers[player_id] = answer.upper()
    await save_game(game)
    return True


async def calculate_and_apply_scores(game_id: str) -> dict:
    """
    Score all answers for the current round.
    First correct answer earns +50 bonus, second +40, ..., 10th+ earns +0.
    """
    game = await get_game(game_id)
    correct = game.current_question["correct"]
    correct_order = [pid for pid, ans in game.round_answers.items() if ans == correct]

    def speed_bonus(position: int) -> int:
        return max(0, 50 - position * 5)

    results: dict[str, dict] = {}
    for player_id, answer in game.round_answers.items():
        if player_id not in game.players:
            continue
        if answer == correct:
            position = correct_order.index(player_id)
            delta = 100 + speed_bonus(position)
        else:
            delta = 0
        game.players[player_id]["score"] += delta
        results[player_id] = {"score": game.players[player_id]["score"], "delta": delta}

    sorted_players = sorted(game.players.values(), key=lambda p: p["score"], reverse=True)
    rank = 1
    for i, player in enumerate(sorted_players):
        if i > 0 and player["score"] < sorted_players[i - 1]["score"]:
            rank = i + 1
        game.players[player["player_id"]]["rank"] = rank
        if player["player_id"] in results:
            results[player["player_id"]]["rank"] = rank

    game.round_answers = {}
    game.phase = GamePhase.REVEAL
    await save_game(game)
    return results


async def advance_round(game_id: str) -> Optional[dict]:
    """Move to the next question. Returns the question dict, or None if game is over."""
    game = await get_game(game_id)
    game.current_round += 1
    if game.current_round >= len(game.questions):
        game.phase = GamePhase.ENDED
        game.current_question = None
    else:
        game.current_question = game.questions[game.current_round]
        game.phase = GamePhase.QUESTION
    await save_game(game)
    return game.current_question


async def end_game_state(game_id: str) -> GameState:
    """Set game phase to ENDED and persist."""
    game = await get_game(game_id)
    game.phase = GamePhase.ENDED
    await save_game(game)
    return game


async def get_leaderboard(game_id: str) -> list:
    """Sorted leaderboard list, highest score first."""
    game = await get_game(game_id)
    sorted_players = sorted(game.players.values(), key=lambda p: p["score"], reverse=True)
    return [
        {"playerId": p["player_id"], "displayName": p["display_name"],
         "score": p["score"], "rank": p["rank"]}
        for p in sorted_players
    ]


async def all_active_games() -> list[GameState]:
    if _USE_REDIS:
        return []  # Background task not used in serverless
    return list(_games.values())
