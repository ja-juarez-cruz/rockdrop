"""
submit_move — POST /sessions/{session_id}/game/move

Registra el movimiento de un jugador para la ronda activa y, cuando todos los
jugadores del grupo han enviado su movimiento, dispara un evento EventBridge
que activa resolve_round.

Flujo:
    1. Valida sesión (PLAYING) y modo (FREE_FOR_ALL | TOURNAMENT).
    2. Persiste el movimiento con una escritura condicional idempotente.
    3. Cuenta cuántos movimientos existen para la clave del round.
    4. Broadcast MOVE_SUBMITTED (sin revelar el movimiento elegido).
    5. Si waiting_for <= 0 → put_events AllMovesSubmitted → resolve_round.

Tabla de movimientos (rockdrop-moves-{env}):
    PK en FFA:        {session_id}#{round_number}
    PK en TOURNAMENT: {session_id}#{match_id}#{match_round}
    SK:               player_id
"""

import json
import boto3
from datetime import datetime

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from db import get_session, moves_table, get_game_players
from ws import broadcast
from models import SubmitMoveRequest, ok, err, make_response, json_dumps

logger = Logger()
events_client = boto3.client("events")


def _submit_tournament(session_id, body, session):
    """
    Registra un movimiento en modo TOURNAMENT.

    Busca el match ACTIVE donde el jugador participa, construye la PK compuesta
    {session_id}#{match_id}#{match_round} y guarda el movimiento.  Cuando todos
    los jugadores del match enviaron, dispara AllMovesSubmitted con el match_id
    para que resolve_round pueda resolver únicamente ese partido sin tocar los
    demás que están en curso en paralelo.

    Args:
        session_id: ID de la sesión.
        body:       SubmitMoveRequest validado.
        session:    Item de DynamoDB con el bracket completo.

    Returns:
        Respuesta API Gateway con { accepted, match_id, round_number, waiting_for }.
    """
    bracket = session.get("bracket", {})
    matches = bracket.get("matches", [])

    # Busca el match activo del jugador; player3_id cubre futuros formatos de 3 jugadores
    my_match = None
    for m in matches:
        if m.get("status") == "ACTIVE" and body.player_id in (
            m.get("player1_id"), m.get("player2_id"), m.get("player3_id")
        ):
            my_match = m
            break

    if not my_match:
        return make_response(409, err("No active match found for this player"))

    match_id     = my_match["match_id"]
    match_round  = int(my_match["current_match_round"])
    player_count = int(my_match.get("player_count", 2))

    # PK única por (sesión, match, ronda) — impide colisiones entre rondas del mismo match
    pk = f"{session_id}#{match_id}#{match_round}"

    try:
        moves_table.put_item(
            Item={
                "pk": pk,
                "player_id": body.player_id,
                "move": body.move,
                "submitted_at": datetime.utcnow().isoformat() + "Z",
                "round_number": match_round,
                "match_id": match_id,
            },
            # Garantiza idempotencia: si el jugador reenvía (retry de red), no sobreescribe
            ConditionExpression="attribute_not_exists(player_id)",
        )
    except moves_table.meta.client.exceptions.ConditionalCheckFailedException:
        return make_response(409, err("Move already submitted for this round"))

    # Requiere query post-insert para obtener el conteo real; evita race condition
    # si dos jugadores llegan casi simultáneamente y ambos calculan waiting_for = 1
    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3
    import os
    resp = _boto3.resource("dynamodb").Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk),
        ConsistentRead=True,
    )
    moves_count = len(resp.get("Items", []))
    waiting_for = player_count - moves_count

    # MOVE_SUBMITTED no incluye el movimiento elegido para no revelar la jugada antes de resolver
    broadcast(session_id, "MOVE_SUBMITTED", {
        "player_id": body.player_id,
        "match_id": match_id,
        "round_number": match_round,
        "submitted_count": moves_count,
        "waiting_for": max(waiting_for, 0),
    })

    if waiting_for <= 0:
        # EventBridge en lugar de invocación directa: desacopla submit_move de resolve_round
        # y permite que la respuesta HTTP llegue al cliente antes de que empiece la resolución
        events_client.put_events(Entries=[{
            "Source": "rockdrop.game",
            "DetailType": "AllMovesSubmitted",
            "Detail": json_dumps({
                "session_id": session_id,
                "round_number": match_round,
                "match_id": match_id,
                "mode": "TOURNAMENT",
            }),
        }])

    return make_response(200, ok({
        "accepted": True,
        "match_id": match_id,
        "round_number": match_round,
        "waiting_for": max(waiting_for, 0),
    }))


