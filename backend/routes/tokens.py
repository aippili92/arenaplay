"""Token refresh endpoint — allows clients to renew PAM tokens before expiry."""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..game_store import get_game
from ..pubnub_service import grant_host_token, grant_player_token

logger = logging.getLogger(__name__)

router = APIRouter()


class TokenRefreshRequest(BaseModel):
    gameId: str
    playerId: str
    role: str  # "host" | "player"


@router.post("/token/refresh")
async def refresh_token(req: TokenRefreshRequest):
    game = get_game(req.gameId)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    if req.role == "host":
        if req.playerId != game.host_id:
            raise HTTPException(status_code=403, detail="Not the host of this game")
        token = await grant_host_token(req.gameId, req.playerId)
        ttl = 240
    elif req.role == "player":
        if req.playerId not in game.players:
            raise HTTPException(status_code=403, detail="Player not in this game")
        token = await grant_player_token(req.gameId, req.playerId)
        ttl = 120
    else:
        raise HTTPException(status_code=400, detail="role must be 'host' or 'player'")

    return {"token": token, "ttl": ttl}
