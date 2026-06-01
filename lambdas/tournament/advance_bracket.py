import json
import math

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, sessions_table, rounds_table
from ws import broadcast
from models import ok, err, make_response

logger = Logger()


def advance(bracket: dict, round_results: list[dict]) -> dict:
    """Moves winners from current round into the next round matches."""
    current_round = bracket["current_round"]
    current_matches = [m for m in bracket["matches"] if m["round"] == current_round]

    winners = []
    for match in current_matches:
        result = next((r for r in round_results if r.get("match_id") == match["match_id"]), None)
        winner_id = result["winner_id"] if result else match.get("winner_id")
        match["winner_id"] = winner_id
        match["status"] = "DONE"
        if winner_id:
            winners.append(winner_id)

    if len(winners) <= 1:
        bracket["status"] = "FINISHED"
        bracket["champion_id"] = winners[0] if winners else None
        return bracket

    next_round = current_round + 1
    bracket["current_round"] = next_round

    for i in range(0, len(winners), 2):
        p1_id = winners[i]
        p2_id = winners[i + 1] if i + 1 < len(winners) else None
        bracket["matches"].append({
            "match_id": f"r{next_round}_m{i // 2 + 1}",
            "round": next_round,
            "player1": {"player_id": p1_id},
            "player2": {"player_id": p2_id} if p2_id else None,
            "winner_id": p1_id if p2_id is None else None,
            "status": "BYE" if p2_id is None else "PENDING",
        })

    return bracket


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return make_response(400, err("Missing session_id"))

    session = get_session(session_id)
    if not session:
        return make_response(404, err("Session not found"))

    bracket = session.get("bracket")
    if not bracket:
        return make_response(409, err("No bracket found — generate it first"))

    current_round = bracket["current_round"]
    resp = rounds_table.get_item(Key={"session_id": session_id, "round_number": str(current_round)})
    round_data = resp.get("Item", {})
    round_results = round_data.get("match_results", [])

    updated_bracket = advance(bracket, round_results)

    sessions_table.update_item(
        Key={"session_id": session_id, "sk": "METADATA"},
        UpdateExpression="SET bracket = :b",
        ExpressionAttributeValues={":b": updated_bracket},
    )

    event_name = "GAME_FINISHED" if updated_bracket.get("status") == "FINISHED" else "BRACKET_UPDATED"
    broadcast(session_id, event_name, {"bracket": updated_bracket})

    logger.info("Bracket advanced", extra={"session_id": session_id, "next_round": updated_bracket.get("current_round")})

    return make_response(200, ok({"bracket": updated_bracket}))
