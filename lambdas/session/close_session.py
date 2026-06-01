import json
from datetime import datetime

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, sessions_table, get_all_players
from ws import broadcast
from models import ok, err

logger = Logger()


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return {"statusCode": 400, "body": json.dumps(err("Missing session_id"))}

    session = get_session(session_id)
    if not session:
        return {"statusCode": 404, "body": json.dumps(err("Session not found"))}

    host_player_id = event.get("requestContext", {}).get("authorizer", {}).get("player_id")
    if host_player_id and session.get("host_player_id") != host_player_id:
        return {"statusCode": 403, "body": json.dumps(err("Only the host can close the session"))}

    sessions_table.update_item(
        Key={"session_id": session_id, "sk": "METADATA"},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "FINISHED"},
    )

    broadcast(session_id, "GAME_FINISHED", {"session_id": session_id, "reason": "host_closed"})
    logger.info("Session closed", extra={"session_id": session_id})

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok({"session_id": session_id, "status": "FINISHED"})),
    }
