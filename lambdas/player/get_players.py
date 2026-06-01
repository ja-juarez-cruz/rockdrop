import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, get_all_players
from models import ok, err, make_response

logger = Logger()


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return make_response(400, err("Missing session_id"))

    session = get_session(session_id)
    if not session:
        return make_response(404, err("Session not found"))

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

    return make_response(200, ok({"players": safe_players, "count": len(safe_players)}))
