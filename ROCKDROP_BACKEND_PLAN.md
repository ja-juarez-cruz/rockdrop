# RockDrop — Backend Serverless Plan
> Instrucciones para Claude Code · AWS Serverless · Python 3.12

---

## Contexto del proyecto

Juego multijugador de Piedra, Papel o Tijera donde:
- **1 Host** tiene la app móvil y crea la sesión
- **N Guests** se unen sin instalar nada via PWA (QR Code → URL con token)
- Comunicación en tiempo real via **API Gateway WebSocket**
- Stack: AWS Lambda (Python 3.12), DynamoDB, API Gateway (REST + WebSocket), EventBridge, S3

---

## Estructura de carpetas a generar

```
rockdrop/
├── infra/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── modules/
│   │   ├── dynamodb/
│   │   ├── api_gateway_rest/
│   │   ├── api_gateway_ws/
│   │   └── lambdas/
├── lambdas/
│   ├── session/
│   │   ├── create_session.py
│   │   ├── get_session.py
│   │   └── close_session.py
│   ├── player/
│   │   ├── join_session.py
│   │   └── get_players.py
│   ├── game/
│   │   ├── submit_move.py
│   │   ├── resolve_round.py
│   │   └── get_round_result.py
│   ├── tournament/
│   │   ├── generate_bracket.py
│   │   ├── advance_bracket.py
│   │   └── get_bracket.py
│   ├── websocket/
│   │   ├── connect.py
│   │   ├── disconnect.py
│   │   └── broadcast.py
│   └── layers/
│       └── common/
│           ├── db.py          # DynamoDB client helper
│           ├── ws.py          # WebSocket broadcast helper
│           ├── auth.py        # JWT token validation
│           └── models.py      # Pydantic models
├── scripts/
│   ├── seed_local.py
│   └── warmup.py
└── tests/
    ├── test_session.py
    ├── test_game.py
    └── test_tournament.py
```

---

## DynamoDB — Tablas

### Tabla 1: `rockdrop-sessions`
```
PK: session_id (String)          # UUID v4 generado al crear sesión
SK: "METADATA"
Atributos:
  - host_player_id: String
  - status: String               # WAITING | PLAYING | FINISHED
  - mode: String                 # FREE_FOR_ALL | TOURNAMENT
  - max_players: Number          # default 32
  - current_round: Number        # default 0
  - created_at: String           # ISO8601
  - expires_at: Number           # TTL Unix timestamp (+1 hora)
  - qr_token: String             # JWT firmado para guests
GSI: qr_token-index (qr_token)   # para validar tokens de guests
```

### Tabla 2: `rockdrop-players`
```
PK: session_id (String)
SK: player_id (String)           # UUID v4
Atributos:
  - display_name: String
  - is_host: Boolean
  - ws_connection_id: String     # API GW WebSocket connection ID
  - score: Number                # wins acumuladas
  - status: String               # CONNECTED | DISCONNECTED
  - joined_at: String
GSI: connection-index (ws_connection_id)  # para lookup en disconnect
```

### Tabla 3: `rockdrop-moves`
```
PK: session_id#round_number (String)    # "abc123#1"
SK: player_id (String)
Atributos:
  - move: String                  # ROCK | PAPER | SCISSORS
  - submitted_at: String
  - round_number: Number
```

### Tabla 4: `rockdrop-rounds`
```
PK: session_id (String)
SK: round_number (String)         # "1", "2", etc
Atributos:
  - results: Map                  # { player_id: { move, outcome: WIN|LOSE|TIE } }
  - winner_id: String             # null si hay empate
  - resolved_at: String
  - next_round_players: List      # para modo torneo
```

---

## API Gateway REST — Endpoints

Base URL: `https://{api-id}.execute-api.us-east-1.amazonaws.com/prod`

### /sessions
| Method | Path | Lambda | Descripción |
|--------|------|--------|-------------|
| POST | /sessions | create_session | Host crea nueva sesión |
| GET | /sessions/{session_id} | get_session | Obtener estado de sesión |
| DELETE | /sessions/{session_id} | close_session | Host cierra sesión |

