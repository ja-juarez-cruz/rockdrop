# RockDrop — Guía de integración para el frontend

Piedra Papel Tijera multijugador sin instalación. El host crea una sesión desde la app nativa, los guests se unen escaneando un QR desde el navegador.

---

## Entornos

| Entorno | REST base URL | WebSocket URL |
|---------|--------------|---------------|
| Dev  | `https://{api-id}.execute-api.us-east-1.amazonaws.com/dev`  | `wss://{ws-id}.execute-api.us-east-1.amazonaws.com/dev`  |
| Prod | `https://{api-id}.execute-api.us-east-1.amazonaws.com/prod` | `wss://{ws-id}.execute-api.us-east-1.amazonaws.com/prod` |

Los IDs concretos se obtienen de los outputs de Terraform tras el deploy:
```bash
make plan-dev   # muestra rest_api_url y ws_api_url en outputs
```

---

## Autenticación

| Actor | Mecanismo |
|-------|-----------|
| **Host** (app nativa) | Header `x-host-token: <api_key>` en endpoints protegidos |
| **Guest** (PWA/browser) | JWT `qr_token` en el body de Join Session. Firmado con HS256, expira 1 h |

Los endpoints REST no tienen authorizer en API Gateway — la validación es manual en cada Lambda. Los endpoints marcados con 🔒 validan el `x-host-token`.

---

## Formato de respuesta

Todas las respuestas siguen la misma envoltura:

```json
{ "data": { ... }, "error": null }       // éxito
{ "data": null, "error": "mensaje" }     // error
```

Los errores de validación retornan `400`. Los códigos de estado específicos están documentados por endpoint.

---

## REST API

### Sessions

#### `POST /sessions` 🔒
Crea una nueva sesión. El host_player_id es el UUID del jugador host generado por la app nativa.

**Request**
```json
{
  "host_player_id": "string (UUID)",
  "display_name": "string",
  "mode": "FREE_FOR_ALL | TOURNAMENT",
  "max_players": 2–100
}
```

**Response `201`**
```json
{
  "data": {
    "session_id": "uuid",
    "qr_token": "eyJhbGci...",
    "ws_url": "wss://...",
    "join_url": "https://rockdrop.app/join?token=eyJhbGci..."
  },
  "error": null
}
```

> `join_url` es la URL que se codifica en el QR. El frontend la puede generar también como `https://rockdrop.app/join?token={qr_token}`.
> El host debe conectarse al WebSocket usando `ws_url?session_id={session_id}&player_id={host_player_id}` inmediatamente después.

---

#### `GET /sessions/{session_id}`
Estado de la sesión. Disponible para todos.

**Response `200`**
```json
{
  "data": {
    "session_id": "uuid",
    "status": "WAITING | PLAYING | FINISHED",
    "mode": "FREE_FOR_ALL | TOURNAMENT",
    "current_round": 0,
    "max_players": 30,
    "host_player_id": "uuid",
    "created_at": "2026-06-01T18:00:00Z"
  },
  "error": null
}
```

> `qr_token` está deliberadamente excluido de esta respuesta.

**Errores**
| Código | Causa |
|--------|-------|
| `404` | Sesión no encontrada o expirada (TTL 1 h) |

---

#### `DELETE /sessions/{session_id}` 🔒
Cierra la sesión. Emite `GAME_FINISHED` por WebSocket a todos los jugadores conectados.

**Response `200`**
```json
{
  "data": { "session_id": "uuid", "status": "FINISHED" },
  "error": null
}
```

---

### Players

#### `POST /sessions/{session_id}/players`
Guest se une a la sesión usando el JWT del QR.

**Request**
```json
{
  "display_name": "string",
  "token": "eyJhbGci..."
}
```

**Response `201`**
```json
{
  "data": {
    "player_id": "uuid",
    "session_id": "uuid",
    "display_name": "string",
    "ws_url": "wss://..."
  },
  "error": null
}
```

