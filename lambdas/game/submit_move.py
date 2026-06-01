import json
import boto3
from datetime import datetime

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, moves_table, get_all_players
from ws import broadcast
from models import SubmitMoveRequest, ok, err, make_response, json_dumps

logger = Logger()
events_client = boto3.client("events")


def _submit_tournament(session_id, body, session):
    """Handle move submission for a 1v1 tournament match."""
    bracket = session.get("bracket", {})
    matches = bracket.get("matches", [])

    # Find the player's active match
    my_match = None
    for m in matches:
        if m.get("status") == "ACTIVE" and (
            m.get("player1_id") == body.player_id or
            m.get("player2_id") == body.player_id
        ):
            my_match = m
            break

    if not my_match:
        return make_response(409, err("No active match found for this player"))

    match_id = my_match["match_id"]
    match_round = my_match["current_match_round"]
    opponent_id = (
        my_match["player2_id"]
        if my_match["player1_id"] == body.player_id
        else my_match["player1_id"]
    )

    pk = f"{session_id}#{match_id}#{match_round}"

    # Record the move
    try:
        moves_table.put_item(
            Item={
                "pk": pk,
                "player_id": body.player_id,
                "move": body.move,
                "submitted_at": datetime.utcnow().isoformat() + "Z",
                "round_number": match_round,
                "match_id": match_id,
            },
            ConditionExpression="attribute_not_exists(player_id)",
        )
    except moves_table.meta.client.exceptions.ConditionalCheckFailedException:
        return make_response(409, err("Move already submitted for this round"))

    # Check if opponent has also submitted
    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3
    import os
    resp = _boto3.resource("dynamodb").Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk)
    )
    moves_count = len(resp.get("Items", []))
    waiting_for = 2 - moves_count

    broadcast(session_id, "MOVE_SUBMITTED", {
        "player_id": body.player_id,
        "match_id": match_id,
        "round_number": match_round,
        "submitted_count": moves_count,
        "waiting_for": max(waiting_for, 0),
    })

    if waiting_for <= 0:
        events_client.put_events(Entries=[{
            "Source": "rockdrop.game",
            "DetailType": "AllMovesSubmitted",
            "Detail": json_dumps({
                "session_id": session_id,
                "round_number": match_round,
                "match_id": match_id,
                "mode": "TOURNAMENT",
            }),
        }])

    return make_response(200, ok({
        "accepted": True,
        "match_id": match_id,
        "round_number": match_round,
        "waiting_for": max(waiting_for, 0),
    }))


def _submit_free_for_all(session_id, body, session):
    """Handle move submission for a free-for-all session."""
    pk = f"{session_id}#{body.round_number}"

    try:
        moves_table.put_item(
            Item={
                "pk": pk,
                "player_id": body.player_id,
                "move": body.move,
                "submitted_at": datetime.utcnow().isoformat() + "Z",
                "round_number": body.round_number,
            },
            ConditionExpression="attribute_not_exists(player_id)",
        )
    except moves_table.meta.client.exceptions.ConditionalCheckFailedException:
        return make_response(409, err("Move already submitted for this round"))

    all_players = get_all_players(session_id)
    active = [p for p in all_players if p.get("status") == "CONNECTED"]

    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3
    import os
    moves_resp = _boto3.resource("dynamodb").Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk)
    )
    submitted = len(moves_resp.get("Items", []))
    waiting_for = len(active) - submitted

    broadcast(session_id, "MOVE_SUBMITTED", {
        "player_id": body.player_id,
        "round_number": body.round_number,
        "submitted_count": submitted,
        "waiting_for": max(waiting_for, 0),
    })

    if waiting_for <= 0:
        events_client.put_events(Entries=[{
            "Source": "rockdrop.game",
            "DetailType": "AllMovesSubmitted",
            "Detail": json_dumps({
                "session_id": session_id,
                "round_number": body.round_number,
                "mode": "FREE_FOR_ALL",
            }),
        }])

    return make_response(200, ok({
        "accepted": True,
        "round_number": body.round_number,
        "waiting_for": max(waiting_for, 0),
    }))


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return make_response(400, err("Missing session_id"))

    try:
        body = SubmitMoveRequest.model_validate(json.loads(event.get("body", "{}")))
    except Exception as e:
        return make_response(400, err(str(e)))

    session = get_session(session_id)
    if not session:
        return make_response(404, err("Session not found"))

    if session.get("status") != "PLAYING":
        return make_response(409, err("Session is not in PLAYING status"))

    mode = session.get("mode", "FREE_FOR_ALL")

    if mode == "TOURNAMENT":
        return _submit_tournament(session_id, body, session)
    else:
        return _submit_free_for_all(session_id, body, session)
