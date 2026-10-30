import os
from concurrent.futures import ThreadPoolExecutor

import boto3
from db import get_connected_players, mark_player_disconnected
from models import json_dumps

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


BROADCAST_WORKERS = 16


def broadcast(
    session_id: str,
    event_name: str,
    payload: dict,
    exclude_player_id: str | None = None,
    only_player_ids: set[str] | None = None,
) -> None:
    """
    Send an event to every connected player of the session (or only to
    only_player_ids).  Posts run in parallel so the Lambda's duration — and the
    concurrency it holds — doesn't grow linearly with the number of players.
    """
    client = _get_client()
    message = json_dumps({"event": event_name, "payload": payload}).encode()
    targets = [
        p for p in get_connected_players(session_id)
        if p.get("ws_connection_id")
        and p.get("player_id") != exclude_player_id
        and (only_player_ids is None or p.get("player_id") in only_player_ids)
    ]

    def _post(player):
        """Returns the player if its connection is gone."""
        try:
            client.post_to_connection(ConnectionId=player["ws_connection_id"], Data=message)
        except client.exceptions.GoneException:
            return player
        return None

    if len(targets) <= 1:
        gone = [_post(p) for p in targets]
    else:
        # boto3 clients are thread-safe; the DynamoDB resource used below is not
        with ThreadPoolExecutor(max_workers=min(BROADCAST_WORKERS, len(targets))) as pool:
            gone = list(pool.map(_post, targets))

    for player in filter(None, gone):
        mark_player_disconnected(player["session_id"], player["player_id"])


def send_to_player(connection_id: str, event_name: str, payload: dict) -> None:
    client = _get_client()
    message = json_dumps({"event": event_name, "payload": payload}).encode()
    try:
        client.post_to_connection(ConnectionId=connection_id, Data=message)
    except client.exceptions.GoneException:
        pass
