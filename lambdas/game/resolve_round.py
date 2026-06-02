import json
from datetime import datetime
from decimal import Decimal

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_moves_for_round, rounds_table, players_table, get_all_players
from db import sessions_table
from ws import broadcast

logger = Logger()

BEATS            = {"ROCK": "SCISSORS", "SCISSORS": "PAPER", "PAPER": "ROCK"}
WINS_NEEDED      = 3  # Rondas para ganar un match en torneo (best-of-5)
FFA_WINS_NEEDED  = 3  # Victorias de ronda para ganar en FFA


def _build_next_round(players, tournament_round):
    """Build bracket matches for the next tournament round."""
    import math, random
    n = len(players)
    size = 1
    while size < n:
        size *= 2
    shuffled = players[:]
    random.shuffle(shuffled)
    padded = shuffled + [None] * (size - n)
    matches = []
    for i in range(0, size, 2):
        p1 = padded[i]
        p2 = padded[i + 1]
        mid = f"r{tournament_round}_m{i // 2 + 1}"
        if p2 is None:
            matches.append({
                "match_id": mid, "tournament_round": tournament_round,
                "player1_id": p1["player_id"], "player1_name": p1["display_name"],
                "player1_wins": WINS_NEEDED,
                "player2_id": None, "player2_name": None, "player2_wins": 0,
                "current_match_round": 1, "status": "BYE", "winner_id": p1["player_id"],
            })
        else:
            matches.append({
                "match_id": mid, "tournament_round": tournament_round,
                "player1_id": p1["player_id"], "player1_name": p1["display_name"],
                "player1_wins": 0,
                "player2_id": p2["player_id"], "player2_name": p2["display_name"],
                "player2_wins": 0,
                "current_match_round": 1, "status": "ACTIVE", "winner_id": None,
            })
    return {"matches": matches}


def _rps(move_a, move_b):
    if move_a == move_b:
        return "TIE"
    return "WIN" if BEATS[move_a] == move_b else "LOSE"


# ── Free For All ──────────────────────────────────────────────────────────────

def _resolve_ffa(session_id, round_number):
    moves = get_moves_for_round(session_id, round_number)
    if not moves:
        return

    results = {m["player_id"]: {"move": m["move"], "outcome": "TIE", "wins": 0} for m in moves}

    for i, a in enumerate(moves):
        for b in moves[i + 1:]:
            oc = _rps(a["move"], b["move"])
            if oc == "WIN":
                results[a["player_id"]]["wins"] += 1
            elif oc == "LOSE":
                results[b["player_id"]]["wins"] += 1

    max_wins = max(r["wins"] for r in results.values())
    winners = [pid for pid, r in results.items() if r["wins"] == max_wins]

    for pid, r in results.items():
        r["outcome"] = "WIN" if (r["wins"] == max_wins and len(winners) == 1) else (
            "TIE" if r["wins"] == max_wins else "LOSE"
        )

    winner_id = winners[0] if len(winners) == 1 else None

    rounds_table.put_item(Item={
        "session_id": session_id,
        "round_number": str(round_number),
        "results": results,
        "winner_id": winner_id,
        "resolved_at": datetime.utcnow().isoformat() + "Z",
    })

    # Actualizar puntaje del ganador y verificar si alcanzó FFA_WINS_NEEDED
    champion_id = None
    champion_name = None
    all_players = {p["player_id"]: p for p in get_all_players(session_id)}

    for pid, r in results.items():
        if r["outcome"] == "WIN":
            resp = players_table.update_item(
                Key={"session_id": session_id, "player_id": pid},
                UpdateExpression="ADD score :one",
                ExpressionAttributeValues={":one": 1},
                ReturnValues="ALL_NEW",
            )
            new_score = int(resp.get("Attributes", {}).get("score", 0))
            if new_score >= FFA_WINS_NEEDED and champion_id is None:
                champion_id = pid
                champion_name = all_players.get(pid, {}).get("display_name", "Campeón")
        else:
            players_table.update_item(
                Key={"session_id": session_id, "player_id": pid},
                UpdateExpression="SET score = if_not_exists(score, :zero)",
                ExpressionAttributeValues={":zero": 0},
            )

    broadcast(session_id, "ROUND_RESOLVED", {
        "round_number": round_number,
        "results": results,
        "winner_id": winner_id,
    })

    if champion_id:
        sessions_table.update_item(
            Key={"session_id": session_id, "sk": "METADATA"},
            UpdateExpression="SET #s = :s",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "FINISHED"},
        )
        broadcast(session_id, "CHAMPION_DECLARED", {
            "champion_id": champion_id,
            "champion_name": champion_name,
        })
        logger.info("FFA champion declared", extra={"session_id": session_id, "champion_id": champion_id})


# ── Tournament match ──────────────────────────────────────────────────────────

