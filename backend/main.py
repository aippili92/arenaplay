"""ArenaPlay FastAPI application entry point."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.games import router as games_router
from .routes.tokens import router as tokens_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ArenaPlay Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:9001",
        "http://127.0.0.1:9001",
        "http://localhost:5173",
        "http://localhost:3000",
        "https://*.vercel.app",
        "https://*.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(games_router, prefix="/api/games")
app.include_router(tokens_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "arenaplay-backend"}


@app.on_event("startup")
async def startup_event():
    logger.info("ArenaPlay backend started")
