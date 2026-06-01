import json
import uuid
from unittest.mock import MagicMock, patch
import pytest

from lambdas.game.resolve_round import resolve, resolve_free_for_all, resolve_tournament


@pytest.fixture
def lambda_context():
    ctx = MagicMock()
    ctx.function_name = "test-function"
    ctx.aws_request_id = str(uuid.uuid4())
    return ctx


class TestResolveHelper:
    def test_rock_beats_scissors(self):
        assert resolve("ROCK", "SCISSORS") == "WIN"

    def test_scissors_beats_paper(self):
        assert resolve("SCISSORS", "PAPER") == "WIN"

    def test_paper_beats_rock(self):
        assert resolve("PAPER", "ROCK") == "WIN"

    def test_same_move_is_tie(self):
        assert resolve("ROCK", "ROCK") == "TIE"
        assert resolve("PAPER", "PAPER") == "TIE"
        assert resolve("SCISSORS", "SCISSORS") == "TIE"

    def test_rock_loses_to_paper(self):
        assert resolve("ROCK", "PAPER") == "LOSE"

    def test_scissors_loses_to_rock(self):
        assert resolve("SCISSORS", "ROCK") == "LOSE"


class TestResolveFreeForAll:
    def test_rock_wins_against_scissors(self):
        moves = [
            {"player_id": "p1", "move": "ROCK"},
            {"player_id": "p2", "move": "SCISSORS"},
        ]
        result = resolve_free_for_all(moves)
        assert result["winner_id"] == "p1"
        assert result["results"]["p1"]["outcome"] == "WIN"
        assert result["results"]["p2"]["outcome"] == "LOSE"

    def test_all_tie_no_winner(self):
        moves = [
            {"player_id": "p1", "move": "ROCK"},
            {"player_id": "p2", "move": "ROCK"},
            {"player_id": "p3", "move": "ROCK"},
        ]
        result = resolve_free_for_all(moves)
        assert result["winner_id"] is None
        for pid in ["p1", "p2", "p3"]:
            assert result["results"][pid]["outcome"] == "TIE"

    def test_three_players_one_winner(self):
        moves = [
            {"player_id": "p1", "move": "ROCK"},
            {"player_id": "p2", "move": "SCISSORS"},
            {"player_id": "p3", "move": "SCISSORS"},
        ]
        result = resolve_free_for_all(moves)
        assert result["winner_id"] == "p1"


class TestResolveTournament:
    def test_1v1_winner_determined(self):
        moves = [
            {"player_id": "p1", "move": "ROCK"},
            {"player_id": "p2", "move": "SCISSORS"},
        ]
        result = resolve_tournament(moves)
        assert result["winner_id"] == "p1"
        assert result["results"]["p1"]["outcome"] == "WIN"
        assert result["results"]["p2"]["outcome"] == "LOSE"

    def test_1v1_tie_no_winner(self):
        moves = [
            {"player_id": "p1", "move": "PAPER"},
            {"player_id": "p2", "move": "PAPER"},
        ]
        result = resolve_tournament(moves)
        assert result["winner_id"] is None


class TestSubmitMove:
    @patch("submit_move.moves_table")
    @patch("submit_move.get_session")
    @patch("submit_move.get_all_players")
    @patch("submit_move.broadcast")
    @patch("submit_move.events_client")
    def test_submits_move_successfully(self, mock_events, mock_broadcast, mock_players,
                                       mock_session, mock_moves, lambda_context):
        import submit_move

        mock_session.return_value = {"session_id": "abc", "status": "PLAYING", "mode": "FREE_FOR_ALL"}
        mock_players.return_value = [{"player_id": "p1", "status": "CONNECTED"}]

        with patch.object(mock_moves, "put_item") as mock_put:
            mock_put.return_value = {}
            with patch("submit_move.dynamodb") as mock_dynamo:
                mock_dynamo.Table.return_value.query.return_value = {"Items": [{"player_id": "p1"}]}

                event = {
                    "pathParameters": {"session_id": "abc"},
                    "body": json.dumps({"player_id": "p1", "move": "ROCK", "round_number": 1}),
                }
                resp = submit_move.handler(event, lambda_context)
                assert resp["statusCode"] == 200
                body = json.loads(resp["body"])
                assert body["data"]["accepted"] is True

    @patch("submit_move.moves_table")
    @patch("submit_move.get_session")
    def test_rejects_invalid_move(self, mock_session, mock_moves, lambda_context):
        import submit_move

        mock_session.return_value = {"session_id": "abc", "status": "PLAYING"}
        event = {
            "pathParameters": {"session_id": "abc"},
            "body": json.dumps({"player_id": "p1", "move": "FIRE", "round_number": 1}),
        }
        resp = submit_move.handler(event, lambda_context)
        assert resp["statusCode"] == 400

    @patch("submit_move.get_session")
    def test_rejects_when_session_not_playing(self, mock_session, lambda_context):
        import submit_move

        mock_session.return_value = {"session_id": "abc", "status": "WAITING"}
        event = {
            "pathParameters": {"session_id": "abc"},
            "body": json.dumps({"player_id": "p1", "move": "ROCK", "round_number": 1}),
        }
        resp = submit_move.handler(event, lambda_context)
        assert resp["statusCode"] == 409
