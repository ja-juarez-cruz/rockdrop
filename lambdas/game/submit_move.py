import json
import boto3

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
from aws_lambda_powertools.utilities.idempotency import (
    idempotent_function,
    DynamoDBPersistenceLayer,
    IdempotencyConfig,
)

from db import get_session, moves_table, get_all_players
from ws import broadcast
from models import SubmitMoveRequest, ok, err

logger = Logger()
events_client = boto3.client("events")


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return {"statusCode": 400, "body": json.dumps(err("Missing session_id"))}

    try:
        body = SubmitMoveRequest.model_validate(json.loads(event.get("body", "{}")))
    except Exception as e:
        return {"statusCode": 400, "body": json.dumps(err(str(e)))}

    session = get_session(session_id)
    if not session:
        return {"statusCode": 404, "body": json.dumps(err("Session not found"))}

    if session["status"] != "PLAYING":
        return {"statusCode": 409, "body": json.dumps(err("Session is not in PLAYING status"))}

    pk = f"{session_id}#{body.round_number}"

    try:
        moves_table.put_item(
            Item={
                "pk": pk,
                "player_id": body.player_id,
                "move": body.move,
                "submitted_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "round_number": body.round_number,
            },
            ConditionExpression="attribute_not_exists(player_id)",
        )
    except moves_table.meta.client.exceptions.ConditionalCheckFailedException:
        return {"statusCode": 409, "body": json.dumps(err("Move already submitted for this round"))}

    all_players = get_all_players(session_id)
    active_players = [p for p in all_players if p.get("status") == "CONNECTED"]

    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3
    dynamo = _boto3.resource("dynamodb")
    import os
    moves_resp = dynamo.Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk)
    )
    submitted_count = len(moves_resp.get("Items", []))
    waiting_for = len(active_players) - submitted_count

    broadcast(session_id, "MOVE_SUBMITTED", {
        "player_id": body.player_id,
        "round_number": body.round_number,
        "submitted_count": submitted_count,
        "waiting_for": max(waiting_for, 0),
    })

    if waiting_for <= 0:
        events_client.put_events(Entries=[{
            "Source": "rockdrop.game",
            "DetailType": "AllMovesSubmitted",
            "Detail": json.dumps({
                "session_id": session_id,
                "round_number": body.round_number,
            }),
        }])
        logger.info("All moves submitted, dispatched resolve event",
                    extra={"session_id": session_id, "round_number": body.round_number})

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok({
            "accepted": True,
            "round_number": body.round_number,
            "waiting_for": max(waiting_for, 0),
        })),
    }
