#!/usr/bin/env python3
"""Seed DynamoDB Local with test data for development."""

import uuid
import boto3
import json
from datetime import datetime, timezone, timedelta

ENDPOINT = "http://localhost:8000"
REGION = "us-east-1"

dynamodb = boto3.resource("dynamodb", endpoint_url=ENDPOINT, region_name=REGION)

SESSIONS_TABLE = "rockdrop-sessions-dev"
PLAYERS_TABLE = "rockdrop-players-dev"

SESSION_ID = "seed-session-001"
HOST_ID = str(uuid.uuid4())


def create_tables():
    client = boto3.client("dynamodb", endpoint_url=ENDPOINT, region_name=REGION)
    existing = {t["TableName"] for t in client.list_tables()["TableNames"]}

    if SESSIONS_TABLE not in existing:
        client.create_table(
            TableName=SESSIONS_TABLE,
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "session_id", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "session_id", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "qr_token", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[{
                "IndexName": "qr_token-index",
                "KeySchema": [{"AttributeName": "qr_token", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            }],
        )
        print(f"Created {SESSIONS_TABLE}")

    if PLAYERS_TABLE not in existing:
        client.create_table(
            TableName=PLAYERS_TABLE,
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "session_id", "KeyType": "HASH"},
                {"AttributeName": "player_id", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "session_id", "AttributeType": "S"},
                {"AttributeName": "player_id", "AttributeType": "S"},
                {"AttributeName": "ws_connection_id", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[{
                "IndexName": "connection-index",
                "KeySchema": [{"AttributeName": "ws_connection_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            }],
        )
        print(f"Created {PLAYERS_TABLE}")


def seed_session():
    now = datetime.utcnow().isoformat() + "Z"
    expires = int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())

    dynamodb.Table(SESSIONS_TABLE).put_item(Item={
        "session_id": SESSION_ID,
        "sk": "METADATA",
        "host_player_id": HOST_ID,
        "status": "WAITING",
        "mode": "FREE_FOR_ALL",
        "max_players": 20,
        "current_round": 0,
        "created_at": now,
        "expires_at": expires,
        "qr_token": "seed-token-not-valid",
    })
    print(f"Seeded session: {SESSION_ID}")


def seed_players():
    now = datetime.utcnow().isoformat() + "Z"
    players = [
        {"player_id": HOST_ID, "display_name": "Jose (Host)", "is_host": True},
        {"player_id": str(uuid.uuid4()), "display_name": "Maria", "is_host": False},
        {"player_id": str(uuid.uuid4()), "display_name": "Carlos", "is_host": False},
    ]
    table = dynamodb.Table(PLAYERS_TABLE)
    for p in players:
        table.put_item(Item={
            "session_id": SESSION_ID,
            "player_id": p["player_id"],
            "display_name": p["display_name"],
            "is_host": p["is_host"],
            "score": 0,
            "status": "DISCONNECTED",
            "joined_at": now,
        })
    print(f"Seeded {len(players)} players")


if __name__ == "__main__":
    create_tables()
    seed_session()
    seed_players()
    print(f"\nSeed complete. session_id={SESSION_ID}")
