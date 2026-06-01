import json
import uuid
from datetime import datetime

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
from jose import JWTError

from db import get_session, players_table, get_all_players
from auth import validate_qr_token
from ws import broadcast
from models import JoinSessionRequest, ok, err

logger = Logger()

WS_API_ID = __import__("os").environ["WS_API_ID"]
WS_STAGE = __import__("os").environ.get("WS_STAGE", "prod")
REGION = __import__("os").environ.get("AWS_REGION", "us-east-1")


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return {"statusCode": 400, "body": json.dumps(err("Missing session_id"))}

    try:
        body = JoinSessionRequest.model_validate(json.loads(event.get("body", "{}")))
    except Exception as e:
        return {"statusCode": 400, "body": json.dumps(err(str(e)))}

    try:
        claims = validate_qr_token(body.token)
    except JWTError as e:
        return {"statusCode": 401, "body": json.dumps(err(f"Invalid or expired token: {e}"))}

    if claims.get("session_id") != session_id:
        return {"statusCode": 403, "body": json.dumps(err("Token does not match session"))}

    session = get_session(session_id)
    if not session:
        return {"statusCode": 404, "body": json.dumps(err("Session not found"))}

    if session["status"] != "WAITING":
        return {"statusCode": 409, "body": json.dumps(err("Session is not accepting players"))}

    current_players = get_all_players(session_id)
    if len(current_players) >= int(session["max_players"]):
        return {"statusCode": 409, "body": json.dumps(err("Session is full"))}

    player_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"
    ws_url = f"wss://{WS_API_ID}.execute-api.{REGION}.amazonaws.com/{WS_STAGE}"

    players_table.put_item(Item={
        "session_id": session_id,
        "player_id": player_id,
        "display_name": body.display_name,
        "is_host": False,
        "score": 0,
        "status": "DISCONNECTED",
        "joined_at": now,
    })

    broadcast(session_id, "PLAYER_JOINED", {
        "player_id": player_id,
        "display_name": body.display_name,
        "total_players": len(current_players) + 1,
    })

    logger.info("Player joined", extra={"session_id": session_id, "player_id": player_id})

    return {
        "statusCode": 201,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok({
            "player_id": player_id,
            "session_id": session_id,
            "display_name": body.display_name,
            "ws_url": ws_url,
        })),
    }
