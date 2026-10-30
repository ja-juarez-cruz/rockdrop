import json
import random
import time
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

    # Conditional put makes duplicate AllMovesSubmitted events a no-op
    try:
        rounds_table.put_item(
            Item={
                "session_id": session_id,
                "round_number": str(round_number),
                "results": results,
                "winner_id": winner_id,
                "resolved_at": datetime.utcnow().isoformat() + "Z",
            },
            ConditionExpression="attribute_not_exists(round_number)",
        )
    except rounds_table.meta.client.exceptions.ConditionalCheckFailedException:
        logger.info("FFA round already resolved", extra={"session_id": session_id, "round_number": round_number})
        return

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


# ── Tournament helpers ────────────────────────────────────────────────────────

def _fill_winner_slot(from_match_id, winner_id, winner_name, all_matches):
    """Fill the pre-built slot in the downstream match with the known winner."""
    for m in all_matches:
        if from_match_id not in m.get("source_matches", []):
            continue
        slot = m["source_matches"].index(from_match_id) + 1
        m[f"player{slot}_id"]   = winner_id
        m[f"player{slot}_name"] = winner_name
        player_count = int(m.get("player_count", 2))
        if all(m.get(f"player{k}_id") for k in range(1, player_count + 1)):
            m["status"] = "ACTIVE"
        break


# ── Tournament match ──────────────────────────────────────────────────────────
#
# The whole bracket lives in one session item and every match of a tournament
# round resolves in parallel, so writes use optimistic locking on
# bracket_version: read (consistent) → apply → conditional write → retry on
# conflict.  Applying is idempotent (the match must still be ACTIVE on the same
# current_match_round), so duplicate AllMovesSubmitted events and Lambda retries
# are no-ops.  Broadcasts happen only after the write succeeds.

MAX_WRITE_ATTEMPTS = 20


def _apply_match_round(bracket, match_id, match_round, moves):
    """
    Apply one resolved round of a tournament match to the bracket (in place).

    Returns the list of (event, payload) broadcasts plus the side effects to
    persist, or None when the round was already applied or is not resolvable.
    """
    matches = bracket.get("matches", [])
    wins_needed = int(bracket.get("wins_needed", WINS_NEEDED))

    my_match = next((m for m in matches if m["match_id"] == match_id), None)
    if not my_match:
        return None
    if my_match.get("status") != "ACTIVE" or int(my_match.get("current_match_round", 1)) != match_round:
        return None

    player_count = int(my_match.get("player_count", 2))
    match_player_ids = {my_match.get(f"player{k}_id") for k in range(1, player_count + 1)}
    moves = [m for m in moves if m["player_id"] in match_player_ids]

    if len(moves) < player_count:
        logger.warning("Not enough moves", extra={"match_id": match_id, "got": len(moves), "need": player_count})
        return None

    # ── Resolve round based on player count ───────────────────────────────────
    if player_count == 2:
        a, b = moves[0], moves[1]
        oc_a = _rps(a["move"], b["move"])
        oc_b = "LOSE" if oc_a == "WIN" else ("WIN" if oc_a == "LOSE" else "TIE")
        results = {
            a["player_id"]: {"move": a["move"], "outcome": oc_a},
            b["player_id"]: {"move": b["move"], "outcome": oc_b},
        }
        round_winner_id = a["player_id"] if oc_a == "WIN" else (b["player_id"] if oc_a == "LOSE" else None)
    else:
        # 3-player FFA resolution within the tournament match
        results = {m["player_id"]: {"move": m["move"], "outcome": "TIE", "wins": 0} for m in moves}
        for i, a in enumerate(moves):
            for b in moves[i + 1:]:
                oc = _rps(a["move"], b["move"])
                if oc == "WIN":
                    results[a["player_id"]]["wins"] += 1
                elif oc == "LOSE":
                    results[b["player_id"]]["wins"] += 1
        max_w = max(r["wins"] for r in results.values())
        winners_r = [pid for pid, r in results.items() if r["wins"] == max_w]
        round_winner_id = winners_r[0] if len(winners_r) == 1 else None
        for pid, r in results.items():
            r["outcome"] = "WIN" if pid == round_winner_id else ("TIE" if r["wins"] == max_w else "LOSE")

    # ── Increment win counter for round winner (ties don't count) ─────────────
    if round_winner_id:
        for k in range(1, player_count + 1):
            if my_match.get(f"player{k}_id") == round_winner_id:
                my_match[f"player{k}_wins"] = int(my_match.get(f"player{k}_wins", 0)) + 1
                break

    # ── Build match score ─────────────────────────────────────────────────────
    match_score = {
        my_match[f"player{k}_id"]: int(my_match.get(f"player{k}_wins", 0))
        for k in range(1, player_count + 1)
        if my_match.get(f"player{k}_id")
    }

    outcome = {
        "broadcasts":      [("ROUND_RESOLVED", {
            "round_number": match_round,
            "match_id":     match_id,
            "results":      results,
            "winner_id":    round_winner_id,
            "match_score":  match_score,
        })],
        "match_winner_id": None,
        "session_status":  None,
        "current_round":   None,
    }

    # ── Check if match is complete (any player reached wins_needed) ───────────
    match_winner_id = next(
        (my_match[f"player{k}_id"]
         for k in range(1, player_count + 1)
         if my_match.get(f"player{k}_id") and int(my_match.get(f"player{k}_wins", 0)) >= wins_needed),
        None,
    )

    if not match_winner_id:
        my_match["current_match_round"] = match_round + 1
        return outcome

    winner_name_str = next(
        my_match[f"player{k}_name"]
        for k in range(1, player_count + 1)
        if my_match.get(f"player{k}_id") == match_winner_id
    )
    losers = [
        {"player_id": my_match[f"player{k}_id"], "player_name": my_match[f"player{k}_name"]}
        for k in range(1, player_count + 1)
        if my_match.get(f"player{k}_id") and my_match[f"player{k}_id"] != match_winner_id
    ]

    my_match["status"]    = "COMPLETE"
    my_match["winner_id"] = match_winner_id
    outcome["match_winner_id"] = match_winner_id

    outcome["broadcasts"].append(("MATCH_FINISHED", {
        "match_id":    match_id,
        "winner_id":   match_winner_id,
        "winner_name": winner_name_str,
        "loser_id":    losers[0]["player_id"],    # backwards compat (first loser)
        "loser_name":  losers[0]["player_name"],  # backwards compat (first loser)
        "losers":      losers,                    # full list for 3-player matches
        "score":       match_score,
    }))

    # ── Propagate winner into the pre-built downstream match ──────────────────
    _fill_winner_slot(match_id, match_winner_id, winner_name_str, matches)

    # ── Check if all matches in this tournament round are done ────────────────
    current_tr    = int(bracket.get("current_tournament_round", 1))
    round_matches = [m for m in matches if int(m["tournament_round"]) == current_tr]
    if not all(m["status"] == "COMPLETE" for m in round_matches):
        return outcome

    total_rounds = int(bracket.get("total_tournament_rounds", 1))
    if current_tr >= total_rounds:
        bracket["champion_id"] = match_winner_id
        outcome["session_status"] = "FINISHED"
        outcome["broadcasts"].append(("CHAMPION_DECLARED", {
            "champion_id":   match_winner_id,
            "champion_name": winner_name_str,
        }))
    else:
        next_tr = current_tr + 1
        bracket["current_tournament_round"] = next_tr
        outcome["current_round"] = 1
        outcome["broadcasts"].append(("TOURNAMENT_ROUND_COMPLETE", {
            "next_tournament_round": next_tr,
            "new_matches":           [m for m in matches if int(m["tournament_round"]) == next_tr],
            "bracket":               bracket,
        }))
    return outcome