> El guest debe conectarse al WebSocket con `ws_url?session_id={session_id}&player_id={player_id}` justo después de recibir esta respuesta.

**Errores**
| Código | Causa |
|--------|-------|
| `401` | Token inválido o expirado |
| `403` | El token no pertenece a esta sesión |
| `404` | Sesión no encontrada |
| `409` | Sesión llena o no en estado `WAITING` |

---

#### `GET /sessions/{session_id}/players`
Lista todos los jugadores con su estado de conexión y score.

**Response `200`**
```json
{
  "data": {
    "players": [
      {
        "player_id": "uuid",
        "display_name": "string",
        "is_host": true,
        "score": 3,
        "status": "CONNECTED | DISCONNECTED"
      }
    ],
    "count": 1
  },
  "error": null
}
```

---

### Game

#### `POST /sessions/{session_id}/game/move`
Jugador envía su movimiento para la ronda actual. La sesión debe estar en estado `PLAYING`.

**Request**
```json
{
  "player_id": "uuid",
  "move": "ROCK | PAPER | SCISSORS",
  "round_number": 1
}
```

**Response `200`**
```json
{
  "data": {
    "accepted": true,
    "round_number": 1,
    "waiting_for": 1
  },
  "error": null
}
```

> Cuando `waiting_for` llega a `0`, EventBridge dispara `resolve_round` automáticamente y el resultado llega por WebSocket como `ROUND_RESOLVED`.

**Errores**
| Código | Causa |
|--------|-------|
| `409` | Sesión no en estado `PLAYING` |
| `409` | El jugador ya envió movimiento en esta ronda |
| `400` | Move inválido |

---

#### `GET /sessions/{session_id}/game/round/{round_number}`
Resultado de una ronda ya resuelta.

**Response `200`**
```json
{
  "data": {
    "session_id": "uuid",
    "round_number": "1",
    "winner_id": "uuid | null",
    "is_tie": false,
    "results": {
      "{player_id}": {
        "move": "ROCK",
        "outcome": "WIN | LOSE | TIE",
        "display_name": "string"
      }
    },
    "resolved_at": "2026-06-01T18:05:32Z"
  },
  "error": null
}
```

**Errores**
| Código | Causa |
|--------|-------|
| `404` | Ronda no existe o no resuelta aún |

---

### Tournament

#### `POST /sessions/{session_id}/tournament/bracket` 🔒
Genera el bracket. Solo disponible en sesiones con `mode: TOURNAMENT`. Transiciona la sesión a `PLAYING`.

**Request**
```json
{ "host_player_id": "uuid" }
```

**Response `201`**
```json
{
  "data": {
    "bracket": {
      "size": 4,
      "total_rounds": 2,
      "current_round": 1,
      "matches": [
        {
          "match_id": "r1_m1",
          "round": 1,
          "player1": { "player_id": "uuid", "display_name": "string" },
          "player2": { "player_id": "uuid", "display_name": "string" },
          "winner_id": null,
          "status": "PENDING | BYE"
        }
      ]
    }
  },
  "error": null
}
```

> Si el número de jugadores no es potencia de 2, se asignan byes automáticos (status `BYE`, `winner_id` = player1).

**Errores**
| Código | Causa |
|--------|-------|
| `409` | Sesión no es `TOURNAMENT` |
| `409` | Menos de 2 jugadores |

---

#### `GET /sessions/{session_id}/tournament/bracket`
Estado actual del bracket.

**Response `200`**
```json
{
  "data": {
    "bracket": {
      "size": 4,
      "total_rounds": 2,
      "current_round": 2,
      "matches": [ ... ],
      "champion": null
    }
  },
  "error": null
}
```

> Cuando el torneo termina, `bracket.champion` contiene `{ "player_id": "uuid", "display_name": "string" }`.

---

