import json
from datetime import datetime

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_moves_for_round, rounds_table, players_table, get_all_players
from ws import broadcast

logger = Logger()

BEATS = {"ROCK": "SCISSORS", "SCISSORS": "PAPER", "PAPER": "ROCK"}


def resolve(move_a: str, move_b: str) -> str:
    if move_a == move_b:
        return "TIE"
    return "WIN" if BEATS[move_a] == move_b else "LOSE"


def resolve_free_for_all(moves: list[dict]) -> dict:
    """Each player is compared against all others; most wins takes the round."""
    results = {m["player_id"]: {"move": m["move"], "outcome": "TIE", "wins": 0} for m in moves}

    for i, a in enumerate(moves):
        for b in moves[i + 1:]:
            outcome_a = resolve(a["move"], b["move"])
            if outcome_a == "WIN":
                results[a["player_id"]]["wins"] += 1
            elif outcome_a == "LOSE":
                results[b["player_id"]]["wins"] += 1

    max_wins = max(r["wins"] for r in results.values()) if results else 0
    winners = [pid for pid, r in results.items() if r["wins"] == max_wins]

    for pid, r in results.items():
        if r["wins"] == max_wins and len(winners) == 1:
            r["outcome"] = "WIN"
        elif r["wins"] == max_wins:
            r["outcome"] = "TIE"
        else:
            r["outcome"] = "LOSE"

    winner_id = winners[0] if len(winners) == 1 else None
    return {"results": results, "winner_id": winner_id}


def resolve_tournament(moves: list[dict]) -> dict:
    """1v1 match resolution."""
    if len(moves) != 2:
        return resolve_free_for_all(moves)

    a, b = moves[0], moves[1]
    outcome_a = resolve(a["move"], b["move"])

    results = {
        a["player_id"]: {"move": a["move"], "outcome": outcome_a},
        b["player_id"]: {"move": b["move"], "outcome": "LOSE" if outcome_a == "WIN" else ("WIN" if outcome_a == "LOSE" else "TIE")},
    }
    winner_id = a["player_id"] if outcome_a == "WIN" else (b["player_id"] if outcome_a == "LOSE" else None)
    return {"results": results, "winner_id": winner_id}


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    detail = event.get("detail", event)
    session_id = detail["session_id"]
    round_number = int(detail["round_number"])

    moves = get_moves_for_round(session_id, round_number)
    if not moves:
        logger.warning("No moves found", extra={"session_id": session_id, "round_number": round_number})
        return {"resolved": False}

    from db import get_session
    session = get_session(session_id)
    mode = session.get("mode", "FREE_FOR_ALL") if session else "FREE_FOR_ALL"

    if mode == "TOURNAMENT":
        resolution = resolve_tournament(moves)
    else:
        resolution = resolve_free_for_all(moves)

    now = datetime.utcnow().isoformat() + "Z"

    rounds_table.put_item(Item={
        "session_id": session_id,
        "round_number": str(round_number),
        "results": resolution["results"],
        "winner_id": resolution.get("winner_id"),
        "resolved_at": now,
    })

    for player_id, result in resolution["results"].items():
        if result.get("outcome") == "WIN":
            players_table.update_item(
                Key={"session_id": session_id, "player_id": player_id},
                UpdateExpression="ADD score :one",
                ExpressionAttributeValues={":one": 1},
            )

    broadcast(session_id, "ROUND_RESOLVED", {
        "round_number": round_number,
        "results": resolution["results"],
        "winner_id": resolution.get("winner_id"),
    })

    logger.info("Round resolved", extra={
        "session_id": session_id,
        "round_number": round_number,
        "winner_id": resolution.get("winner_id"),
    })

    return {"resolved": True, "round_number": round_number, "winner_id": resolution.get("winner_id")}
