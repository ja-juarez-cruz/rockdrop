import json
import uuid
from unittest.mock import MagicMock, patch
import pytest

from lambdas.tournament.generate_bracket import build_bracket, next_power_of_two
from lambdas.tournament.advance_bracket import advance


@pytest.fixture
def lambda_context():
    ctx = MagicMock()
    ctx.function_name = "test-function"
    ctx.aws_request_id = str(uuid.uuid4())
    return ctx


def make_players(n: int) -> list[dict]:
    return [{"player_id": f"p{i}", "display_name": f"Player{i}"} for i in range(1, n + 1)]


class TestNextPowerOfTwo:
    def test_exact_power(self):
        assert next_power_of_two(4) == 4
        assert next_power_of_two(8) == 8

    def test_rounds_up(self):
        assert next_power_of_two(3) == 4
        assert next_power_of_two(5) == 8
        assert next_power_of_two(9) == 16


class TestBuildBracket:
    def test_4_players_creates_2_matches(self):
        players = make_players(4)
        bracket = build_bracket(players)
        assert len(bracket["matches"]) == 2
        assert bracket["size"] == 4
        assert bracket["total_rounds"] == 2
        for match in bracket["matches"]:
            assert match["status"] == "PENDING"

    def test_3_players_creates_bye(self):
        players = make_players(3)
        bracket = build_bracket(players)
        assert bracket["size"] == 4
        bye_matches = [m for m in bracket["matches"] if m["status"] == "BYE"]
        assert len(bye_matches) == 1

    def test_2_players_creates_1_match(self):
        players = make_players(2)
        bracket = build_bracket(players)
        assert len(bracket["matches"]) == 1
        assert bracket["total_rounds"] == 1

    def test_8_players_creates_4_matches(self):
        players = make_players(8)
        bracket = build_bracket(players)
        assert len(bracket["matches"]) == 4
        assert bracket["size"] == 8


class TestAdvanceBracket:
    def test_advance_moves_winners_to_next_round(self):
        bracket = {
            "size": 4,
            "total_rounds": 2,
            "current_round": 1,
            "matches": [
                {"match_id": "r1_m1", "round": 1, "player1": {"player_id": "p1"},
                 "player2": {"player_id": "p2"}, "winner_id": None, "status": "PENDING"},
                {"match_id": "r1_m2", "round": 1, "player1": {"player_id": "p3"},
                 "player2": {"player_id": "p4"}, "winner_id": None, "status": "PENDING"},
            ],
        }
        round_results = [
            {"match_id": "r1_m1", "winner_id": "p1"},
            {"match_id": "r1_m2", "winner_id": "p3"},
        ]

        updated = advance(bracket, round_results)

        assert updated["current_round"] == 2
        r2_matches = [m for m in updated["matches"] if m["round"] == 2]
        assert len(r2_matches) == 1
        assert updated.get("status") != "FINISHED"

    def test_final_match_sets_champion(self):
        bracket = {
            "size": 2,
            "total_rounds": 1,
            "current_round": 1,
            "matches": [
                {"match_id": "r1_m1", "round": 1, "player1": {"player_id": "p1"},
                 "player2": {"player_id": "p2"}, "winner_id": None, "status": "PENDING"},
            ],
        }
        round_results = [{"match_id": "r1_m1", "winner_id": "p1"}]

        updated = advance(bracket, round_results)

        assert updated.get("status") == "FINISHED"
        assert updated.get("champion_id") == "p1"
