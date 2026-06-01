# RockDrop — Guía de integración frontend

Stack: React 18 · Vite · Tailwind CSS · Zustand · HashRouter

---

## Entornos

| Entorno | URL |
|---|---|
| Dev (CloudFront) | `https://d2yd85vzfy5ijm.cloudfront.net` |
| Dev (API REST) | `https://2kvig6o394.execute-api.us-east-1.amazonaws.com/dev` |
| Dev (WebSocket) | `wss://{ws-id}.execute-api.us-east-1.amazonaws.com/dev` |

Las URLs exactas están en los outputs de Terraform:
```bash
make plan-dev  # muestra rest_api_url y ws_api_url
```

---

## Routing

Usa `HashRouter` — las rutas son del tipo `https://domain.com/#/ruta`.

| Ruta | Página | Quién la ve |
|---|---|---|
| `/#/host` | `HostPage` | Host (crear sesión) |
| `/#/join?token=xxx` | `JoinPage` | Guest (unirse con QR) |
| `/#/lobby/:sessionId` | `LobbyPage` | Todos (sala de espera) |
| `/#/game/:sessionId` | `GamePage` | Todos (FREE_FOR_ALL) |
| `/#/tournament/:sessionId` | `TournamentPage` | Todos (TOURNAMENT) |
| `/#/finished/:sessionId` | `FinishedPage` | Todos (resultado final) |

El `join_url` del QR **debe incluir el `#`**: `https://domain.com/#/join?token=xxx`.

---

## Autenticación

| Actor | Mecanismo |
|---|---|
| Host (web) | `x-host-token` header en endpoints protegidos |
| Guest | JWT `qr_token` en el body de `POST /players` — firmado HS256, expira 1h |

El `host_player_id` se genera con `crypto.randomUUID()` y se persiste en `localStorage`.

---

## Variables de entorno

```bash
# app/.env.local (dev local)
VITE_API_URL=https://2kvig6o394.execute-api.us-east-1.amazonaws.com/dev
VITE_WS_URL=wss://{ws-id}.execute-api.us-east-1.amazonaws.com/dev
```

En desarrollo local (`npm run dev`), `API_URL = '/api'` — Vite proxea al API Gateway evitando CORS.  
En producción (`npm run build`), `API_URL = VITE_API_URL`.

---

## Formato de respuesta

```json
{ "data": { ... }, "error": null }   // éxito
{ "data": null, "error": "mensaje" } // error
```

`api.js` hace unwrap de `response.data` y lanza `Error` con `response.error` en caso de fallo.

---

## REST API

### POST /sessions 🔒
Crea sesión. Guarda `session_id`, `qr_token`, `ws_url` en store.

```json
// Request
{ "host_player_id": "uuid", "display_name": "string", "mode": "FREE_FOR_ALL|TOURNAMENT", "max_players": 2-100 }

// Response 201
{ "data": { "session_id": "uuid", "qr_token": "eyJ...", "ws_url": "wss://...", "join_url": "https://.../#/join?token=..." } }
```

### POST /sessions/{id}/start 🔒
Inicia el juego. Para TOURNAMENT genera el bracket automáticamente.

```json
// Request
{ "host_player_id": "uuid" }

// Response 200
{ "data": { "session_id": "uuid", "status": "PLAYING", "bracket": { ... } } }
// Emite WS: GAME_STARTED
```

### GET /sessions/{id}
```json
// Response 200
{ "data": { "session_id": "uuid", "status": "WAITING|PLAYING|FINISHED", "mode": "string", "current_round": 1, "max_players": 30, "host_player_id": "uuid", "created_at": "ISO8601" } }
```

> `qr_token` y `join_url` están **excluidos** de esta respuesta.

### DELETE /sessions/{id} 🔒
Cierra sesión. Emite WS `GAME_FINISHED`.

### POST /sessions/{id}/players
Guest se une con el JWT del QR. Guarda `player_id` en store.

```json
// Request
{ "display_name": "string", "token": "eyJ..." }

// Response 201
{ "data": { "player_id": "uuid", "session_id": "uuid", "display_name": "string", "ws_url": "wss://..." } }
```