#### `PUT /sessions/{session_id}/tournament/bracket/advance` 🔒
Avanza el bracket a la siguiente ronda. Llamar cuando todos los matches de la ronda actual están completados.

**Request**
```json
{
  "host_player_id": "uuid",
  "completed_round": 1
}
```

**Response `200`**
```json
{
  "data": {
    "current_round": 2,
    "champion": null,
    "new_matches": [ ... ]
  },
  "error": null
}
```

---

## WebSocket

### Conexión

```
wss://{ws-id}.execute-api.us-east-1.amazonaws.com/{stage}
  ?session_id={session_id}
  &player_id={player_id}
```

La conexión actualiza el estado del jugador a `CONNECTED` en DynamoDB. Al desconectarse (`$disconnect`), el estado vuelve a `DISCONNECTED` y se limpia el `connection_id`.

### Formato de mensajes

Todos los mensajes siguen la misma estructura:

```json
{
  "event": "NOMBRE_EVENTO",
  "payload": { ... }
}
```

### Eventos del servidor → cliente

#### `PLAYER_JOINED`
Emitido a todos cuando un guest hace join via REST.
```json
{
  "event": "PLAYER_JOINED",
  "payload": {
    "player_id": "uuid",
    "display_name": "string",
    "total_players": 3
  }
}
```

#### `MOVE_SUBMITTED`
Emitido a todos cuando un jugador envía su movimiento. **No revela el movimiento**.
```json
{
  "event": "MOVE_SUBMITTED",
  "payload": {
    "player_id": "uuid",
    "round_number": 1,
    "submitted_count": 1,
    "waiting_for": 1
  }
}
```

#### `ROUND_RESOLVED`
Emitido a todos cuando todos los jugadores enviaron su movimiento y `resolve_round` procesó el resultado.
```json
{
  "event": "ROUND_RESOLVED",
  "payload": {
    "round_number": 1,
    "winner_id": "uuid | null",
    "is_tie": false,
    "results": {
      "{player_id}": {
        "move": "ROCK",
        "outcome": "WIN | LOSE | TIE",
        "display_name": "string"
      }
    },
    "leaderboard": [
      { "player_id": "uuid", "display_name": "string", "score": 2 }
    ]
  }
}
```

#### `BRACKET_UPDATED`
Emitido a todos cuando se genera o avanza el bracket de torneo.
```json
{
  "event": "BRACKET_UPDATED",
  "payload": {
    "bracket": {
      "current_round": 2,
      "champion": null,
      "new_matches": [ ... ]
    }
  }
}
```

#### `GAME_FINISHED`
Emitido a todos cuando el host cierra la sesión.
```json
{
  "event": "GAME_FINISHED",
  "payload": {
    "session_id": "uuid",
    "reason": "host_closed"
  }
}
```

#### `PLAYER_DISCONNECTED`
Emitido a todos cuando un jugador pierde la conexión WebSocket.
```json
{
  "event": "PLAYER_DISCONNECTED",
  "payload": {
    "player_id": "uuid",
    "display_name": "string"
  }
}
```

---

## Flujos completos

### Free For All

```
Host                           Backend                        Guest(s)
 │                                │                               │
 ├─ POST /sessions ──────────────►│                               │
 │◄── { session_id, qr_token } ───┤                               │
 ├─ WS connect ──────────────────►│                               │
 │                                │                               │
 │          [Host muestra QR]     │                               │
 │                                │◄── POST .../players (token) ──┤
 │                                ├── PLAYER_JOINED broadcast ───►│
 │◄─── PLAYER_JOINED ─────────────┤                               │
 │                                │◄── WS connect ────────────────┤
 │                                │                               │
 │  [Host inicia ronda — ver nota]│                               │
 │                                │                               │
 ├─ POST .../game/move ──────────►│                               │
 │                                ├── MOVE_SUBMITTED broadcast ──►│
 │                                │◄── POST .../game/move ─────────┤
 │                                ├── MOVE_SUBMITTED broadcast ──►│
 │◄─── MOVE_SUBMITTED ────────────┤   [todos enviaron]            │
 │                                │                               │
 │                          [EventBridge]                         │
 │                          resolve_round                         │
 │                                │                               │
 │◄─── ROUND_RESOLVED ────────────┼──────────────────────────────►│
 │                                │                               │
 ├─ DELETE /sessions ────────────►│                               │
 │                                ├── GAME_FINISHED broadcast ───►│
```

