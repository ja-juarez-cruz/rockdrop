import json
import uuid
from unittest.mock import MagicMock, patch
import pytest


@pytest.fixture
def lambda_context():
    ctx = MagicMock()
    ctx.function_name = "test-function"
    ctx.aws_request_id = str(uuid.uuid4())
    return ctx


@pytest.fixture
def mock_tables(monkeypatch):
    sessions = MagicMock()
    players = MagicMock()
    monkeypatch.setattr("db.sessions_table", sessions)
    monkeypatch.setattr("db.players_table", players)
    return {"sessions": sessions, "players": players}


def _create_event(body: dict) -> dict:
    return {"body": json.dumps(body), "pathParameters": {}}


class TestCreateSession:
    @patch("create_session.create_qr_token", return_value="mock.jwt.token")
    def test_creates_session_successfully(self, mock_jwt, mock_tables, lambda_context):
        import create_session

        event = _create_event({
            "host_player_id": str(uuid.uuid4()),
            "display_name": "Jose",
            "mode": "FREE_FOR_ALL",
            "max_players": 20,
        })

        resp = create_session.handler(event, lambda_context)

        assert resp["statusCode"] == 201
        body = json.loads(resp["body"])
        assert body["error"] is None
        assert "session_id" in body["data"]
        assert body["data"]["qr_token"] == "mock.jwt.token"
        mock_tables["sessions"].put_item.assert_called_once()
        mock_tables["players"].put_item.assert_called_once()

    @patch("create_session.create_qr_token", return_value="mock.jwt.token")
    def test_returns_400_on_missing_fields(self, mock_jwt, mock_tables, lambda_context):
        import create_session

        event = {"body": json.dumps({"display_name": "Jose"}), "pathParameters": {}}
        resp = create_session.handler(event, lambda_context)
        assert resp["statusCode"] == 400


class TestGetSession:
    def test_returns_session_data(self, mock_tables, lambda_context):
        mock_tables["sessions"].get_item.return_value = {
            "Item": {"session_id": "abc", "sk": "METADATA", "status": "WAITING"}
        }
        import get_session as gs

        event = {"pathParameters": {"session_id": "abc"}}
        resp = gs.handler(event, lambda_context)

        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["data"]["session_id"] == "abc"
        assert "qr_token" not in body["data"]

    def test_returns_404_for_unknown_session(self, mock_tables, lambda_context):
        mock_tables["sessions"].get_item.return_value = {}
        import get_session as gs

        event = {"pathParameters": {"session_id": "nonexistent"}}
        resp = gs.handler(event, lambda_context)
        assert resp["statusCode"] == 404
