import json
import os
import boto3
from db import get_connected_players, mark_player_disconnected

WS_API_ID = os.environ["WS_API_ID"]
WS_STAGE = os.environ.get("WS_STAGE", "prod")
REGION = os.environ.get("AWS_REGION", "us-east-1")

_apigw_client = None


def _get_client():
    global _apigw_client
    if _apigw_client is None:
        endpoint = f"https://{WS_API_ID}.execute-api.{REGION}.amazonaws.com/{WS_STAGE}"
        _apigw_client = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint)
    return _apigw_client


def broadcast(session_id: str, event_name: str, payload: dict, exclude_player_id: str | None = None) -> None:
    client = _get_client()
    players = get_connected_players(session_id)
    message = json.dumps({"event": event_name, "payload": payload}).encode()

    for player in players:
        if player.get("player_id") == exclude_player_id:
            continue
        connection_id = player.get("ws_connection_id")
        if not connection_id:
            continue
        try:
            client.post_to_connection(ConnectionId=connection_id, Data=message)
        except client.exceptions.GoneException:
            mark_player_disconnected(player["session_id"], player["player_id"])


def send_to_player(connection_id: str, event_name: str, payload: dict) -> None:
    client = _get_client()
    message = json.dumps({"event": event_name, "payload": payload}).encode()
    try:
        client.post_to_connection(ConnectionId=connection_id, Data=message)
    except client.exceptions.GoneException:
        pass
