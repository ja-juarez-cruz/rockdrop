import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_player_by_connection, mark_player_disconnected
from ws import broadcast

logger = Logger()


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    connection_id = event["requestContext"]["connectionId"]

    player = get_player_by_connection(connection_id)
    if not player:
        logger.warning("No player found for connection", extra={"connection_id": connection_id})
        return {"statusCode": 200, "body": "Disconnected"}

    session_id = player["session_id"]
    player_id = player["player_id"]

    mark_player_disconnected(session_id, player_id)

    broadcast(session_id, "PLAYER_DISCONNECTED", {
        "player_id": player_id,
        "display_name": player.get("display_name"),
    }, exclude_player_id=player_id)

    logger.info("Player disconnected", extra={
        "session_id": session_id,
        "player_id": player_id,
        "connection_id": connection_id,
    })

    return {"statusCode": 200, "body": "Disconnected"}