def _save_bracket(session_id, bracket, version, outcome):
    """Conditional write: only succeeds if nobody else wrote since we read."""
    sets   = ["bracket = :b", "bracket_version = :nv"]
    values = {":b": bracket, ":v": version, ":nv": version + 1}
    names  = {}
    if outcome["session_status"]:
        sets.append("#s = :s")
        names["#s"]  = "status"
        values[":s"] = outcome["session_status"]
    if outcome["current_round"] is not None:
        sets.append("current_round = :r")
        values[":r"] = outcome["current_round"]

    kwargs = {
        "Key": {"session_id": session_id, "sk": "METADATA"},
        "UpdateExpression": "SET " + ", ".join(sets),
        "ConditionExpression": "attribute_not_exists(bracket_version) OR bracket_version = :v",
        "ExpressionAttributeValues": values,
    }
    if names:
        kwargs["ExpressionAttributeNames"] = names
    sessions_table.update_item(**kwargs)


def _resolve_tournament_match(session_id, match_id, match_round):
    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3, os

    pk = f"{session_id}#{match_id}#{match_round}"
    moves = _boto3.resource("dynamodb").Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk),
        ConsistentRead=True,
    ).get("Items", [])

    for attempt in range(MAX_WRITE_ATTEMPTS):
        session = sessions_table.get_item(
            Key={"session_id": session_id, "sk": "METADATA"},
            ConsistentRead=True,
        ).get("Item")
        if not session:
            return

        bracket = session.get("bracket", {})
        version = int(session.get("bracket_version", 0))
        outcome = _apply_match_round(bracket, match_id, match_round, moves)
        if outcome is None:
            logger.info("Round already applied or not resolvable", extra={"pk": pk})
            return

        try:
            _save_bracket(session_id, bracket, version, outcome)
            break
        except sessions_table.meta.client.exceptions.ConditionalCheckFailedException:
            logger.info("Bracket write conflict, retrying", extra={"pk": pk, "attempt": attempt + 1})
            time.sleep(min(0.05 * (2 ** attempt), 0.4) * random.random())
    else:
        # Let Lambda's async retry run us again; applying is idempotent.
        raise RuntimeError(f"Bracket write conflict persisted after {MAX_WRITE_ATTEMPTS} attempts ({pk})")

    if outcome["match_winner_id"]:
        players_table.update_item(
            Key={"session_id": session_id, "player_id": outcome["match_winner_id"]},
            UpdateExpression="ADD score :one",
            ExpressionAttributeValues={":one": 1},
        )

    for event, payload in outcome["broadcasts"]:
        broadcast(session_id, event, payload)


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