def _submit_free_for_all(session_id, body, session):
    """
    Registra un movimiento en modo FREE_FOR_ALL.

    Todos los jugadores conectados comparten la misma ronda global.  El conteo
    de "quién falta" se calcula contra los jugadores con status CONNECTED para
    no bloquear la ronda si alguien se desconectó.

    Args:
        session_id: ID de la sesión.
        body:       SubmitMoveRequest validado (sin match_id).
        session:    Item de DynamoDB de la sesión.

    Returns:
        Respuesta API Gateway con { accepted, round_number, waiting_for }.
    """
    # PK única por (sesión, ronda global) — todos los jugadores escriben al mismo PK
    pk = f"{session_id}#{body.round_number}"

    # El host que solo organiza (is_spectator) no participa
    all_players = get_game_players(session_id)
    if body.player_id not in {p["player_id"] for p in all_players}:
        return make_response(403, err("Player is not part of this game"))

    try:
        moves_table.put_item(
            Item={
                "pk": pk,
                "player_id": body.player_id,
                "move": body.move,
                "submitted_at": datetime.utcnow().isoformat() + "Z",
                "round_number": body.round_number,
            },
            ConditionExpression="attribute_not_exists(player_id)",
        )
    except moves_table.meta.client.exceptions.ConditionalCheckFailedException:
        return make_response(409, err("Move already submitted for this round"))

    # Solo jugadores CONNECTED cuentan como "pendientes"; los DISCONNECTED no bloquean la ronda
    active = [p for p in all_players if p.get("status") == "CONNECTED"]

    from boto3.dynamodb.conditions import Key
    import boto3 as _boto3
    import os
    moves_resp = _boto3.resource("dynamodb").Table(os.environ["MOVES_TABLE"]).query(
        KeyConditionExpression=Key("pk").eq(pk),
        ConsistentRead=True,
    )
    submitted = len(moves_resp.get("Items", []))
    waiting_for = len(active) - submitted

    broadcast(session_id, "MOVE_SUBMITTED", {
        "player_id": body.player_id,
        "round_number": body.round_number,
        "submitted_count": submitted,
        "waiting_for": max(waiting_for, 0),
    })

    if waiting_for <= 0:
        events_client.put_events(Entries=[{
            "Source": "rockdrop.game",
            "DetailType": "AllMovesSubmitted",
            "Detail": json_dumps({
                "session_id": session_id,
                "round_number": body.round_number,
                "mode": "FREE_FOR_ALL",
            }),
        }])

    return make_response(200, ok({
        "accepted": True,
        "round_number": body.round_number,
        "waiting_for": max(waiting_for, 0),
    }))


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    """
    Punto de entrada Lambda — POST /sessions/{session_id}/game/move.

    Valida la sesión, determina el modo y delega a _submit_tournament
    o _submit_free_for_all según corresponda.
    """
    session_id = event.get("pathParameters", {}).get("session_id")
    if not session_id:
        return make_response(400, err("Missing session_id"))

    try:
        body = SubmitMoveRequest.model_validate(json.loads(event.get("body", "{}")))
    except Exception as e:
        return make_response(400, err(str(e)))

    # Consistent read: the bracket may have just advanced current_match_round
    session = get_session(session_id, consistent=True)
    if not session:
        return make_response(404, err("Session not found"))

    if session.get("status") != "PLAYING":
        return make_response(409, err("Session is not in PLAYING status"))

    mode = session.get("mode", "FREE_FOR_ALL")

    if mode == "TOURNAMENT":
        return _submit_tournament(session_id, body, session)
    else:
        return _submit_free_for_all(session_id, body, session)
