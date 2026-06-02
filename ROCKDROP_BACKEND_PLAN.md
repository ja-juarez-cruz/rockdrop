# RockDrop — Documentación Backend

Stack: AWS Lambda (Python 3.12) · DynamoDB · API Gateway REST + WebSocket · EventBridge · S3 · CloudFront

---

## Estructura del repositorio

```
rockdrop/
├── infra/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── cloudfront.tf
│   ├── backends/
│   │   ├── dev.hcl
│   │   └── prod.hcl
│   ├── envs/
│   │   ├── dev.tfvars
│   │   └── prod.tfvars.example
│   ├── bootstrap/
│   │   └── main.tf
│   └── modules/
│       ├── dynamodb/main.tf
│       ├── api_gateway_rest/
│       │   ├── main.tf
│       │   └── cors.tf
│       ├── api_gateway_ws/main.tf
│       └── lambdas/main.tf
├── lambdas/
│   ├── session/
│   │   ├── create_session.py
│   │   ├── get_session.py
│   │   ├── close_session.py
│   │   └── start_session.py       # POST /sessions/{id}/start — modo auto por nº jugadores, genera bracket completo
│   ├── player/
│   │   ├── join_session.py
│   │   └── get_players.py
│   ├── game/
│   │   ├── submit_move.py         # FFA y TOURNAMENT; convierte current_match_round a int
│   │   ├── resolve_round.py       # FFA best-of-5; TOURNAMENT llena slots pre-generados
│   │   └── get_round_result.py
│   ├── tournament/
│   │   ├── generate_bracket.py    # Deprecado
│   │   ├── advance_bracket.py     # Deprecado
│   │   └── get_bracket.py
│   ├── websocket/
│   │   ├── connect.py
│   │   ├── disconnect.py
│   │   └── broadcast.py
│   └── layers/
│       ├── requirements.txt
│       ├── src/
│       │   ├── auth.py
│       │   ├── db.py
│       │   ├── models.py          # json_dumps con _DecimalEncoder
│       │   └── ws.py              # broadcast usa json_dumps (soporta Decimal de DynamoDB)
│       └── common/python/         # build artifact (gitignoreado)
├── app/                           # Frontend React + Vite
├── .github/workflows/deploy-dev.yml
├── Makefile
└── .gitignore
```

---

## DynamoDB — Tablas

### `rockdrop-sessions-{env}`
| Atributo | Tipo | Descripción |
|---|---|---|
| `session_id` | PK String | UUID v4 |
| `sk` | SK String | Siempre `"METADATA"` |
| `host_player_id` | String | UUID del host |
| `status` | String | `WAITING \| PLAYING \| FINISHED` |
| `mode` | String | `FREE_FOR_ALL \| TOURNAMENT` |
| `max_players` | Number | default 32 |
| `current_round` | Number | Ronda actual (1 al iniciar) |
| `bracket` | Map | Solo TOURNAMENT — ver estructura abajo |
| `qr_token` | String | JWT firmado, expira 1h |
| `expires_at` | Number | TTL Unix timestamp |

**Estructura `bracket` (TOURNAMENT):**
```json
{
  "wins_needed": 3,
  "current_tournament_round": 1,
  "total_tournament_rounds": 2,
  "champion_id": null,
  "matches": [
    {
      "match_id": "r1_m1",
      "tournament_round": 1,
      "player1_id": "uuid", "player1_name": "Alice", "player1_wins": 0,
      "player2_id": "uuid", "player2_name": "Bob",   "player2_wins": 0,
      "player3_id": "uuid", "player3_name": "Carol", "player3_wins": 0,
      "player_count": 3,
      "current_match_round": 1,
      "status": "ACTIVE | COMPLETE",
      "winner_id": null,
      "source_matches": []
    },
    {
      "match_id": "r1_m2",
      "tournament_round": 1,
      "player1_id": "uuid", "player1_name": "Dave",  "player1_wins": 0,
      "player2_id": "uuid", "player2_name": "Eve",   "player2_wins": 0,
      "player_count": 2,
      "current_match_round": 1,
      "status": "ACTIVE | COMPLETE",
      "winner_id": null,
      "source_matches": []
    },
    {
      "match_id": "r2_m1",
      "tournament_round": 2,
      "player1_id": null, "player1_name": "Ganador r1_m1", "player1_wins": 0,
      "player2_id": null, "player2_name": "Ganador r1_m2", "player2_wins": 0,
      "player_count": 2,
      "current_match_round": 1,
      "status": "PENDING",
      "winner_id": null,
      "source_matches": ["r1_m1", "r1_m2"]
    }
  ]
}
```
*(Ejemplo con 5 jugadores: R1 tiene una sala de 3 y una de 2; R2 es la final 1v1.)*

