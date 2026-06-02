import json
import math
import random

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, sessions_table, get_all_players
from ws import broadcast
from models import ok, err, make_response

logger = Logger()

WINS_NEEDED    = 3
TOURNAMENT_MIN = 4


# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_power_of_two(n):
    if n <= 1:
        return 2
    p = 1
    while p < n:
        p *= 2
    return p


def _fill_slot(from_match_id, winner_id, winner_name, all_matches):
    """Propagate a known winner into the next match that awaits this match's winner."""
    for m in all_matches:
        if from_match_id not in m.get("source_matches", []):
            continue
        idx = m["source_matches"].index(from_match_id)
        if idx == 0:
            m["player1_id"]   = winner_id
            m["player1_name"] = winner_name
        else:
            m["player2_id"]   = winner_id
            m["player2_name"] = winner_name
        if m["player1_id"] and m["player2_id"]:
            m["status"] = "ACTIVE"
        break


# ── Full bracket builder ──────────────────────────────────────────────────────

def build_bracket(players):
    """
    Generate the complete elimination bracket upfront.
    All future-round match slots are pre-created with PENDING status and
    source_matches pointers so the UI can render the full tree from day 1.
    """
    n = len(players)
    size = _next_power_of_two(n)
    total_rounds = int(math.log2(size))

    shuffled = players[:]
    random.shuffle(shuffled)
    padded = shuffled + [None] * (size - n)

    all_matches = []

    # ── Round 1: pair real players + BYEs ────────────────────────────────────
    for i in range(size // 2):
        p1, p2 = padded[i * 2], padded[i * 2 + 1]
        mid = f"r1_m{i + 1}"

        if p1 is None and p2 is None:
            continue  # skip double-empty slots (shouldn't occur)

        if p1 is None or p2 is None:
            real = p1 if p1 else p2
            all_matches.append({
                "match_id": mid, "tournament_round": 1,
                "player1_id": real["player_id"], "player1_name": real["display_name"],
                "player1_wins": WINS_NEEDED,
                "player2_id": None, "player2_name": None, "player2_wins": 0,
                "current_match_round": 1, "status": "BYE",
                "winner_id": real["player_id"], "source_matches": [],
            })
        else:
            all_matches.append({
                "match_id": mid, "tournament_round": 1,
                "player1_id": p1["player_id"], "player1_name": p1["display_name"],
                "player1_wins": 0,
                "player2_id": p2["player_id"], "player2_name": p2["display_name"],
                "player2_wins": 0,
                "current_match_round": 1, "status": "ACTIVE",
                "winner_id": None, "source_matches": [],
            })

    # ── Rounds 2+: pre-generate PENDING slots with source pointers ────────────
    prev_count = size // 2
    for r in range(2, total_rounds + 1):
        curr_count = prev_count // 2
        for i in range(curr_count):
            src1 = f"r{r - 1}_m{i * 2 + 1}"
            src2 = f"r{r - 1}_m{i * 2 + 2}"
            mid  = f"r{r}_m{i + 1}"
            all_matches.append({
                "match_id": mid, "tournament_round": r,
                "player1_id": None, "player1_name": f"Ganador {src1}",
                "player1_wins": 0,
                "player2_id": None, "player2_name": f"Ganador {src2}",
                "player2_wins": 0,
                "current_match_round": 1, "status": "PENDING",
                "winner_id": None, "source_matches": [src1, src2],
            })
        prev_count = curr_count

    # ── Propagate BYE winners immediately ────────────────────────────────────
    for m in all_matches:
        if m["status"] == "BYE" and m["winner_id"]:
            wname = m["player1_name"] if m["winner_id"] == m["player1_id"] else m["player2_name"]
            _fill_slot(m["match_id"], m["winner_id"], wname, all_matches)

    return {
        "wins_needed":              WINS_NEEDED,
        "current_tournament_round": 1,
        "total_tournament_rounds":  total_rounds,
        "matches":                  all_matches,
        "champion_id":              None,
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
            "rounds": bracket["total_tournament_rounds"],
        })

        return make_response(200, ok({
            "session_id": session_id,
            "status": "PLAYING",
            "mode": "TOURNAMENT",
            "bracket": bracket,
        }))

    else:
        sessions_table.update_item(
            Key={"session_id": session_id, "sk": "METADATA"},
            UpdateExpression="SET #s = :s, #m = :m, current_round = :r",
            ExpressionAttributeNames={"#s": "status", "#m": "mode"},
            ExpressionAttributeValues={":s": "PLAYING", ":m": "FREE_FOR_ALL", ":r": 1},
        )

        broadcast(session_id, "GAME_STARTED", {"session_id": session_id, "mode": "FREE_FOR_ALL"})
        logger.info("FFA started", extra={"session_id": session_id, "players": len(players)})

        return make_response(200, ok({"session_id": session_id, "status": "PLAYING", "mode": "FREE_FOR_ALL"}))
