# RockDrop — Documentación Backend

Stack: AWS Lambda (Python 3.12) · DynamoDB · API Gateway REST + WebSocket · EventBridge · S3 · CloudFront

---

## Estructura del repositorio

```
rockdrop/
├── infra/
│   ├── main.tf                        # Provider + backend S3 + módulos
│   ├── variables.tf                   # aws_region, environment, ws_stage, web_bucket_name, web_app_url
│   ├── outputs.tf                     # rest_api_url, ws_api_url, web_app_url, web_bucket_name, cloudfront_distribution_id
│   ├── cloudfront.tf                  # S3 privado + CloudFront OAC
│   ├── backends/
│   │   ├── dev.hcl
│   │   └── prod.hcl
│   ├── envs/
│   │   ├── dev.tfvars
│   │   └── prod.tfvars.example
│   ├── bootstrap/
│   │   └── main.tf                    # S3 tfstate + DynamoDB locks + OIDC role (state local)
│   └── modules/
│       ├── dynamodb/main.tf
│       ├── api_gateway_rest/
│       │   ├── main.tf
│       │   └── cors.tf                # OPTIONS mock con CORS headers en los 8 recursos
│       ├── api_gateway_ws/main.tf
│       └── lambdas/main.tf
├── lambdas/
│   ├── session/
│   │   ├── create_session.py
│   │   ├── get_session.py
│   │   ├── close_session.py
│   │   └── start_session.py           # POST /sessions/{id}/start — inicia juego + genera bracket si es TOURNAMENT
│   ├── player/
│   │   ├── join_session.py
│   │   └── get_players.py
│   ├── game/
│   │   ├── submit_move.py             # Soporta FFA y TOURNAMENT (match_id)
│   │   ├── resolve_round.py           # FFA global + TOURNAMENT por partida con best-of-3
│   │   └── get_round_result.py
│   ├── tournament/
│   │   ├── generate_bracket.py        # Deprecado — bracket ahora generado en start_session
│   │   ├── advance_bracket.py         # Deprecado — avance automático en resolve_round
│   │   └── get_bracket.py
│   ├── websocket/
│   │   ├── connect.py
│   │   ├── disconnect.py
│   │   └── broadcast.py
│   └── layers/
│       ├── requirements.txt           # aws-lambda-powertools, python-jose, pydantic
│       ├── src/                       # Fuentes commiteados
│       │   ├── auth.py
│       │   ├── db.py
│       │   ├── models.py
│       │   └── ws.py
│       └── common/                    # Build artifact (gitignoreado, generado por make build-layer)
│           └── python/
├── app/                               # Frontend React + Vite
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
  "wins_needed": 2,
  "current_tournament_round": 1,
  "total_tournament_rounds": 2,
  "champion_id": null,
  "matches": [
    {
      "match_id": "r1_m1",
      "tournament_round": 1,
      "player1_id": "uuid", "player1_name": "Alice", "player1_wins": 0,
      "player2_id": "uuid", "player2_name": "Bob",   "player2_wins": 0,
      "current_match_round": 1,
      "status": "ACTIVE | BYE | COMPLETE",
      "winner_id": null
    }
  ]
}
```

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
| `GET` | `/sessions/{id}` | `get_session` | |
| `DELETE` | `/sessions/{id}` | `close_session` | 🔒 Host |
| `POST` | `/sessions/{id}/start` | `start_session` | 🔒 Host — transiciona a PLAYING, genera bracket si TOURNAMENT |
| `POST` | `/sessions/{id}/players` | `join_session` | JWT en body |
| `GET` | `/sessions/{id}/players` | `get_players` | |
| `POST` | `/sessions/{id}/game/move` | `submit_move` | |
| `GET` | `/sessions/{id}/game/round/{n}` | `get_round_result` | |
| `POST` | `/sessions/{id}/tournament/bracket` | `generate_bracket` | Deprecado |
| `GET` | `/sessions/{id}/tournament/bracket` | `get_bracket` | |
| `PUT` | `/sessions/{id}/tournament/bracket/advance` | `advance_bracket` | Deprecado |

🔒 = requiere `x-host-token` header (validado en la Lambda)

Todos los endpoints tienen método `OPTIONS` configurado con MOCK integration que retorna CORS headers.

### Formato de respuesta estándar
```json
{ "data": { ... }, "error": null }
{ "data": null,    "error": "mensaje de error" }
```

