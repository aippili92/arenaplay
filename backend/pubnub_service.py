"""PubNub SDK initialisation, publish helper, and PAM v3 token grants."""

import asyncio
import logging

from pubnub.pnconfiguration import PNConfiguration
from pubnub.pubnub import PubNub
from pubnub.models.consumer.v3.channel import Channel

from .config import settings

logger = logging.getLogger(__name__)

config = PNConfiguration()
config.publish_key = settings.PUBNUB_PUBLISH_KEY
config.subscribe_key = settings.PUBNUB_SUBSCRIBE_KEY
config.secret_key = settings.PUBNUB_SECRET_KEY
config.user_id = "arenaplay-backend-server"
config.ssl = True

pubnub = PubNub(config)


async def publish(channel: str, message: dict) -> dict:
    """Publish to a PubNub channel. Runs the synchronous SDK call in the thread pool."""
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: pubnub.publish().channel(channel).message(message).sync()
        )
        return {"timetoken": result.result.timetoken}
    except Exception as e:
        logger.error("PubNub publish failed on %s: %s", channel, e)
        return {"error": str(e)}


async def grant_host_token(game_id: str, host_id: str) -> str:
    """
    Issue a PAM v3 token for the host role (TTL=240 min).
    Returns empty string if the keyset does not have PAM enabled (safe for local dev).
    """
    loop = asyncio.get_running_loop()
    try:
        envelope = await loop.run_in_executor(
            None,
            lambda: pubnub.grant_token()
            .ttl(240)
            .authorized_uuid(host_id)
            .channels([
                Channel.id(f"game.{game_id}.questions").read().write(),
                Channel.id(f"game.{game_id}.host.control").read().write(),
                Channel.id(f"game.{game_id}.answers.inbound").read(),
                Channel.id(f"game.{game_id}.leaderboard").read(),
                Channel.id(f"game.{game_id}.reactions").read(),
                Channel.id(f"game.{game_id}.chat").read().write(),
                Channel.id(f"game.{game_id}.crowd.energy").read(),
                Channel.id(f"game.{game_id}.player.count").read(),
            ])
            .sync()
        )
        return envelope.result.token
    except Exception as e:
        logger.warning("PAM host token grant failed (PAM may not be enabled): %s", e)
        return ""


async def grant_player_token(game_id: str, player_id: str) -> str:
    """
    Issue a PAM v3 token for a player (TTL=120 min).
    Returns empty string if the keyset does not have PAM enabled (safe for local dev).
    """
    loop = asyncio.get_running_loop()
    try:
        envelope = await loop.run_in_executor(
            None,
            lambda: pubnub.grant_token()
            .ttl(120)
            .authorized_uuid(player_id)
            .channels([
                Channel.id(f"game.{game_id}.questions").read(),
                # Players write answers to the shared inbound channel
                Channel.id(f"game.{game_id}.answers.inbound").write(),
                Channel.id(f"game.{game_id}.leaderboard").read(),
                Channel.id(f"game.{game_id}.reactions").read().write(),
                Channel.id(f"game.{game_id}.chat").read().write(),
                Channel.id(f"game.{game_id}.crowd.energy").read(),
                # Players subscribe to host.control for game lifecycle events
                Channel.id(f"game.{game_id}.host.control").read(),
                Channel.id(f"game.{game_id}.player.count").read(),
                # Personalised notifications for this player only
                Channel.id(f"player.{player_id}.notifications").read(),
            ])
            .sync()
        )
        return envelope.result.token
    except Exception as e:
        logger.warning("PAM player token grant failed (PAM may not be enabled): %s", e)
        return ""
