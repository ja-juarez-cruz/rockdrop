import json

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from ws import send_to_player

logger = Logger()


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    connection_id = event["requestContext"]["connectionId"]

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return {"statusCode": 400, "body": "Invalid JSON"}

    send_to_player(connection_id, "ECHO", body)
    return {"statusCode": 200, "body": "OK"}
