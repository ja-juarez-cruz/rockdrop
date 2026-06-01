from enum import Enum
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
import uuid


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


def ok(data: dict) -> dict:
    return {"data": data, "error": None}


def err(message: str, status_code: int = 400) -> dict:
    return {"statusCode": status_code, "body": {"data": None, "error": message}}
