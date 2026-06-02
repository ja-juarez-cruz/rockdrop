# RockDrop — Guía de integración frontend

Stack: React 18 · Vite · Tailwind CSS · Zustand (persist) · HashRouter

---

## Entornos

| Entorno | URL |
|---|---|
| Dev (CloudFront) | `https://d2yd85vzfy5ijm.cloudfront.net` |
| Dev (API REST) | `https://2kvig6o394.execute-api.us-east-1.amazonaws.com/dev` |
| Dev (WebSocket) | `wss://{ws-id}.execute-api.us-east-1.amazonaws.com/dev` |

---

## Routing

`HashRouter` — rutas tipo `https://domain.com/#/ruta`.

| Ruta | Página | Quién la ve |
|---|---|---|
| `/#/host` | `HostPage` | Host (crear sesión) |
| `/#/join?token=xxx` | `JoinPage` | Guest (unirse con QR) |
| `/#/lobby/:sessionId` | `LobbyPage` | Todos (sala de espera) |
| `/#/game/:sessionId` | `GamePage` | Todos (FREE_FOR_ALL) |
| `/#/tournament/:sessionId` | `TournamentPage` | Todos (TOURNAMENT) |
| `/#/finished/:sessionId` | `FinishedPage` | Todos (resultado final) |

---

## Autenticación

| Actor | Mecanismo |
|---|---|
| Host | `x-host-token` header en endpoints protegidos |
| Guest | JWT `qr_token` en body de `POST /players` |

El `host_player_id` se genera con `crypto.randomUUID()` y se persiste en `localStorage`.

---

## Variables de entorno

```bash
# app/.env.local (dev local)
VITE_API_URL=https://2kvig6o394.execute-api.us-east-1.amazonaws.com/dev
VITE_WS_URL=wss://{ws-id}.execute-api.us-east-1.amazonaws.com/dev
```

---

## Arquitectura de estado

### WebSocket — Singleton de sesión (`App.jsx`)

El WebSocket **NO** vive en los componentes de página. Vive en `App.jsx` como `SessionWebSocket`, persistiendo a través de toda la navegación Lobby → Game → Tournament → Finished.

```jsx
// App.jsx
function SessionWebSocket() {
  const wsUrl     = useGameStore(s => s.wsUrl)
  const sessionId = useGameStore(s => s.sessionId)
  const playerId  = useGameStore(s => s.playerId)
  useWebSocket(wsUrl, sessionId, playerId)
  return null
}
```

**Por qué es crítico**: si el WS se crea/destruye en cada página, durante la transición Lobby→Game el backend marca al jugador como DISCONNECTED y recalcula `waiting_for` con menos jugadores — resolviendo rondas prematuramente en partidas de 3+ jugadores.

### Zustand Store — `gameStore.js`

**Persistencia en localStorage** (solo campos de identidad de sesión):
```js
persist(store, {
  name: 'rockdrop-session',
  partialize: (state) => ({
    playerId, sessionId, wsUrl, isHost, qrToken
  })
})
```

Esto permite que al hacer **refresh** de página, el jugador recupere su sesión. Los campos de estado del juego (bracket, scores, etc.) se re-derivan de la API al montar cada página.

### State machine `gamePhase` (Observer pattern)

```
'selecting' → (player picks card) → 'waiting'
'waiting'   → (ROUND_RESOLVED)    → 'result'
'result'    → (overlay dismissed) → 'selecting'
any         → (game ends)         → 'finished'
```

Esta máquina de estados está en el store y todos los componentes la observan para decidir qué renderizar. Evita que el estado de UI dependa de `myMove` directamente.

---

## Modos de juego

### FREE_FOR_ALL (2–3 jugadores)

- Todos en `GamePage`
- Primero en **3 victorias** gana (`FFA_WINS_NEEDED = 3` en `gameStore.js`)
- `roundResolved` detecta el ganador y transiciona `gamePhase → 'finished'`
- El host no necesita cerrar la sesión — la navegación a `/finished` ocurre puramente en el frontend cuando alguien alcanza 3 wins

### TOURNAMENT (4+ jugadores)

- Todos en `TournamentPage`
- Bracket eliminatorio generado completamente desde el inicio (todos los rounds visibles)
- Cada match: primero en **3 rondas** dentro del match avanza (`wins_needed = 3`)
- Brackets se actualizan en tiempo real vía WS

---

## Flujo de página — GamePage (FFA)

```
GamePage monta:
  → si session nula: GET /sessions + GET /players
  → SessionWebSocket ya está conectado (App nivel)

gamePhase === 'selecting':
  → MoveSelector + FfaScoreBoard + PlayerList

gamePhase === 'waiting':
  → DuelView (mi carta + cartas ocultas de rivales)
  → submittedOpponentIds muestra quién ya tiró (✓ vs ❓)

ROUND_RESOLVED recibido:
  → roundResolved() → gamePhase = 'result' (o 'finished' si alguien llega a 3 wins)
  → RoundResult overlay (5s o tap para cerrar, isGameOver si gamePhase='finished')

gamePhase === 'finished' && !lastRoundResult:
  → navigate('/finished/:sessionId')
```

**Manejo de 409 "already submitted"** (refresh mid-round):
```js
if (err.status === 409) {
  // Ya enviamos antes del refresh — quedarse en 'waiting'
} else {
  setSubmitError(err.message)
  resetMove()  // volver a 'selecting'
}
```

---

## Flujo de página — TournamentPage