def _resolve_tournament_match(session_id, match_id, match_round):
    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3, os

    pk = f"{session_id}#{match_id}#{match_round}"
    moves_resp = _boto3.resource("dynamodb").Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk)
    )
    moves = moves_resp.get("Items", [])
    if len(moves) < 2:
        logger.warning("Not enough moves", extra={"pk": pk})
        return

    a, b = moves[0], moves[1]
    oc_a = _rps(a["move"], b["move"])
    oc_b = "LOSE" if oc_a == "WIN" else ("WIN" if oc_a == "LOSE" else "TIE")

    results = {
        a["player_id"]: {"move": a["move"], "outcome": oc_a},
        b["player_id"]: {"move": b["move"], "outcome": oc_b},
    }
    round_winner_id = a["player_id"] if oc_a == "WIN" else (b["player_id"] if oc_a == "LOSE" else None)

    # ── Load session and bracket ──────────────────────────────────────────────
    from db import get_session
    session = get_session(session_id)
    if not session:
        return

    bracket = session.get("bracket", {})
    matches = bracket.get("matches", [])
    wins_needed = int(bracket.get("wins_needed", 2))

    # ── Find and update the match ─────────────────────────────────────────────
    my_match = next((m for m in matches if m["match_id"] == match_id), None)
    if not my_match:
        return

    # Increment win counter for round winner (ties don't count)
    if round_winner_id:
        if my_match["player1_id"] == round_winner_id:
            my_match["player1_wins"] = int(my_match.get("player1_wins", 0)) + 1
        else:
            my_match["player2_wins"] = int(my_match.get("player2_wins", 0)) + 1

    match_score = {
        my_match["player1_id"]: int(my_match["player1_wins"]),
        my_match["player2_id"]: int(my_match["player2_wins"]),
    }

    # ── Broadcast round result ────────────────────────────────────────────────
    broadcast(session_id, "ROUND_RESOLVED", {
        "round_number": match_round,
        "match_id": match_id,
        "results": results,
        "winner_id": round_winner_id,
        "match_score": match_score,
    })

    # ── Check if match is complete ────────────────────────────────────────────
    p1_wins = int(my_match["player1_wins"])
    p2_wins = int(my_match["player2_wins"])
    match_winner_id = None

    if p1_wins >= wins_needed:
        match_winner_id = my_match["player1_id"]
    elif p2_wins >= wins_needed:
        match_winner_id = my_match["player2_id"]

    if match_winner_id:
        match_loser_id = (
            my_match["player2_id"]
            if match_winner_id == my_match["player1_id"]
            else my_match["player1_id"]
        )
        my_match["status"] = "COMPLETE"
        my_match["winner_id"] = match_winner_id

        # Award a point to the match winner
        players_table.update_item(
            Key={"session_id": session_id, "player_id": match_winner_id},
            UpdateExpression="ADD score :one",
            ExpressionAttributeValues={":one": 1},
        )

        broadcast(session_id, "MATCH_FINISHED", {
            "match_id": match_id,
            "winner_id": match_winner_id,
            "loser_id": match_loser_id,
            "winner_name": my_match["player1_name"] if match_winner_id == my_match["player1_id"] else my_match["player2_name"],
            "loser_name":  my_match["player2_name"] if match_winner_id == my_match["player1_id"] else my_match["player1_name"],
            "score": match_score,
        })

        # ── Check if all matches in this tournament round are done ────────────
        current_tr = int(bracket.get("current_tournament_round", 1))
        round_matches = [m for m in matches if int(m["tournament_round"]) == current_tr]
        all_done = all(m["status"] in ("COMPLETE", "BYE") for m in round_matches)

        if all_done:
            total_rounds = int(bracket.get("total_tournament_rounds", 1))
            winners = [m["winner_id"] for m in round_matches if m["winner_id"]]

            if len(winners) == 1 or current_tr >= total_rounds:
                # Champion!
                champion_id = winners[0]
                bracket["champion_id"] = champion_id

                sessions_table.update_item(
                    Key={"session_id": session_id, "sk": "METADATA"},
                    UpdateExpression="SET bracket = :b, #s = :s",
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":b": bracket, ":s": "FINISHED"},
                )

                champion_player = next(
                    (m["player1_name"] if m["player1_id"] == champion_id else m["player2_name"]
                     for m in round_matches if m["winner_id"] == champion_id),
                    "Campeón"
                )

                broadcast(session_id, "CHAMPION_DECLARED", {
                    "champion_id": champion_id,
                    "champion_name": champion_player,
                })
                return

            else:
                # Set up next tournament round
                next_tr = current_tr + 1
                winner_players = []
                for wid in winners:
                    for m in round_matches:
                        if m["winner_id"] == wid:
                            name = m["player1_name"] if wid == m["player1_id"] else m["player2_name"]
                            winner_players.append({"player_id": wid, "display_name": name})
                            break

                new_bracket_data = _build_next_round(winner_players, next_tr)
                bracket["current_tournament_round"] = next_tr
                bracket["matches"] = matches + new_bracket_data["matches"]

                sessions_table.update_item(
                    Key={"session_id": session_id, "sk": "METADATA"},
                    UpdateExpression="SET bracket = :b, current_round = :r",
                    ExpressionAttributeValues={":b": bracket, ":r": 1},
                )

                broadcast(session_id, "TOURNAMENT_ROUND_COMPLETE", {
                    "next_tournament_round": next_tr,
                    "new_matches": new_bracket_data["matches"],
                    "bracket": bracket,
                })
                return
    else:
        # Match continues — increment match round
        my_match["current_match_round"] = match_round + 1

    # Save updated bracket
    sessions_table.update_item(
        Key={"session_id": session_id, "sk": "METADATA"},
        UpdateExpression="SET bracket = :b",
        ExpressionAttributeValues={":b": bracket},
    )


# ── Handler ───────────────────────────────────────────────────────────────────

@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    detail = event.get("detail", event)
    session_id  = detail["session_id"]
    round_number = int(detail["round_number"])
    mode        = detail.get("mode", "FREE_FOR_ALL")
    match_id    = detail.get("match_id")

    if mode == "TOURNAMENT" and match_id:
        _resolve_tournament_match(session_id, match_id, round_number)
    else:
        _resolve_ffa(session_id, round_number)

    return {"resolved": True}