> **Nota — transición a `PLAYING` en FREE_FOR_ALL:** `submit_move` requiere que la sesión esté en estado `PLAYING`. Para este modo no existe un endpoint de "iniciar juego" todavía — la sesión debe actualizarse a `PLAYING` manualmente o bien agregar un endpoint `POST /sessions/{id}/start`. Pendiente implementar.

---

### Tournament

```
Host                           Backend                        Guests
 │                                │                               │
 ├─ POST /sessions (TOURNAMENT) ─►│                               │
 ├─ [Guests join + WS connect]   ─────────────────────────────► │
 │                                │                               │
 ├─ POST .../tournament/bracket ─►│  [sesión → PLAYING]           │
 │◄─── BRACKET_UPDATED ───────────┼──────────────────────────────►│
 │                                │                               │
 │  [ronda 1: cada match es 1v1]  │                               │
 ├─ POST .../game/move ──────────►│                               │
 │                          [EventBridge resolve]                 │
 │◄─── ROUND_RESOLVED ────────────┼──────────────────────────────►│
 │                                │                               │
 ├─ PUT .../bracket/advance ─────►│                               │
 │◄─── BRACKET_UPDATED ───────────┼──────────────────────────────►│
 │                                │                               │
 │     [repetir por rondas]       │                               │
 │                                │                               │
 ├─ PUT .../bracket/advance ─────►│  [champion declarado]         │
 │◄─── BRACKET_UPDATED (champion)─┼──────────────────────────────►│
```

---

## Modelos de datos

### GameMode
```
FREE_FOR_ALL  — todos contra todos, gana quien acumula más puntos
TOURNAMENT    — bracket eliminatorio 1v1
```

### SessionStatus
```
WAITING   — esperando jugadores, acepta joins
PLAYING   — juego en curso, acepta moves
FINISHED  — sesión cerrada
```

### PlayerStatus
```
CONNECTED     — tiene conexión WebSocket activa
DISCONNECTED  — sin conexión (joined pero no conectado, o se desconectó)
```

### Move / Outcome
```
Move:    ROCK | PAPER | SCISSORS
Outcome: WIN  | LOSE  | TIE
```

---

## Consideraciones de implementación

**QR code**
El `qr_token` es un JWT firmado con HS256. El frontend solo necesita codificarlo en un QR — no debe intentar descodificarlo. La validación ocurre en el backend al hacer join.

**Reconexión WebSocket**
API Gateway WebSocket cierra conexiones inactivas a los 10 minutos. Implementar reconexión automática con back-off exponencial. Al reconectar, usar el mismo `player_id` — el `$connect` handler actualizará el `connection_id` en DynamoDB.

**Polling vs WebSocket**
No hacer polling de `GET /sessions/{id}` para detectar cambios. Todos los eventos relevantes llegan por WebSocket. El REST GET es solo para carga inicial o recuperación de estado tras reconexión.

**TTL de sesión**
Las sesiones expiran en DynamoDB al cabo de 1 hora (`expires_at`). El `qr_token` JWT también expira en 1 hora. El frontend debe manejar el `404` de sesión expirada y mostrar un mensaje apropiado.

**Orden de operaciones en join**
1. `POST /sessions/{id}/players` → obtener `player_id` y `ws_url`
2. Conectar WebSocket inmediatamente después
3. No hacer otras llamadas REST antes de conectar el WS o se perderán los eventos que lleguen en ese intervalo
