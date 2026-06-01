import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session
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

    bracket = session.get("bracket")
    if not bracket:
        return {"statusCode": 404, "body": json.dumps(err("No bracket generated yet"))}

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok({"bracket": bracket})),
    }
