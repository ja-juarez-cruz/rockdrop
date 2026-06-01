import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import rounds_table, get_session
from models import ok, err

logger = Logger()


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    path_params = event.get("pathParameters", {})
    session_id = path_params.get("session_id")
    round_number = path_params.get("round")

    if not session_id or not round_number:
        return {"statusCode": 400, "body": json.dumps(err("Missing session_id or round"))}

    session = get_session(session_id)
    if not session:
        return {"statusCode": 404, "body": json.dumps(err("Session not found"))}

    resp = rounds_table.get_item(Key={"session_id": session_id, "round_number": str(round_number)})
    round_data = resp.get("Item")

    if not round_data:
        return {"statusCode": 404, "body": json.dumps(err("Round not found or not yet resolved"))}

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok(round_data)),
    }
