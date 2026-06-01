import os
import boto3
from boto3.dynamodb.conditions import Key, Attr

dynamodb = boto3.resource("dynamodb")

SESSIONS_TABLE = os.environ["SESSIONS_TABLE"]
PLAYERS_TABLE = os.environ["PLAYERS_TABLE"]
MOVES_TABLE = os.environ["MOVES_TABLE"]
ROUNDS_TABLE = os.environ["ROUNDS_TABLE"]

sessions_table = dynamodb.Table(SESSIONS_TABLE)
players_table = dynamodb.Table(PLAYERS_TABLE)
moves_table = dynamodb.Table(MOVES_TABLE)
rounds_table = dynamodb.Table(ROUNDS_TABLE)


def get_session(session_id: str) -> dict | None:
    resp = sessions_table.get_item(Key={"session_id": session_id, "sk": "METADATA"})
    return resp.get("Item")


def get_connected_players(session_id: str) -> list[dict]:
    resp = players_table.query(
        KeyConditionExpression=Key("session_id").eq(session_id),
        FilterExpression=Attr("status").eq("CONNECTED") & Attr("ws_connection_id").exists(),
    )
    return resp.get("Items", [])


def get_all_players(session_id: str) -> list[dict]:
    resp = players_table.query(
        KeyConditionExpression=Key("session_id").eq(session_id)
    )
    return resp.get("Items", [])


def get_player_by_connection(connection_id: str) -> dict | None:
    resp = players_table.query(
        IndexName="connection-index",
        KeyConditionExpression=Key("ws_connection_id").eq(connection_id),
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_moves_for_round(session_id: str, round_number: int) -> list[dict]:
    pk = f"{session_id}#{round_number}"
    resp = moves_table.query(KeyConditionExpression=Key("pk").eq(pk))
    return resp.get("Items", [])


def mark_player_disconnected(session_id: str, player_id: str) -> None:
    players_table.update_item(
        Key={"session_id": session_id, "player_id": player_id},
        UpdateExpression="SET #s = :s REMOVE ws_connection_id",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "DISCONNECTED"},
    )