Todos los responses incluyen:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type,x-host-token
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
```

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
| `GAME_STARTED` | Host llama start_session | `mode`, `bracket` (si TOURNAMENT) |
| `PLAYER_JOINED` | Guest hace join | `player_id`, `display_name`, `total_players` |
| `PLAYER_DISCONNECTED` | WS $disconnect | `player_id`, `display_name` |
| `MOVE_SUBMITTED` | Jugador envía movimiento | `player_id`, `match_id`?, `submitted_count`, `waiting_for` |
| `ROUND_RESOLVED` | resolve_round termina | `round_number`, `match_id`?, `results`, `winner_id`, `match_score`? |
| `MATCH_FINISHED` | Partido completo (TOURNAMENT) | `match_id`, `winner_id`, `loser_id`, `winner_name`, `loser_name`, `score` |
| `TOURNAMENT_ROUND_COMPLETE` | Todos los partidos de la ronda terminan | `next_tournament_round`, `new_matches`, `bracket` |
| `CHAMPION_DECLARED` | Final del torneo | `champion_id`, `champion_name` |
| `GAME_FINISHED` | Host cierra sesión (FFA) | `session_id`, `reason` |

---

## Flujo TOURNAMENT detallado

```
Host → POST /sessions          (mode=TOURNAMENT)
Host → POST /sessions/{id}/start
  └─ build_bracket(players, wins_needed=2)
  └─ broadcast GAME_STARTED {bracket}

Cada partida activa (ACTIVE matches):
  Jugador A → POST /sessions/{id}/game/move {match_id, round_number}
  Jugador B → POST /sessions/{id}/game/move {match_id, round_number}
    └─ EventBridge AllMovesSubmitted {mode=TOURNAMENT, match_id}
    └─ resolve_round: 1v1, actualiza player_X_wins en bracket
    └─ broadcast ROUND_RESOLVED {match_score}

  Si player_wins >= wins_needed:
    └─ match.status = COMPLETE
    └─ broadcast MATCH_FINISHED {winner_id, loser_id}

    Si todos los matches de la ronda están COMPLETE/BYE:
      Si queda 1 jugador:
        └─ session.status = FINISHED
        └─ broadcast CHAMPION_DECLARED
      Si quedan ≥ 2 jugadores:
        └─ build next round matches
        └─ broadcast TOURNAMENT_ROUND_COMPLETE {new_matches}
```

---

## Lambda Layer

Fuentes en `lambdas/layers/src/`:

| Archivo | Contenido |
|---|---|
| `auth.py` | `create_qr_token(session_id)`, `validate_qr_token(token)` — usa SSM `/rockdrop/{env}/JWT_SECRET` |
| `db.py` | Tablas DynamoDB, helpers: `get_session`, `get_all_players`, `get_connected_players`, `get_moves_for_round` |
| `models.py` | Pydantic models, `ok(data)`, `err(message)`, `make_response(status, body)`, `json_dumps(obj)` |
| `ws.py` | `broadcast(session_id, event, payload)`, `send_to_player(connection_id, event, payload)` |

Build: `make build-layer` — pip install a `layers/common/python/` (gitignoreado) con `--platform manylinux2014_x86_64`.

---

## Infraestructura

### S3 + CloudFront
- Bucket S3 privado con OAC (solo CloudFront puede leer)
- CloudFront HTTPS → S3 → sirve `index.html` para rutas SPA
- `custom_error_response`: 403/404 → `index.html` (200)
- URL pública: `https://{id}.cloudfront.net` (output `web_app_url`)

### Terraform variables
| Variable | Dev | Prod |
|---|---|---|
| `environment` | `dev` | `prod` |
| `web_bucket_name` | `rockdrop-web-dev` | `rockdrop-web` |
| `web_app_url` | URL CloudFront dev | URL CloudFront prod |
| `ws_stage` | `dev` | `prod` |

### Bootstrap (una sola vez por cuenta)
```bash
cd infra/bootstrap && terraform init && terraform apply
```
Crea: S3 tfstate, DynamoDB locks, OIDC role `rockdrop-github-actions-deploy`.

---

## Comandos principales

```bash
make sso-dev          # Login SSO jajc-dev
make deploy-dev       # build-layer + terraform apply dev
make sync-web-dev     # build React + S3 sync + CloudFront invalidation
make plan-dev         # terraform plan dev
```

---

## CI/CD — GitHub Actions

**Workflow:** `.github/workflows/deploy-dev.yml`  
**Trigger:** push a rama `dev`

Pasos:
1. OIDC → rol `rockdrop-github-actions-deploy` en cuenta dev
2. `pip3 install` del layer (manylinux2014_x86_64)
3. `terraform apply` (infra + lambdas)
4. Leer outputs `rest_api_url` + `ws_api_url` → `$GITHUB_ENV`
5. `npm run build` con `VITE_API_URL` + `VITE_WS_URL` como env vars
6. `aws s3 sync` + CloudFront invalidation

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

## Notas de implementación

- **`results` en ROUND_RESOLVED** es un objeto `{player_id: {move, outcome}}`, no array
- **moves PK en TOURNAMENT**: `{session_id}#{match_id}#{match_round}` — no usar solo `round_number`
- **`resolve_round`** recibe `mode` y `match_id` en el detalle de EventBridge para bifurcar FFA/TOURNAMENT
- **`generate_bracket` y `advance_bracket`** son lambdas deprecadas — la lógica ahora vive en `start_session` y `resolve_round`
- **CORS**: todos los responses pasan por `make_response()` del layer que incluye los headers automáticamente
- **`join_url` del QR**: formato `{WEB_APP_URL}/#/join?token={qr_token}` — el `#` es crítico para HashRouter
