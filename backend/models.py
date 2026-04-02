"""Pydantic v2 models for ArenaPlay game state and API contracts."""

from enum import Enum
from typing import Optional
from pydantic import BaseModel


class GamePhase(str, Enum):
    LOBBY = "lobby"
    QUESTION = "question"
    REVEAL = "reveal"
    ENDED = "ended"


class Question(BaseModel):
    question_id: str
    text: str
    options: list  # [optA, optB, optC, optD] — positional; index 0=A, 1=B, 2=C, 3=D
    correct: str   # "A"|"B"|"C"|"D"
    time_limit: int = 30


class PlayerState(BaseModel):
    player_id: str
    display_name: str
    score: int = 0
    rank: int = 0


class GameState(BaseModel):
    game_id: str
    host_id: str
    join_code: str
    phase: GamePhase = GamePhase.LOBBY
    players: dict = {}           # player_id → PlayerState.model_dump()
    questions: list = []         # list of Question.model_dump()
    current_round: int = -1      # -1 in lobby; increments to 0 on first advance_round()
    current_question: Optional[dict] = None
    round_answers: dict = {}     # player_id → answer char for current round
    created_at: float = 0.0


class CreateGameRequest(BaseModel):
    host_id: str
    host_display_name: str
    questions: list[Question]


class JoinGameRequest(BaseModel):
    join_code: str
    display_name: str
    player_id: str  # client-generated UUID, persisted in localStorage


class RevealRequest(BaseModel):
    pass  # host triggers reveal; correct answer comes from game state


class AnswerRequest(BaseModel):
    player_id: str
    answer: str       # "A"|"B"|"C"|"D"
    round_number: int
