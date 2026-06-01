import json
from decimal import Decimal
from enum import Enum
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
import uuid


class _DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


def json_dumps(obj) -> str:
    return json.dumps(obj, cls=_DecimalEncoder)


class GameMode(str, Enum):
    FREE_FOR_ALL = "FREE_FOR_ALL"
    TOURNAMENT = "TOURNAMENT"


class SessionStatus(str, Enum):
    WAITING = "WAITING"
    PLAYING = "PLAYING"
    FINISHED = "FINISHED"


class PlayerStatus(str, Enum):
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"


class Move(str, Enum):
    ROCK = "ROCK"
    PAPER = "PAPER"
    SCISSORS = "SCISSORS"


class Outcome(str, Enum):
    WIN = "WIN"
    LOSE = "LOSE"
    TIE = "TIE"


class CreateSessionRequest(BaseModel):
    host_player_id: str
    display_name: str
    mode: GameMode = GameMode.FREE_FOR_ALL
    max_players: int = Field(default=32, ge=2, le=100)


class JoinSessionRequest(BaseModel):
    display_name: str
    token: str


class SubmitMoveRequest(BaseModel):
    player_id: str
    move: Move
    round_number: int = Field(ge=1)


class WsEvent(BaseModel):
    event: str
    payload: Dict


_CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,x-host-token",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
}


def ok(data: dict) -> dict:
    return {"data": data, "error": None}


def err(message: str) -> dict:
    return {"data": None, "error": message}


def make_response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": _CORS_HEADERS,
        "body": json_dumps(body),
    }