### /sessions/{session_id}/players
| Method | Path | Lambda | Descripción |
|--------|------|--------|-------------|
| POST | /sessions/{session_id}/players | join_session | Guest se une con token |
| GET | /sessions/{session_id}/players | get_players | Listar jugadores conectados |

### /sessions/{session_id}/game
| Method | Path | Lambda | Descripción |
|--------|------|--------|-------------|
| POST | /sessions/{session_id}/game/move | submit_move | Jugador envía su movimiento |
| GET | /sessions/{session_id}/game/round/{round} | get_round_result | Resultado de una ronda |

### /sessions/{session_id}/tournament
| Method | Path | Lambda | Descripción |
|--------|------|--------|-------------|
| POST | /sessions/{session_id}/tournament/bracket | generate_bracket | Host genera bracket |
| PUT | /sessions/{session_id}/tournament/bracket/advance | advance_bracket | Avanzar ronda de torneo |
| GET | /sessions/{session_id}/tournament/bracket | get_bracket | Obtener bracket actual |

---

## API Gateway WebSocket

URL: `wss://{ws-api-id}.execute-api.us-east-1.amazonaws.com/prod`

### Routes
| Route Key | Lambda | Descripción |
|-----------|--------|-------------|
| $connect | connect.py | Guarda connection_id en Players table |
| $disconnect | disconnect.py | Marca player como DISCONNECTED |
| $default | broadcast.py | Fallback para mensajes custom |

### Eventos broadcast (servidor → clientes)
Todos los mensajes WebSocket que el servidor emite siguen este formato:
```json
{
  "event": "PLAYER_JOINED | ROUND_STARTED | MOVE_SUBMITTED | ROUND_RESOLVED | GAME_FINISHED | BRACKET_UPDATED",
  "payload": {}
}
```

---

## Lambda Functions — Especificación detallada

### 1. `create_session.py`
**Trigger:** POST /sessions  
**Auth:** Header `x-host-token` (token del host, generado en app móvil)  
**Input:**
```json
{
  "host_player_id": "uuid",
  "display_name": "Jose",
  "mode": "FREE_FOR_ALL",
  "max_players": 20
}
```
**Lógica:**
1. Generar `session_id` (UUID v4)
2. Generar `qr_token` JWT (payload: session_id, exp: +1h, firmado con SECRET_KEY en SSM)
3. Escribir en `rockdrop-sessions` con status=WAITING
4. Escribir player host en `rockdrop-players` con is_host=True
5. Retornar session_id + qr_token + ws_url

**Output:**
```json
{
  "session_id": "abc123",
  "qr_token": "eyJ...",
  "ws_url": "wss://...",
  "join_url": "https://rockdrop.app/join?token=eyJ..."
}
```

---

### 2. `join_session.py`
**Trigger:** POST /sessions/{session_id}/players  
**Auth:** Query param `token` (JWT del QR)  
**Input:**
```json
{
  "display_name": "Maria",
  "token": "eyJ..."
}
```
**Lógica:**
1. Validar JWT token → extraer session_id
2. Verificar session existe y status=WAITING
3. Verificar max_players no alcanzado
4. Generar player_id
5. Escribir en `rockdrop-players`
6. Broadcast WS evento PLAYER_JOINED a todos los conectados

**Output:**
```json
{
  "player_id": "uuid",
  "session_id": "abc123",
  "display_name": "Maria",
  "ws_url": "wss://..."
}
```

---

### 3. `submit_move.py`
**Trigger:** POST /sessions/{session_id}/game/move  
**Input:**
```json
{
  "player_id": "uuid",
  "move": "ROCK",
  "round_number": 1
}
```
**Lógica:**
1. Validar session status=PLAYING
2. Validar move ∈ [ROCK, PAPER, SCISSORS]
3. Verificar jugador no envió movimiento ya en esta ronda (idempotency)
4. Escribir en `rockdrop-moves` PK=session_id#round_number
5. Broadcast WS evento MOVE_SUBMITTED (sin revelar el movimiento)
6. Verificar si TODOS los jugadores ya enviaron → invocar resolve_round async via EventBridge

