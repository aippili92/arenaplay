"""Game lifecycle endpoints — create, join, start, question, answer, reveal, next, end."""

import logging
from fastapi import APIRouter, HTTPException

from .. import channels
from ..game_store import (
    add_player,
    advance_round,
    calculate_and_apply_scores,
    create_game,
    end_game_state,
    get_game,
    get_game_by_code,
    get_leaderboard,
    record_answer,
)
from ..models import AnswerRequest, CreateGameRequest, GamePhase, JoinGameRequest, RevealRequest
from ..pubnub_service import grant_host_token, grant_player_token, publish

logger = logging.getLogger(__name__)

router = APIRouter()


def _sanitise_game_state(game) -> dict:
    """Strip correct answers from questions before sending to clients."""
    data = game.model_dump()
    data["questions"] = [
        {k: v for k, v in q.items() if k != "correct"}
        for q in data["questions"]
    ]
    if data.get("current_question"):
        data["current_question"] = {
            k: v for k, v in data["current_question"].items() if k != "correct"
        }
    return data


def _answer_distribution(round_answers: dict) -> dict:
    """Count how many players chose each option."""
    dist: dict[str, int] = {"A": 0, "B": 0, "C": 0, "D": 0}
    for answer in round_answers.values():
        if answer in dist:
            dist[answer] += 1
    return dist


# POST /
@router.post("/")
async def create_game_endpoint(req: CreateGameRequest):
    questions = [q.model_dump() for q in req.questions]
    game = await create_game(req.host_id, req.host_display_name, questions)
    token = await grant_host_token(game.game_id, req.host_id)
    return {
        "gameId": game.game_id,
        "joinCode": game.join_code,
        "hostToken": token,
        "gameState": _sanitise_game_state(game),
    }


# GET /{gameId}
@router.get("/{game_id}")
async def get_game_endpoint(game_id: str):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return _sanitise_game_state(game)


# POST /{gameId}/join
@router.post("/{game_id}/join")
async def join_game(game_id: str, req: JoinGameRequest):
    game = await get_game(game_id) or await get_game_by_code(req.join_code)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.phase not in (GamePhase.LOBBY,):
        raise HTTPException(status_code=409, detail="Game has already started")

    game = await add_player(game.game_id, req.player_id, req.display_name)
    token = await grant_player_token(game.game_id, req.player_id)

    # Publish updated player count (replaces background task for join events)
    await publish(
        channels.player_count(game.game_id),
        {"type": "PLAYER_COUNT_UPDATE", "gameId": game.game_id, "count": len(game.players)},
    )

    return {
        "playerId": req.player_id,
        "playerToken": token,
        "ttl": 120,
        "gameState": _sanitise_game_state(game),
    }


# POST /{gameId}/start
@router.post("/{game_id}/start")
async def start_game(game_id: str):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.phase != GamePhase.LOBBY:
        raise HTTPException(status_code=409, detail="Game already started")
    if not game.questions:
        raise HTTPException(status_code=400, detail="No questions loaded")

    first_question = await advance_round(game_id)

    await publish(
        channels.host_control(game_id),
        {"type": "GAME_STARTED", "gameId": game_id, "totalRounds": len(game.questions)},
    )
    return {"ok": True, "phase": "question", "firstQuestion": first_question}


# POST /{gameId}/question
@router.post("/{game_id}/question")
async def broadcast_question(game_id: str):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if not game.current_question:
        raise HTTPException(status_code=409, detail="No active question")

    q = game.current_question
    payload = {
        "type": "QUESTION_BROADCAST",
        "gameId": game_id,
        "roundNumber": game.current_round,
        "questionId": q["question_id"],
        "text": q["text"],
        "options": q["options"],
        "timeLimit": q.get("time_limit", 30),
    }
    await publish(channels.questions(game_id), payload)
    return payload


# POST /{gameId}/answer
@router.post("/{game_id}/answer")
async def submit_answer(game_id: str, req: AnswerRequest):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.phase != GamePhase.QUESTION:
        return {"recorded": False, "reason": "not_in_question_phase"}
    if req.round_number != game.current_round:
        return {"recorded": False, "reason": "wrong_round"}
    ok = await record_answer(game_id, req.player_id, req.answer)
    return {"recorded": ok}


# POST /{gameId}/reveal
@router.post("/{game_id}/reveal")
async def reveal_answers(game_id: str, _req: RevealRequest = None):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.phase != GamePhase.QUESTION:
        raise HTTPException(status_code=409, detail="Not in question phase")

    q = game.current_question

    # Snapshot distribution before calculate_and_apply_scores clears round_answers
    distribution = _answer_distribution(game.round_answers)
    score_results = await calculate_and_apply_scores(game_id)
    leaderboard = await get_leaderboard(game_id)

    await publish(
        channels.host_control(game_id),
        {
            "type": "ANSWER_REVEAL",
            "gameId": game_id,
            "roundNumber": game.current_round,
            "questionId": q["question_id"],
            "correctAnswer": q["correct"],
            "distribution": distribution,
        },
    )

    leaderboard_with_delta = [
        {**entry, "delta": score_results.get(entry["playerId"], {}).get("delta", 0)}
        for entry in leaderboard
    ]

    await publish(
        channels.leaderboard(game_id),
        {
            "type": "SCORES_UPDATED",
            "gameId": game_id,
            "roundNumber": game.current_round,
            "leaderboard": leaderboard_with_delta,
            "totalPlayers": len(game.players),
        },
    )

    return leaderboard_with_delta


# POST /{gameId}/next
@router.post("/{game_id}/next")
async def next_round(game_id: str):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    next_question = await advance_round(game_id)
    game = await get_game(game_id)  # re-fetch for updated round number

    if next_question:
        q = next_question
        payload = {
            "type": "QUESTION_BROADCAST",
            "gameId": game_id,
            "roundNumber": game.current_round,
            "questionId": q["question_id"],
            "text": q["text"],
            "options": q["options"],
            "timeLimit": q.get("time_limit", 30),
        }
        await publish(channels.questions(game_id), payload)
        return {"round": game.current_round, "question": payload}

    return {"round": game.current_round, "question": None}


# POST /{gameId}/end
@router.post("/{game_id}/end")
async def end_game(game_id: str):
    game = await get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    game = await end_game_state(game_id)
    leaderboard = await get_leaderboard(game_id)
    winner_id = leaderboard[0]["playerId"] if leaderboard else None

    await publish(
        channels.host_control(game_id),
        {
            "type": "GAME_ENDED",
            "gameId": game_id,
            "finalLeaderboard": leaderboard,
            "winnerId": winner_id,
        },
    )

    return {"ok": True, "finalLeaderboard": leaderboard, "winnerId": winner_id}