**Notas importantes sobre el bracket:**
- El bracket completo (todos los rounds) se genera en `start_session` — los rounds futuros tienen `status: "PENDING"` y `source_matches`
- **Sin BYEs**: cuando el número de jugadores es impar, una sala del Round 1 recibe 3 jugadores (FFA sub-match) en vez de crear un BYE
- `player_count` indica cuántos jugadores tiene el match (2 ó 3); los campos `player3_id / player3_name / player3_wins` solo existen cuando `player_count = 3`
- `resolve_round` llena slots PENDING con ganadores (via `_fill_winner_slot`) en vez de construir rounds nuevos
- El campo `source_matches` indica qué matches alimentan cada slot futuro; puede tener 2 ó 3 entradas
- `wins_needed: 3` — primero en ganar 3 rondas de PPT dentro del match avanza (best-of-5)

### `rockdrop-players-{env}`
| Atributo | Tipo | Descripción |
|---|---|---|
| `session_id` | PK String | |
| `player_id` | SK String | UUID v4 |
| `display_name` | String | |
| `is_host` | Boolean | |
| `ws_connection_id` | String | API GW connection ID |
| `score` | Number | Victorias acumuladas |
| `status` | String | `CONNECTED \| DISCONNECTED` |

GSI: `connection-index (ws_connection_id)` — para lookup en `$disconnect`.

### `rockdrop-moves-{env}`
| Atributo | Tipo | Descripción |
|---|---|---|
| `pk` | PK String | `{session_id}#{round}` (FFA) o `{session_id}#{match_id}#{round}` (TOURNAMENT) |
| `player_id` | SK String | |
| `move` | String | `ROCK \| PAPER \| SCISSORS` |
| `round_number` | Number | |
| `match_id` | String | Solo TOURNAMENT |

### `rockdrop-rounds-{env}`
| Atributo | Tipo | Descripción |
|---|---|---|
| `session_id` | PK String | |
| `round_number` | SK String | `"1"`, `"2"`, … |
| `results` | Map | `{player_id: {move, outcome}}` |
| `winner_id` | String | null si empate |
| `resolved_at` | String | ISO8601 |

---

## API Gateway REST — Endpoints

Base URL: `https://{api-id}.execute-api.us-east-1.amazonaws.com/{env}`

| Método | Path | Lambda | Notas |
|---|---|---|---|
| `POST` | `/sessions` | `create_session` | 🔒 Host |
| `GET` | `/sessions/{id}` | `get_session` | Devuelve campo `bracket` si existe |
| `DELETE` | `/sessions/{id}` | `close_session` | 🔒 Host |
| `POST` | `/sessions/{id}/start` | `start_session` | 🔒 Host — genera bracket completo |
| `POST` | `/sessions/{id}/players` | `join_session` | JWT en body |
| `GET` | `/sessions/{id}/players` | `get_players` | |
| `POST` | `/sessions/{id}/game/move` | `submit_move` | |
| `GET` | `/sessions/{id}/game/round/{n}` | `get_round_result` | |
| `GET` | `/sessions/{id}/tournament/bracket` | `get_bracket` | |

🔒 = requiere `x-host-token` header (validado en la Lambda)

---

## API Gateway WebSocket

URL: `wss://{ws-id}.execute-api.us-east-1.amazonaws.com/{env}`

Conexión: `?session_id={id}&player_id={id}`

| Route | Lambda | Acción |
|---|---|---|
| `$connect` | `connect.py` | Marca jugador CONNECTED, guarda connection_id |
| `$disconnect` | `disconnect.py` | Marca jugador DISCONNECTED, broadcast PLAYER_DISCONNECTED |
| `$default` | `broadcast.py` | Echo de mensajes del cliente |

### Eventos servidor → cliente

Todos los mensajes tienen formato:
```json
{ "event": "NOMBRE_EVENTO", "payload": { ... } }
```

