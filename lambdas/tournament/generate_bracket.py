import json
import math
import random

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, get_all_players, sessions_table
from ws import broadcast
from models import ok, err

logger = Logger()


def next_power_of_two(n: int) -> int:
    return 2 ** math.ceil(math.log2(n)) if n > 1 else 2


def build_bracket(players: list[dict]) -> dict:
    size = next_power_of_two(len(players))
    shuffled = players[:]
    random.shuffle(shuffled)

    byes_needed = size - len(shuffled)
    padded = shuffled + [None] * byes_needed

    matches = []
    for i in range(0, size, 2):
        p1 = padded[i]
        p2 = padded[i + 1]
        matches.append({
            "match_id": f"r1_m{i // 2 + 1}",
            "round": 1,
            "player1": {"player_id": p1["player_id"], "display_name": p1["display_name"]} if p1 else None,
            "player2": {"player_id": p2["player_id"], "display_name": p2["display_name"]} if p2 else None,
            "winner_id": p1["player_id"] if p2 is None else None,
            "status": "BYE" if p2 is None else "PENDING",
        })

    return {
        "size": size,
        "total_rounds": int(math.log2(size)),
        "current_round": 1,
        "matches": matches,
    }


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return {"statusCode": 400, "body": json.dumps(err("Missing session_id"))}

    session = get_session(session_id)
    if not session:
        return {"statusCode": 404, "body": json.dumps(err("Session not found"))}

    if session.get("mode") != "TOURNAMENT":
        return {"statusCode": 409, "body": json.dumps(err("Session is not in TOURNAMENT mode"))}

    players = get_all_players(session_id)
    if len(players) < 2:
        return {"statusCode": 409, "body": json.dumps(err("Need at least 2 players"))}

    bracket = build_bracket(players)

    sessions_table.update_item(
        Key={"session_id": session_id, "sk": "METADATA"},
        UpdateExpression="SET bracket = :b, #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":b": bracket, ":s": "PLAYING"},
    )

    broadcast(session_id, "BRACKET_UPDATED", {"bracket": bracket})
    logger.info("Bracket generated", extra={"session_id": session_id, "size": bracket["size"]})

    return {
        "statusCode": 201,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(ok({"bracket": bracket})),
    }
