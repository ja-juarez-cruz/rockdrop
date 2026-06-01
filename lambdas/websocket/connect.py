import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import players_table

logger = Logger()


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    connection_id = event["requestContext"]["connectionId"]
    query_params = event.get("queryStringParameters") or {}
    session_id = query_params.get("session_id")
    player_id = query_params.get("player_id")

    if not session_id or not player_id:
        logger.warning("Missing query params on connect", extra={"connection_id": connection_id})
        return {"statusCode": 400, "body": "Missing session_id or player_id"}

    players_table.update_item(
        Key={"session_id": session_id, "player_id": player_id},
        UpdateExpression="SET ws_connection_id = :cid, #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":cid": connection_id, ":s": "CONNECTED"},
    )

    logger.info("Player connected", extra={
        "session_id": session_id,
        "player_id": player_id,
        "connection_id": connection_id,
    })

    return {"statusCode": 200, "body": "Connected"}