| Evento | Cuándo | Payload clave |
|---|---|---|
| `GAME_STARTED` | Host llama start_session | `mode`, `bracket` (si TOURNAMENT, bracket completo con todos los rounds) |
| `PLAYER_JOINED` | Guest hace join | `player_id`, `display_name`, `total_players` |
| `PLAYER_DISCONNECTED` | WS $disconnect | `player_id`, `display_name` |
| `MOVE_SUBMITTED` | Jugador envía movimiento | `player_id`, `match_id`?, `submitted_count`, `waiting_for` |
| `ROUND_RESOLVED` | resolve_round termina | `round_number`, `match_id`?, `results`, `winner_id`, `match_score`? |
| `MATCH_FINISHED` | Partido completo (TOURNAMENT) | `match_id`, `winner_id`, `winner_name`, `loser_id`*, `loser_name`*, `losers` (array), `score` |
| `TOURNAMENT_ROUND_COMPLETE` | Todos los partidos de la ronda terminan | `next_tournament_round`, `new_matches`, `bracket` |
| `CHAMPION_DECLARED` | Final del torneo | `champion_id`, `champion_name` |
| `GAME_FINISHED` | Host cierra sesión (FFA) | `session_id`, `reason` |

---

## Lógica de modos

### Determinación automática de modo (`start_session.py`)
| Jugadores | Modo | Descripción |
|---|---|---|
| 2–3 | `FREE_FOR_ALL` | Todos contra todos, primero en **3 victorias** gana |
| 4+ | `TOURNAMENT` | Bracket eliminatorio sin BYEs; primero en **3 rondas** dentro de su match avanza |

**Distribución de salas en TOURNAMENT (`_group_sizes`):**
- **Nº de jugadores par**: todos los matches son 1v1 (grupos de 2)
- **Nº de jugadores impar**: una sala recibe 3 jugadores (FFA sub-match), el resto son 1v1
  - Ej. 5 jugadores → R1: [sala de 3, sala de 2] → R2: final 1v1
  - Ej. 7 jugadores → R1: [sala de 3, sala de 2, sala de 2] → R2: [sala de 3] → campeón
- **Sin BYEs**: este esquema elimina los pases directos en todas las configuraciones de jugadores

### Flujo FREE_FOR_ALL
```
Host → POST /sessions/start
  └─ mode = FREE_FOR_ALL, broadcast GAME_STARTED

Cada ronda:
  Todos los jugadores → POST /game/move {round_number}
  EventBridge AllMovesSubmitted → resolve_round
  └─ broadcast ROUND_RESOLVED {results, winner_id}
  └─ si algún jugador llega a score ≥ 3: broadcast CHAMPION_DECLARED, session FINISHED
```

### Flujo TOURNAMENT detallado
```
Host → POST /sessions/start
  └─ build_bracket(players) — genera TODOS los rounds upfront
  └─ R1: matches ACTIVE con jugadores reales (2 ó 3 jugadores por sala)
  └─ R2+: matches PENDING con source_matches y nombres "Ganador r1_m1"
  └─ broadcast GAME_STARTED {bracket completo}

Cada match activo (2 ó 3 jugadores):
  Jugadores → POST /game/move {match_id, round_number=current_match_round}
    └─ submit_move: espera player_count jugadores (2 ó 3) antes de disparar EventBridge
    └─ EventBridge AllMovesSubmitted {mode=TOURNAMENT, match_id}
    └─ resolve_round: 1v1 → comparación directa; 3 jugadores → lógica FFA (todos contra todos)
    └─ actualiza player_X_wins en bracket
    └─ broadcast ROUND_RESOLVED {match_score}

  Si player_wins >= wins_needed (3):
    └─ match.status = COMPLETE, match.winner_id = ganador
    └─ _fill_winner_slot: llena el slot del próximo match PENDING
    └─ si todos los slots del próximo match están llenos: ese match pasa a ACTIVE
    └─ broadcast MATCH_FINISHED {losers: [{player_id, player_name}]}

    Si todos los matches del round están COMPLETE:
      Si current_round == total_rounds:
        └─ champion_id = ganador, session.status = FINISHED
        └─ broadcast CHAMPION_DECLARED
      Si no:
        └─ current_tournament_round++
        └─ broadcast TOURNAMENT_ROUND_COMPLETE {bracket actualizado}
```

---

## Correcciones críticas implementadas