```
TournamentPage monta:
  → GET /sessions (incluye bracket), GET /players
  → bracketUpdated() → _findMyMatch() → myMatch
  → SessionWebSocket ya conectado

gamePhase === 'selecting' && myMatch:
  → Scoreboard del match (Tú X – Y Rival)
  → MoveSelector

gamePhase === 'waiting' && myMatch:
  → DuelView con carta del rival oculta + indicador si ya tiró

ROUND_RESOLVED (solo si player está en ese match):
  → roundResolved() → actualiza bracket + myMatch con nuevos wins

MATCH_FINISHED (solo afecta a jugadores del match):
  → matchFinished() → myMatch = null, eliminatedBy para el perdedor
  → Jugadores de otros matches: solo actualiza bracket display

Host eliminado:
  → overlay "Eliminado" por 3s, luego desaparece → modo espectador
  → Bracket visible, no navega a /finished hasta CHAMPION_DECLARED

No-host eliminado:
  → overlay "Eliminado" por 3s, luego navega a /finished

TOURNAMENT_ROUND_COMPLETE:
  → tournamentRoundComplete() → re-deriva myMatch del bracket actualizado

CHAMPION_DECLARED:
  → championDeclared() → gamePhase = 'finished'
  → navega a /finished (esperando que overlay de último resultado se descarte)
```

### Bracket visual (`Bracket.jsx`)

- Árbol horizontal con todas las rondas visibles desde el inicio
- Matches **PENDING**: borde punteado, nombres "Por definir" en gris
- Matches **ACTIVE**: borde sólido, azul si es del jugador actual
- Matches **COMPLETE**: ganador en verde, perdedor tachado
- Líneas conectoras CSS (`border-right + border-bottom/top`) entre rondas
- Scroll horizontal para brackets grandes
- Badge 🏆 al final cuando hay campeón
- Visible para **todos los jugadores** (no solo el host)

---

## Zustand store — Estado relevante

```js
{
  // Identidad (persistido en localStorage)
  sessionId, session, playerId, isHost, qrToken, wsUrl,

  // Jugadores
  players,            // [{ player_id, display_name, is_host, score, status }]

  // Juego (state machine)
  gamePhase,          // 'selecting' | 'waiting' | 'result' | 'finished'
  currentRound,       // número de ronda dentro del match (1, 2, 3...)
  myMove,             // movimiento enviado esta ronda (null = no enviado)
  waitingFor,         // cuántos jugadores faltan (del mismo match)
  submittedPlayers,   // [player_id] que ya tiraron esta ronda (del mismo match)
  lastRoundResult,    // payload de ROUND_RESOLVED (para overlay)
  ffaWinnerId,        // player_id del ganador FFA (si aplica)

  // Torneo
  bracket,            // objeto completo del bracket (todos los rounds)
  myMatch,            // match activo del jugador actual (re-derivado del bracket)
  eliminatedBy,       // display_name del jugador que eliminó (si aplica)
  championId,         // player_id del campeón (si aplica)

  // WebSocket
  wsStatus,           // 'connecting' | 'connected' | 'disconnected' | 'error'
}
```

### Filtros críticos en el store (TOURNAMENT)

**`moveSubmitted`**: solo actualiza `submittedPlayers`/`waitingFor` si el evento es del propio match:
```js
const isMyMatch = !payload.match_id || payload.match_id === state.myMatch?.match_id
if (!isMyMatch) return {}
```

**`roundResolved`**: solo muestra overlay y resetea estado si el jugador está en ese match:
```js
const isMyRound = !payload.match_id || (state.playerId in results)
if (!isMyRound) return { bracket, myMatch: updatedMyMatch }  // solo actualiza bracket display
```

**`matchFinished`**: solo resetea myMatch/eliminatedBy para los jugadores del match:
```js
const isInThisMatch = isLoser || isWinner
if (!isInThisMatch) return { bracket }  // otros matches no se interrumpen
```

---

## Consideraciones de implementación

**Refresh de página**: los campos de identidad (`playerId`, `sessionId`, `wsUrl`, `isHost`, `qrToken`) se persisten en `localStorage` via `zustand/middleware/persist`. Al montar la página, los efectos de carga re-fetchen la sesión y el bracket.

**WS singleton**: `SessionWebSocket` en App.jsx crea/destruye el WS cuando `wsUrl + sessionId + playerId` cambian. Se preserva durante navegación entre páginas.

**JWT del QR**: `atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))` — sin librería.

**Hash routing y QR**: URL del QR debe tener el formato `origin/#/join?token=xxx`.

**Reconexión WS**: exponential backoff (1→2→4…s, máx 5 reintentos).

**No polling en GamePage/TournamentPage**: todos los cambios llegan por WebSocket. El único polling es en LobbyPage (cada 3s para detectar WAITING→PLAYING).

**Scores en tiempo real**: `ROUND_RESOLVED` incluye `results.outcome` → FFA suma +1 al ganador. En TOURNAMENT los wins del match se actualizan via `match_score` → bracket → myMatch (re-derivado con `_findMyMatch`).

**Navegación bloqueada por overlay**: ninguna navegación a `/finished` dispara mientras `lastRoundResult` esté seteado — garantiza que todos los jugadores vean las cartas de la última ronda antes de ir a resultados finales.

**TTL sesión**: 1 hora desde creación.

**FFA_WINS_NEEDED = 3** en `gameStore.js` (frontend) y `FFA_WINS_NEEDED = 3` en `resolve_round.py` (backend) — deben coincidir.

**WINS_NEEDED = 3** en `start_session.py` y `resolve_round.py` — rondas de PPT para ganar un match de torneo.
