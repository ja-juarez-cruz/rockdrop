"""
Tournament resolution against an in-memory DynamoDB (moto).

Plays full tournaments from 4 to 50 players through the real build_bracket and
resolve_round code, resolving every match of a tournament round concurrently to
exercise the optimistic-locking write path, and checks that duplicate
AllMovesSubmitted events are no-ops.

Run: pytest tests/test_tournament_resolution.py
"""
import importlib
import os
import random
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import botocore.client

import boto3
import pytest
from moto import mock_aws

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for sub in ("lambdas/layers/src", "lambdas/session", "lambdas/game"):
    sys.path.insert(0, os.path.join(ROOT, sub))

os.environ.update({
    "AWS_DEFAULT_REGION":    "us-east-1",
    "AWS_ACCESS_KEY_ID":     "testing",
    "AWS_SECRET_ACCESS_KEY": "testing",
    "SESSIONS_TABLE":        "sessions",
    "PLAYERS_TABLE":         "players",
    "MOVES_TABLE":           "moves",
    "ROUNDS_TABLE":          "rounds",
    "WS_API_ID":             "test",
    "POWERTOOLS_SERVICE_NAME": "test",
})

TABLE_KEYS = {
    "sessions": ("session_id", "sk"),
    "players":  ("session_id", "player_id"),
    "moves":    ("pk", "player_id"),
    "rounds":   ("session_id", "round_number"),
}

MOVES = ["ROCK", "PAPER", "SCISSORS"]