### Bug: `json.dumps` no soporta `Decimal` de DynamoDB
**Causa**: Los números almacenados en DynamoDB se deserializan como `Decimal` en Python. El `broadcast` en `ws.py` usaba `json.dumps` estándar que no soporta `Decimal`.

**Fix**: `ws.py` importa y usa `json_dumps` de `models.py` que tiene `_DecimalEncoder`.

```python
# ws.py — antes
message = json.dumps({"event": event_name, "payload": payload}).encode()

# ws.py — después
from models import json_dumps
message = json_dumps({"event": event_name, "payload": payload}).encode()
```

Esto afectaba especialmente al tournament donde `current_match_round` (Decimal) se incluía en el payload de `broadcast`.

### Bug: `current_round = 0` en submit_move
`submit_move.py` lee `current_match_round` de DynamoDB como `Decimal`. Se convierte explícitamente a `int` para garantizar correcto formateo de PK:
```python
match_round = int(my_match["current_match_round"])
```

---

## Lambda Layer (`lambdas/layers/src/`)

| Archivo | Contenido |
|---|---|
| `auth.py` | `create_qr_token(session_id)`, `validate_qr_token(token)` |
| `db.py` | Tablas DynamoDB, helpers de lectura |
| `models.py` | Pydantic models, `json_dumps` con `_DecimalEncoder`, `ok()`, `err()`, `make_response()` |
| `ws.py` | `broadcast()` usa `json_dumps` (soporta Decimal), `send_to_player()` |

Build: `make build-layer`

---

## Variables de entorno Lambda

| Variable | Descripción |
|---|---|
| `SESSIONS_TABLE` | Nombre tabla sessions |
| `PLAYERS_TABLE` | Nombre tabla players |
| `MOVES_TABLE` | Nombre tabla moves |
| `ROUNDS_TABLE` | Nombre tabla rounds |
| `WS_API_ID` | ID del WebSocket API GW |
| `WS_STAGE` | Stage del WebSocket (dev/prod) |
| `WEB_APP_URL` | URL CloudFront del frontend |
| `ENVIRONMENT` | dev / prod |
| `LOG_LEVEL` | INFO |
| `POWERTOOLS_SERVICE_NAME` | rockdrop |

Secrets en SSM: `/rockdrop/{env}/JWT_SECRET`

---

## Infraestructura

- S3 privado + CloudFront OAC, custom_error_response 403/404 → index.html (SPA)
- Terraform con backends por environment (`dev.hcl`, `prod.hcl`)

## Comandos principales

```bash
make sso-dev          # Login SSO jajc-dev
make deploy-dev       # build-layer + terraform apply dev
make sync-web-dev     # build React + S3 sync + CloudFront invalidation
make plan-dev         # terraform plan dev
```

## CI/CD

**Workflow:** `.github/workflows/deploy-dev.yml` — push a rama `dev`

1. OIDC → rol `rockdrop-github-actions-deploy`
2. `pip3 install` del layer (manylinux2014_x86_64)
3. `terraform apply`
4. Leer outputs → `$GITHUB_ENV`
5. `npm run build` con `VITE_API_URL` + `VITE_WS_URL`
6. `aws s3 sync` + CloudFront invalidation

---

## Notas de implementación

- **`results` en ROUND_RESOLVED** es un objeto `{player_id: {move, outcome}}`, no array
- **moves PK en TOURNAMENT**: `{session_id}#{match_id}#{match_round}` — `match_round` viene del bracket (no de `body.round_number`)
- **`body.round_number`** en TOURNAMENT solo sirve para pasar validación Pydantic (≥ 1); el round real usa `my_match["current_match_round"]`
- **`MATCH_FINISHED.losers`** es un array `[{player_id, player_name}]` con todos los eliminados del match; `loser_id` / `loser_name` se mantienen por compatibilidad hacia atrás (apuntan al primer perdedor)
- **`player_count`** en cada match indica el número de jugadores (2 ó 3); `player3_id / player3_name / player3_wins` solo existen cuando `player_count = 3`
- **CORS**: todos los responses pasan por `make_response()` del layer que incluye los headers. Si el Lambda crashea, API GW devuelve 502 sin headers CORS → el browser lanza como error de red
- **`join_url` del QR**: `{WEB_APP_URL}/#/join?token={qr_token}` — el `#` es crítico para HashRouter
- **BYEs en bracket**: `start_session._fill_slot` propaga el ganador del BYE a los slots PENDING inmediatamente al generar el bracket