**Output:**
```json
{
  "accepted": true,
  "round_number": 1,
  "waiting_for": 3
}
```

---

### 4. `resolve_round.py`
**Trigger:** EventBridge rule (cuando todos los jugadores enviaron movimiento)  
**Lógica:**
1. Leer todos los moves de `rockdrop-moves` PK=session_id#round_number
2. Aplicar lógica RPS:
   - ROCK vs SCISSORS → ROCK gana
   - SCISSORS vs PAPER → SCISSORS gana
   - PAPER vs ROCK → PAPER gana
   - Mismos → TIE
3. En FREE_FOR_ALL: comparar cada par, sumar puntos
4. En TOURNAMENT: determinar ganador del match 1v1
5. Escribir resultado en `rockdrop-rounds`
6. Actualizar scores en `rockdrop-players`
7. Broadcast WS evento ROUND_RESOLVED con todos los movimientos revelados
8. Si es torneo → invocar advance_bracket

**Lógica RPS helper:**
```python
BEATS = {"ROCK": "SCISSORS", "SCISSORS": "PAPER", "PAPER": "ROCK"}

def resolve(move_a, move_b):
    if move_a == move_b:
        return "TIE"
    return "WIN" if BEATS[move_a] == move_b else "LOSE"
```

---

### 5. `generate_bracket.py`
**Trigger:** POST /sessions/{session_id}/tournament/bracket  
**Lógica:**
1. Leer todos los players de la sesión
2. Shuffle aleatorio de jugadores
3. Generar estructura de bracket (potencia de 2, byes si es necesario)
4. Escribir bracket en `rockdrop-sessions` como atributo JSON
5. Broadcast WS evento BRACKET_UPDATED

---

### 6. `connect.py` (WebSocket $connect)
**Trigger:** WS $connect  
**Query params:** `session_id`, `player_id`  
**Lógica:**
1. Extraer connectionId de `event.requestContext.connectionId`
2. Update `rockdrop-players` → set ws_connection_id = connectionId, status=CONNECTED

---

### 7. `disconnect.py` (WebSocket $disconnect)
**Trigger:** WS $disconnect  
**Lógica:**
1. Buscar player por connectionId en GSI `connection-index`
2. Update status=DISCONNECTED, clear ws_connection_id
3. Broadcast WS evento PLAYER_DISCONNECTED

---

## Layer: `common/ws.py` — Broadcast helper

```python
import boto3

apigw = boto3.client('apigatewaymanagementapi', 
                      endpoint_url=f"https://{WS_API_ID}.execute-api.us-east-1.amazonaws.com/prod")

def broadcast(session_id, event_name, payload, exclude_player_id=None):
    """Envía mensaje a todos los players conectados en una sesión"""
    players = get_connected_players(session_id)  # query DynamoDB
    message = json.dumps({"event": event_name, "payload": payload})
    
    for player in players:
        if player['player_id'] == exclude_player_id:
            continue
        try:
            apigw.post_to_connection(
                ConnectionId=player['ws_connection_id'],
                Data=message.encode()
            )
        except apigw.exceptions.GoneException:
            # Connection stale, marcar como DISCONNECTED
            mark_disconnected(player['player_id'])
```

---

## Variables de entorno (SSM Parameter Store)

```
/rockdrop/prod/JWT_SECRET          # Firma de tokens QR
/rockdrop/prod/WS_API_ID           # ID del WebSocket API
/rockdrop/prod/WS_STAGE            # "prod"
/rockdrop/prod/SESSIONS_TABLE      # "rockdrop-sessions"
/rockdrop/prod/PLAYERS_TABLE       # "rockdrop-players"
/rockdrop/prod/MOVES_TABLE         # "rockdrop-moves"
/rockdrop/prod/ROUNDS_TABLE        # "rockdrop-rounds"
```

---

## Terraform — Módulos a crear

### `modules/dynamodb/main.tf`
- 4 tablas con sus GSIs
- TTL habilitado en `rockdrop-sessions` (campo `expires_at`)
- PAY_PER_REQUEST billing mode

