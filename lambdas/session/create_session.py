import json
import uuid
import os
from datetime import datetime, timezone, timedelta

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import sessions_table, players_table
from auth import create_qr_token
from models import CreateSessionRequest, ok, err, make_response

logger = Logger()

WS_API_ID   = os.environ[\"WS_API_ID\"]
WS_STAGE = os.environ.get("WS_STAGE", "prod")
REGION = os.environ.get("AWS_REGION", "us-east-1")


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    try:
        body = CreateSessionRequest.model_validate(json.loads(event.get("body", "{}")))
    except Exception as e:
        return make_response(400, err(str(e)))

    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"
    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())
    qr_token = create_qr_token(session_id)

    ws_url = f"wss://{WS_API_ID}.execute-api.{REGION}.amazonaws.com/{WS_STAGE}"
    join_url = f"{WEB_APP_URL}/#/join?token={qr_token}" if WEB_APP_URL else f"/#/join?token={qr_token}"

    sessions_table.put_item(Item={
        "session_id": session_id,
        "sk": "METADATA",
        "host_player_id": body.host_player_id,
        "status": "WAITING",
        "mode": body.mode,
        "max_players": body.max_players,
        "current_round": 0,
        "created_at": now,
        "expires_at": expires_at,
        "qr_token": qr_token,
    })

    players_table.put_item(Item={
        "session_id": session_id,
        "player_id": body.host_player_id,
        "display_name": body.display_name,
        "is_host": True,
        "score": 0,
        "status": "DISCONNECTED",
        "joined_at": now,
    })

    logger.info("Session created", extra={"session_id": session_id})

    return make_response(201, ok({
            "session_id": session_id,
            "qr_token": qr_token,
            "ws_url": ws_url,
            "join_url": join_url,
        }))
