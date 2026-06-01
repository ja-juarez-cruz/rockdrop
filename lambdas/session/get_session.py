import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session
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

    session.pop("qr_token", None)

    return make_response(200, ok(session))