### `modules/api_gateway_rest/main.tf`
- REST API con recursos y métodos
- Lambda integrations con proxy
- CORS habilitado para PWA guests
- API Key para endpoint del Host

### `modules/api_gateway_ws/main.tf`
- WebSocket API
- Routes: $connect, $disconnect, $default
- Stage: prod con auto-deploy

### `modules/lambdas/main.tf`
- Función por cada Lambda con su IAM role
- Layer compartido (common/)
- Variables de entorno desde SSM
- Timeout: 10s para REST, 3s para WebSocket handlers

---

## EventBridge Rule

```json
{
  "source": ["rockdrop.game"],
  "detail-type": ["AllMovesSubmitted"],
  "detail": {
    "session_id": [{ "exists": true }],
    "round_number": [{ "exists": true }]
  }
}
```
**Target:** Lambda `resolve_round`

---

## IAM Permissions por Lambda

Cada Lambda tiene su propio rol con least-privilege:

| Lambda | DynamoDB | API GW WS | SSM | EventBridge |
|--------|----------|-----------|-----|-------------|
| create_session | PutItem sessions, players | — | GetParameter | — |
| join_session | PutItem players, GetItem sessions | PostToConnection | GetParameter | — |
| submit_move | PutItem moves, GetItem | PostToConnection | GetParameter | PutEvents |
| resolve_round | Query moves, PutItem rounds, Update players | PostToConnection | GetParameter | — |
| generate_bracket | Query players, UpdateItem sessions | PostToConnection | GetParameter | — |
| connect | UpdateItem players | — | GetParameter | — |
| disconnect | Query players (GSI), UpdateItem | PostToConnection | GetParameter | — |

---

## Testing

### `tests/test_game.py`
Casos a cubrir:
- [ ] Crear sesión → valida session_id y qr_token generados
- [ ] Join con token válido → player agregado
- [ ] Join con token expirado → 401
- [ ] Submit move válido → accepted=true
- [ ] Submit move duplicado → error idempotency
- [ ] Resolve round FREE_FOR_ALL: ROCK vs SCISSORS → ROCK gana
- [ ] Resolve round: todos empatan → TIE, no cambia scores
- [ ] Todos los jugadores enviaron → EventBridge event disparado

### `tests/test_tournament.py`
- [ ] Bracket 4 jugadores → 2 matches generados
- [ ] Bracket 3 jugadores → 1 bye asignado
- [ ] Advance bracket → ganadores pasan a siguiente ronda

---

## Checklist de implementación

- [ ] Crear tablas DynamoDB con Terraform
- [ ] Implementar Lambda Layer (common/)
- [ ] Implementar lambdas/session/ (create, get, close)
- [ ] Implementar lambdas/player/ (join, get_players)
- [ ] Implementar lambdas/websocket/ (connect, disconnect)
- [ ] Implementar lambdas/game/ (submit_move, resolve_round, get_result)
- [ ] Implementar lambdas/tournament/ (generate, advance, get)
- [ ] Configurar REST API Gateway con Terraform
- [ ] Configurar WebSocket API Gateway con Terraform
- [ ] Configurar EventBridge rule
- [ ] Tests unitarios
- [ ] Deploy a dev → smoke test
- [ ] Deploy a prod
- [ ] Script warmup.py para el día del talk

---

## Notas para Claude Code

1. **Python version:** 3.12 en todas las funciones
2. **Dependencies:** `boto3`, `pydantic==2.x`, `python-jose` (JWT), `ulid-py` (IDs)
3. **Patrón de respuesta REST:** siempre retornar `{"data": {}, "error": null}` o `{"data": null, "error": "mensaje"}`
4. **Logging:** usar `aws_lambda_powertools` Logger con structured logging
5. **Idempotency:** usar `aws_lambda_powertools` idempotency decorator en submit_move y resolve_round
6. **No usar** `datetime.now()` directamente — usar `datetime.utcnow().isoformat() + "Z"`
7. **DynamoDB:** usar `boto3.resource` no `boto3.client` para operaciones de tabla
8. **El proyecto ya tiene** patrón Terraform parametrizado por environment (dev/prod) — seguir el mismo patrón de TandasMX
