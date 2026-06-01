import json
import math
import random

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, sessions_table, get_all_players
from ws import broadcast
from models import ok, err, make_response

logger = Logger()

WINS_NEEDED = 2       # Rondas para ganar un match en torneo (best-of-3)
TOURNAMENT_MIN = 4    # Mínimo de jugadores para activar modo torneo


# ── Bracket builder ───────────────────────────────────────────────────────────

def _next_power_of_two(n):
    if n <= 1:
        return 2
    p = 1
    while p < n:
        p *= 2
    return p


def build_bracket(players, tournament_round=1):
    size = _next_power_of_two(len(players))
    shuffled = players[:]
    random.shuffle(shuffled)
    padded = shuffled + [None] * (size - len(shuffled))

    matches = []
    for i in range(0, size, 2):
        p1 = padded[i]
        p2 = padded[i + 1]
        mid = f"r{tournament_round}_m{i // 2 + 1}"
        if p2 is None:
            matches.append({
                "match_id": mid,
                "tournament_round": tournament_round,
                "player1_id": p1["player_id"],
                "player1_name": p1["display_name"],
                "player1_wins": WINS_NEEDED,
                "player2_id": None,
                "player2_name": None,
                "player2_wins": 0,
                "current_match_round": 1,
                "status": "BYE",
                "winner_id": p1["player_id"],
            })
        else:
            matches.append({
                "match_id": mid,
                "tournament_round": tournament_round,
                "player1_id": p1["player_id"],
                "player1_name": p1["display_name"],
                "player1_wins": 0,
                "player2_id": p2["player_id"],
                "player2_name": p2["display_name"],
                "player2_wins": 0,
                "current_match_round": 1,
                "status": "ACTIVE",
                "winner_id": None,
            })

    return {
        "wins_needed": WINS_NEEDED,
        "current_tournament_round": tournament_round,
        "total_tournament_rounds": int(math.log2(size)),
        "matches": matches,
        "champion_id": None,
    }


# ── Handler ───────────────────────────────────────────────────────────────────

@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return make_response(400, err("Missing session_id"))

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return make_response(400, err("Invalid JSON"))

    session = get_session(session_id)
    if not session:
        return make_response(404, err("Session not found"))

    if session.get("host_player_id") != body.get("host_player_id"):
        return make_response(403, err("Only the host can start the session"))

    if session.get("status") != "WAITING":
        return make_response(409, err(f"Session is already {session.get('status')}"))

    players = get_all_players(session_id)
    if len(players) < 2:
        return make_response(409, err("Need at least 2 players to start"))

    # Modo determinado automáticamente por el número de jugadores
    mode = "TOURNAMENT" if len(players) >= TOURNAMENT_MIN else "FREE_FOR_ALL"

    if mode == "TOURNAMENT":
        bracket = build_bracket(players)

        sessions_table.update_item(
            Key={"session_id": session_id, "sk": "METADATA"},
            UpdateExpression="SET #s = :s, #m = :m, current_round = :r, bracket = :b",
            ExpressionAttributeNames={"#s": "status", "#m": "mode"},
            ExpressionAttributeValues={":s": "PLAYING", ":m": "TOURNAMENT", ":r": 1, ":b": bracket},
        )

        broadcast(session_id, "GAME_STARTED", {
            "session_id": session_id,
            "mode": "TOURNAMENT",
            "bracket": bracket,
        })

        logger.info("Tournament started", extra={
            "session_id": session_id,
            "players": len(players),
            "matches": len(bracket["matches"]),
        })

        return make_response(200, ok({
            "session_id": session_id,
            "status": "PLAYING",
            "mode": "TOURNAMENT",
            "bracket": bracket,
        }))

    else:  # FREE_FOR_ALL
        sessions_table.update_item(
            Key={"session_id": session_id, "sk": "METADATA"},
            UpdateExpression="SET #s = :s, #m = :m, current_round = :r",
            ExpressionAttributeNames={"#s": "status", "#m": "mode"},
            ExpressionAttributeValues={":s": "PLAYING", ":m": "FREE_FOR_ALL", ":r": 1},
        )

        broadcast(session_id, "GAME_STARTED", {"session_id": session_id, "mode": "FREE_FOR_ALL"})
        logger.info("FFA started", extra={"session_id": session_id, "players": len(players)})

        return make_response(200, ok({"session_id": session_id, "status": "PLAYING", "mode": "FREE_FOR_ALL"}))
