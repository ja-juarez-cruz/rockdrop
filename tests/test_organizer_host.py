"""
Host who only organizes (host_plays=False) through the real Lambda handlers on
an in-memory DynamoDB (moto): the host is kept for WebSocket broadcasts but is
excluded from the player count, the bracket and FFA moves.

Run: pytest tests/test_organizer_host.py
"""
import importlib
import json
import os
import sys
import uuid
from types import SimpleNamespace

import boto3
import pytest
from moto import mock_aws

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for sub in ("lambdas/layers/src", "lambdas/session", "lambdas/player", "lambdas/game"):
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
    "ENVIRONMENT":           "test",
    "POWERTOOLS_SERVICE_NAME": "test",
})

TABLE_KEYS = {
    "sessions": ("session_id", "sk"),
    "players":  ("session_id", "player_id"),
    "moves":    ("pk", "player_id"),
    "rounds":   ("session_id", "round_number"),
}

CTX = SimpleNamespace(function_name="test", memory_limit_in_mb=128,
                      invoked_function_arn="arn:aws:lambda:us-east-1:000000000000:function:test",
                      aws_request_id="req")


@pytest.fixture
def h():
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        for name, (hk, rk) in TABLE_KEYS.items():
            ddb.create_table(
                TableName=name,
                KeySchema=[{"AttributeName": hk, "KeyType": "HASH"}, {"AttributeName": rk, "KeyType": "RANGE"}],
                AttributeDefinitions=[{"AttributeName": hk, "AttributeType": "S"}, {"AttributeName": rk, "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        boto3.client("ssm", region_name="us-east-1").put_parameter(
            Name="/rockdrop/test/JWT_SECRET", Value="secret", Type="SecureString")
        boto3.client("events", region_name="us-east-1")

        mods = ("db", "ws", "auth", "models", "create_session", "join_session",
                "get_players", "start_session", "submit_move")
        for mod in mods:
            sys.modules.pop(mod, None)
        loaded = SimpleNamespace(**{m: importlib.import_module(m) for m in mods}, ddb=ddb)
        for m in ("join_session", "start_session", "submit_move"):
            getattr(loaded, m).broadcast = lambda *a, **k: None
        yield loaded


def _call(handler, body=None, session_id=None):
    event = {"body": json.dumps(body or {}), "pathParameters": {"session_id": session_id} if session_id else {}}
    resp = handler(event, CTX)
    return resp["statusCode"], json.loads(resp["body"]).get("data") or json.loads(resp["body"])


def _create(h, host_plays, max_players=16):
    host = str(uuid.uuid4())
    st, d = _call(h.create_session.handler, {"host_player_id": host, "display_name": "Host",
                                             "max_players": max_players, "host_plays": host_plays})
    assert st == 201, d
    return host, d["session_id"], d["qr_token"]


def _join(h, sid, token, n):
    ids = []
    for i in range(n):
        st, d = _call(h.join_session.handler, {"display_name": f"P{i}", "token": token}, sid)
        assert st == 201, d
        ids.append(d["player_id"])
    return ids


def test_organizer_not_in_bracket(h):
    host, sid, token = _create(h, host_plays=False)
    players = _join(h, sid, token, 15)

    st, d = _call(h.get_players.handler, session_id=sid)
    assert st == 200 and d["count"] == 15
    assert host not in {p["player_id"] for p in d["players"]}

    st, d = _call(h.start_session.handler, {"host_player_id": host}, sid)
    assert st == 200 and d["mode"] == "TOURNAMENT"
    in_bracket = {m.get(f"player{k}_id") for m in d["bracket"]["matches"] for k in (1, 2, 3)} - {None}
    assert in_bracket == set(players)


def test_max_16_players_excludes_organizer(h):
    host, sid, token = _create(h, host_plays=False, max_players=16)
    _join(h, sid, token, 16)
    st, d = _call(h.join_session.handler, {"display_name": "extra", "token": token}, sid)
    assert st == 409


def test_max_players_capped_at_16(h):
    st, _ = _call(h.create_session.handler, {"host_player_id": "x", "display_name": "Host", "max_players": 17})
    assert st == 400


def test_host_plays_by_default(h):
    host = str(uuid.uuid4())
    st, d = _call(h.create_session.handler, {"host_player_id": host, "display_name": "Host"})
    sid, token = d["session_id"], d["qr_token"]
    players = _join(h, sid, token, 3)
    st, d = _call(h.start_session.handler, {"host_player_id": host}, sid)
    in_bracket = {m.get(f"player{k}_id") for m in d["bracket"]["matches"] for k in (1, 2, 3)} - {None}
    assert in_bracket == set(players) | {host}


def test_organizer_cannot_throw_in_ffa(h):
    host, sid, token = _create(h, host_plays=False)
    players = _join(h, sid, token, 2)
    st, d = _call(h.start_session.handler, {"host_player_id": host}, sid)
    assert st == 200 and d["mode"] == "FREE_FOR_ALL"

    st, _ = _call(h.submit_move.handler, {"player_id": host, "move": "ROCK", "round_number": 1}, sid)
    assert st == 403
    st, d = _call(h.submit_move.handler, {"player_id": players[0], "move": "ROCK", "round_number": 1}, sid)
    assert st == 200