| Código | Causa |
|---|---|
| `401` | Token inválido o expirado |
| `403` | Token no corresponde a esta sesión |
| `409` | Sesión llena o no en estado WAITING |

### GET /sessions/{id}/players
```json
// Response 200
{ "data": { "players": [{ "player_id": "uuid", "display_name": "string", "is_host": false, "score": 0, "status": "CONNECTED|DISCONNECTED" }], "count": 3 } }
```

### POST /sessions/{id}/game/move
```json
// Request FREE_FOR_ALL
{ "player_id": "uuid", "move": "ROCK|PAPER|SCISSORS", "round_number": 1 }

// Request TOURNAMENT
{ "player_id": "uuid", "move": "ROCK|PAPER|SCISSORS", "round_number": 1, "match_id": "r1_m1" }

// Response 200
{ "data": { "accepted": true, "round_number": 1, "waiting_for": 1, "match_id": "r1_m1" } }
```

> Cuando `waiting_for = 0`, EventBridge dispara `resolve_round` → WS `ROUND_RESOLVED`.

### GET /sessions/{id}/game/round/{n}
```json
// Response 200
{ "data": { "round_number": "1", "results": { "uuid": { "move": "ROCK", "outcome": "WIN|LOSE|TIE" } }, "winner_id": "uuid|null", "resolved_at": "ISO8601" } }
```

> `results` es un **objeto** `{player_id: {...}}`, no array.

### GET /sessions/{id}/tournament/bracket
```json
// Response 200
{ "data": { "bracket": { "wins_needed": 2, "current_tournament_round": 1, "total_tournament_rounds": 2, "champion_id": null, "matches": [ ... ] } } }
```

---

## WebSocket

### Conexión
```
wss://{ws-id}.execute-api.us-east-1.amazonaws.com/{env}
  ?session_id={id}&player_id={id}
```

Al conectar → jugador pasa a `CONNECTED` en DynamoDB.  
Al desconectar → `DISCONNECTED`, API GW cierra idle connections a los 10 min.

### Formato mensajes
```json
{ "event": "NOMBRE_EVENTO", "payload": { ... } }
```

> **Crítico:** el campo es `event`, no `type`. `WebSocketManager.js` usa `msg.event || msg.type`.

### Eventos servidor → cliente

#### `GAME_STARTED`
```json
{ "session_id": "uuid", "mode": "TOURNAMENT", "bracket": { ... } }
```
Emitido cuando el host llama `start_session`. En `LobbyPage`, el polling detecta status PLAYING y navega a `/game` o `/tournament`.

#### `PLAYER_JOINED`
```json
{ "player_id": "uuid", "display_name": "string", "total_players": 3 }
```

#### `PLAYER_DISCONNECTED`
```json
{ "player_id": "uuid", "display_name": "string" }
```

#### `MOVE_SUBMITTED`
```json
{ "player_id": "uuid", "match_id": "r1_m1", "round_number": 1, "submitted_count": 1, "waiting_for": 1 }
```
No revela el movimiento. `match_id` solo en TOURNAMENT.

#### `ROUND_RESOLVED`
```json
{
  "round_number": 1,
  "match_id": "r1_m1",
  "results": {
    "uuid1": { "move": "ROCK",     "outcome": "WIN" },
    "uuid2": { "move": "SCISSORS", "outcome": "LOSE" }
  },
  "winner_id": "uuid1",
  "match_score": { "uuid1": 1, "uuid2": 0 }
}
```
`match_id` y `match_score` solo en TOURNAMENT.

#### `MATCH_FINISHED` (TOURNAMENT)
```json
{ "match_id": "r1_m1", "winner_id": "uuid", "loser_id": "uuid", "winner_name": "string", "loser_name": "string", "score": { "uuid1": 2, "uuid2": 1 } }
```
El loser navega a `/finished/:sessionId` con mensaje "Eliminado".

#### `TOURNAMENT_ROUND_COMPLETE` (TOURNAMENT)
```json
{ "next_tournament_round": 2, "new_matches": [ ... ], "bracket": { ... } }
```

