import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, get_all_players
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

    players = get_all_players(session_id)
    safe_players = [
        {
            "player_id": p["player_id"],
            "display_name": p["display_name"],
            "is_host": p.get("is_host", False),
            "score": p.get("score", 0),
            "status": p.get("status", "DISCONNECTED"),
        }
        for p in players
    ]

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok({"players": safe_players, "count": len(safe_players)})),
    }
