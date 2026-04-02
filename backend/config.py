"""ArenaPlay backend configuration — loads from ../../.env relative to this file."""

from pathlib import Path
from dotenv import load_dotenv
import os

# Walk up two levels from this file's directory to find the workspace .env
_env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=_env_path)


class Settings:
    PUBNUB_PUBLISH_KEY: str = os.environ["PUBNUB_PUBLISH_KEY"]
    PUBNUB_SUBSCRIBE_KEY: str = os.environ["PUBNUB_SUBSCRIBE_KEY"]
    PUBNUB_SECRET_KEY: str = os.environ["PUBNUB_SECRET_KEY"]
    BACKEND_URL: str = os.getenv("BACKEND_URL", "http://localhost:8000")


settings = Settings()