#### `CHAMPION_DECLARED` (TOURNAMENT)
```json
{ "champion_id": "uuid", "champion_name": "string" }
```
Todos navegan a `/finished/:sessionId`.

#### `GAME_FINISHED` (FREE_FOR_ALL)
```json
{ "session_id": "uuid", "reason": "host_closed" }
```

---

## Flujo Free For All

```
Host: /host → crea sesión → /lobby/:id (muestra QR)
Guest: escanea QR → /#/join?token=xxx → /lobby/:id

LobbyPage:
  - polling GET /sessions cada 3s mientras WAITING
  - host ve botón "Iniciar partida" (mínimo 2 jugadores)
  - WS: PLAYER_JOINED actualiza lista
  - cuando session.status → PLAYING: navega a /game/:id

GamePage:
  - MoveSelector con 3 botones 🪨📄✂️
  - al seleccionar: POST /game/move
  - lista jugadores: ✓ Listo / ⏳ Pendiente (vía MOVE_SUBMITTED WS)
  - ROUND_RESOLVED: overlay RoundResult (5s) con resultado de cada jugador
  - GAME_FINISHED: navega a /finished/:id
```

## Flujo Tournament

```
Host: crea sesión mode=TOURNAMENT → lobby → "Iniciar partida"
  start_session genera bracket automático → todos van a /tournament/:id

TournamentPage:
  - marcador: "Tú 1 — 0 Rival"
  - "Primero en ganar 2 rondas avanza"
  - MoveSelector (incluye match_id en submit)
  - ROUND_RESOLVED: overlay con resultado de la ronda
  - MATCH_FINISHED:
      loser → overlay "Eliminado por X" → /finished/:id (3.5s)
      winner → espera TOURNAMENT_ROUND_COMPLETE
  - TOURNAMENT_ROUND_COMPLETE: nuevo match, marcador resetea
  - CHAMPION_DECLARED: → /finished/:id

FinishedPage:
  - eliminado: "Fuiste eliminado — [ganador] ganó el partido"
  - campeón:   "¡Eres el campeón!" 🏆
  - otros:     ranking final
```

---

## Zustand store — Estado relevante

```js
{
  // Sesión
  sessionId, session, playerId, isHost, qrToken, wsUrl,

  // Jugadores
  players,            // [{ player_id, display_name, is_host, score, status }]

  // Juego
  currentRound,       // número de ronda dentro del match (1, 2, 3...)
  myMove,             // movimiento enviado esta ronda
  waitingFor,         // cuántos jugadores faltan
  submittedPlayers,   // [player_id] que ya tiraron esta ronda
  lastRoundResult,    // payload de ROUND_RESOLVED (para overlay)

  // Torneo
  bracket,            // objeto completo del bracket
  myMatch,            // match activo del jugador actual
  eliminatedBy,       // display_name del jugador que eliminó (si aplica)
  championId,         // player_id del campeón (si aplica)

  // WebSocket
  wsStatus,           // 'connecting' | 'connected' | 'disconnected' | 'error'
}
```

---

## Consideraciones de implementación

**JWT del QR:** decodificar con `atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))` — sin librería.

**Hash routing y QR:** la URL del QR **debe** tener el formato `origin/#/join?token=xxx`. Sin el `#`, HashRouter no reconoce la ruta y redirige al catch-all `/host`.

**Reconexión WebSocket:** `WebSocketManager` implementa exponential backoff (1→2→4…s, máx 5 reintentos). Al reconectar con mismo `player_id`, `$connect` actualiza el `connection_id` en DynamoDB.

**No polling en GamePage:** todos los cambios de estado (movimientos, resultados, bracket) llegan por WebSocket. El único polling es en LobbyPage (cada 3s) para detectar el cambio WAITING→PLAYING.

**Scores en tiempo real:** `ROUND_RESOLVED` incluye `results.outcome` → store suma +1 al ganador directamente sin REST. En TOURNAMENT los puntos del match se calculan de `match_score`.

**TTL sesión:** 1 hora desde creación. El cliente recibe 404 al intentar operar en sesión expirada.