@pytest.fixture
def env(monkeypatch):
    # moto is not thread-safe; DynamoDB applies each request atomically, so
    # serialize individual API calls (reads and conditional writes still interleave)
    lock = threading.Lock()
    original = botocore.client.BaseClient._make_api_call

    def atomic_call(self, *args, **kwargs):
        with lock:
            return original(self, *args, **kwargs)

    monkeypatch.setattr(botocore.client.BaseClient, "_make_api_call", atomic_call)

    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        for name, (hk, rk) in TABLE_KEYS.items():
            ddb.create_table(
                TableName=name,
                KeySchema=[{"AttributeName": hk, "KeyType": "HASH"}, {"AttributeName": rk, "KeyType": "RANGE"}],
                AttributeDefinitions=[{"AttributeName": hk, "AttributeType": "S"}, {"AttributeName": rk, "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        # Import (or re-import) inside the mock so module-level clients are mocked
        for mod in ("db", "ws", "start_session", "resolve_round"):
            sys.modules.pop(mod, None)
        start_session = importlib.import_module("start_session")
        resolve_round = importlib.import_module("resolve_round")

        events = []
        resolve_round.broadcast = lambda sid, ev, payload: events.append((ev, payload))
        yield ddb, start_session, resolve_round, events


def _start(ddb, start_session, n, session_id="s1"):
    players = [{"player_id": f"p{i}", "display_name": f"P{i}"} for i in range(n)]
    for p in players:
        ddb.Table("players").put_item(Item={"session_id": session_id, **p, "status": "CONNECTED"})
    bracket = start_session.build_bracket(players)
    ddb.Table("sessions").put_item(Item={
        "session_id": session_id, "sk": "METADATA",
        "status": "PLAYING", "mode": "TOURNAMENT", "bracket": bracket,
    })
    return players


def _session(ddb, session_id="s1"):
    return ddb.Table("sessions").get_item(Key={"session_id": session_id, "sk": "METADATA"})["Item"]


def _submit_round(ddb, session_id, match, rng):
    """Write one move per player for the match's current round; return pk."""
    pc = int(match["player_count"])
    rnd = int(match["current_match_round"])
    pk = f"{session_id}#{match['match_id']}#{rnd}"
    for k in range(1, pc + 1):
        # Same condition as submit_move: if the bracket lost this round's update
        # the player would get a 409 here and the match would be stuck
        ddb.Table("moves").put_item(
            Item={"pk": pk, "player_id": match[f"player{k}_id"], "move": rng.choice(MOVES)},
            ConditionExpression="attribute_not_exists(player_id)",
        )
    return rnd


def _play_tournament(ddb, resolve_round, session_id, rng, duplicate_events=False):
    for _ in range(5000):
        session = _session(ddb, session_id)
        if session["status"] == "FINISHED":
            return session
        tr = int(session["bracket"]["current_tournament_round"])
        active = [m for m in session["bracket"]["matches"]
                  if int(m["tournament_round"]) == tr and m["status"] == "ACTIVE"]
        assert active, f"stuck: no ACTIVE matches in tournament round {tr}"

        jobs = []
        for m in active:
            rnd = _submit_round(ddb, session_id, m, rng)
            jobs.append((m["match_id"], rnd))
            if duplicate_events:
                jobs.append((m["match_id"], rnd))

        # Resolve every match of the round in parallel, like EventBridge would
        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            list(pool.map(lambda j: resolve_round._resolve_tournament_match(session_id, *j), jobs))
    raise AssertionError("tournament did not finish")


@pytest.mark.parametrize("n", [4, 5, 6, 7, 9, 11, 12, 13, 20, 25, 33, 50])
def test_full_tournament_concurrent(env, n):
    ddb, start_session, resolve_round, events = env
    players = _start(ddb, start_session, n)
    session = _play_tournament(ddb, resolve_round, "s1", random.Random(n))

    bracket = session["bracket"]
    assert bracket["champion_id"] in {p["player_id"] for p in players}
    assert all(m["status"] == "COMPLETE" for m in bracket["matches"])
    for m in bracket["matches"]:
        pc = int(m["player_count"])
        ids = [m[f"player{k}_id"] for k in range(1, pc + 1)]
        assert None not in ids and len(set(ids)) == pc, m["match_id"]
        # Exactly one player reached the target; no lost or double-counted wins
        wins = sorted(int(m[f"player{k}_wins"]) for k in range(1, pc + 1))
        assert wins[-1] == 3 and wins[-2] < 3, m["match_id"]
    assert [e for e, _ in events].count("CHAMPION_DECLARED") == 1


def test_duplicate_events_are_noops(env):
    ddb, start_session, resolve_round, events = env
    _start(ddb, start_session, 11)
    session = _play_tournament(ddb, resolve_round, "s1", random.Random(1), duplicate_events=True)

    rounds_resolved = sum(1 for e, _ in events if e == "ROUND_RESOLVED")
    rounds_played = sum(int(m["current_match_round"]) for m in session["bracket"]["matches"])
    assert rounds_resolved == rounds_played
    finished = [p["match_id"] for e, p in events if e == "MATCH_FINISHED"]
    assert len(finished) == len(set(finished)) == len(session["bracket"]["matches"])
    scores = {p["player_id"]: int(p.get("score", 0)) for p in ddb.Table("players").scan()["Items"]}
    assert sum(scores.values()) == len(session["bracket"]["matches"])


def test_round_resolved_broadcast_after_write(env):
    ddb, start_session, resolve_round, events = env
    _start(ddb, start_session, 4)
    m = _session(ddb)["bracket"]["matches"][0]
    seen = []
    resolve_round.broadcast = lambda sid, ev, p: seen.append(
        next(x for x in _session(ddb)["bracket"]["matches"] if x["match_id"] == m["match_id"])
    )
    rnd = _submit_round(ddb, "s1", m, random.Random(0))
    resolve_round._resolve_tournament_match("s1", m["match_id"], rnd)
    # When the client hears ROUND_RESOLVED the bracket already moved on
    assert seen and int(seen[0]["current_match_round"]) == rnd + 1


def test_six_player_final_has_three_players(env):
    ddb, start_session, resolve_round, events = env
    _start(ddb, start_session, 6)
    rng = random.Random(6)
    session = _session(ddb)
    while int(session["bracket"]["current_tournament_round"]) == 1:
        for m in [x for x in session["bracket"]["matches"] if x["status"] == "ACTIVE"]:
            rnd = _submit_round(ddb, "s1", m, rng)
            resolve_round._resolve_tournament_match("s1", m["match_id"], rnd)
        session = _session(ddb)

    final = next(m for m in session["bracket"]["matches"] if m["match_id"] == "r2_m1")
    r1_winners = [m["winner_id"] for m in session["bracket"]["matches"] if int(m["tournament_round"]) == 1]
    assert final["status"] == "ACTIVE"
    assert [final["player1_id"], final["player2_id"], final["player3_id"]] == r1_winners
