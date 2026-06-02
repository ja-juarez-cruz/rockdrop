import json
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

def _group_sizes(n):
    """
    Split n players into match groups.
    When n is odd: one group of 3 + remaining groups of 2 (no BYEs).
    When n is even: all groups of 2.
    """
    if n % 2 == 0:
        return [2] * (n // 2)
    return [3] + [2] * ((n - 3) // 2)


def _total_rounds_needed(n):
    """Compute how many tournament rounds reduce n players to 1 winner."""
    rounds = 0
    current = n
    while current > 1:
        current = len(_group_sizes(current))
        rounds += 1
    return rounds


def _fill_slot(from_match_id, winner_id, winner_name, all_matches):
    """Propagate a known winner into the downstream match that awaits this match's winner."""
    for m in all_matches:
        sources = m.get("source_matches", [])
        if from_match_id not in sources:
            continue
        idx = sources.index(from_match_id)
        key = f"player{idx + 1}"
        m[f"{key}_id"]   = winner_id
        m[f"{key}_name"] = winner_name
        player_count = int(m.get("player_count", 2))
        if all(m.get(f"player{k}_id") for k in range(1, player_count + 1)):
            m["status"] = "ACTIVE"
        break


# ── Full bracket builder ──────────────────────────────────────────────────────

def build_bracket(players):
    """
    Generate the complete elimination bracket upfront.
    When the player count is odd, one first-round match gets 3 players (FFA
    sub-match) so no BYEs are ever needed.  Future-round match slots are
    pre-created with PENDING status and source_matches pointers so the UI can
    render the full tree from day 1.
    """
    n = len(players)
    total_rounds = _total_rounds_needed(n)

    shuffled = players[:]
    random.shuffle(shuffled)

    all_matches = []

    # ── Round 1: assign real players to groups ────────────────────────────────
    groups = _group_sizes(n)
    player_idx = 0
    for i, group_size in enumerate(groups):
        mid   = f"r1_m{i + 1}"
        group = shuffled[player_idx: player_idx + group_size]
        player_idx += group_size

        match = {
            "match_id": mid, "tournament_round": 1,
            "player1_id":   group[0]["player_id"],   "player1_name": group[0]["display_name"], "player1_wins": 0,
            "player2_id":   group[1]["player_id"],   "player2_name": group[1]["display_name"], "player2_wins": 0,
            "player_count": group_size,
            "current_match_round": 1, "status": "ACTIVE",
            "winner_id": None, "source_matches": [],
        }
        if group_size == 3:
            match["player3_id"]   = group[2]["player_id"]
            match["player3_name"] = group[2]["display_name"]
            match["player3_wins"] = 0

        all_matches.append(match)

    # ── Rounds 2+: pre-generate PENDING slots with source pointers ────────────
    prev_round_ids = [f"r1_m{i + 1}" for i in range(len(groups))]

    for r in range(2, total_rounds + 1):
        curr_groups = _group_sizes(len(prev_round_ids))
        src_idx = 0
        new_round_ids = []
        for i, group_size in enumerate(curr_groups):
            mid      = f"r{r}_m{i + 1}"
            src_ids  = prev_round_ids[src_idx: src_idx + group_size]
            src_idx += group_size
            new_round_ids.append(mid)

            match = {
                "match_id": mid, "tournament_round": r,
                "player1_id":   None, "player1_name": f"Ganador {src_ids[0]}", "player1_wins": 0,
                "player2_id":   None, "player2_name": f"Ganador {src_ids[1]}", "player2_wins": 0,
                "player_count": group_size,
                "current_match_round": 1, "status": "PENDING",
                "winner_id": None, "source_matches": src_ids,
            }
            if group_size == 3:
                match["player3_id"]   = None
                match["player3_name"] = f"Ganador {src_ids[2]}"
                match["player3_wins"] = 0

            all_matches.append(match)

        prev_round_ids = new_round_ids

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
