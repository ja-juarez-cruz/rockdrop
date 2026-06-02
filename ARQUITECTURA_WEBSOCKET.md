# RockDrop: Arquitectura de un Juego Multijugador en Tiempo Real con WebSocket, el Patrón Observer y AWS Serverless

## Introducción

RockDrop es un juego multijugador de Piedra-Papel-Tijeras que soporta partidas libres (FFA) y torneos con bracket eliminatorio, todo en tiempo real. El host crea una sala generando un código QR; los demás jugadores se unen escaneándolo. Cuando todos están listos, el host arranca la partida y el marcador de cada ronda se actualiza en milisegundos en todos los dispositivos simultáneamente.

Este artículo recorre las decisiones técnicas detrás de esa sincronización: por qué se eligió WebSocket en lugar de otras alternativas, cómo se implementó el patrón Observer para que la UI reaccione solo a los eventos relevantes, y qué mejores prácticas evitaron los problemas clásicos de apps multijugador.

---

## Stack y Arquitectura General

```
Frontend                         Backend (AWS Serverless)
─────────────────────            ──────────────────────────────────
React + Vite                     API Gateway REST  → Lambda (Python)
Zustand (state)                  API Gateway WS    → Lambda (Python)
TailwindCSS                      DynamoDB          (sesiones, jugadores, movimientos)
                                 EventBridge       (resolver ronda asíncronamente)
                                 Terraform         (infraestructura como código)
```

La infraestructura completa está declarada en Terraform. Hay dos API Gateways: uno REST para operaciones CRUD (crear sesión, unirse, enviar movimiento) y uno WebSocket para la comunicación bidireccional en tiempo real.

---

## Por Qué WebSocket y No Polling ni SSE

La sincronización en tiempo real de un juego tiene requisitos específicos que eliminan las alternativas más simples:

**HTTP Polling** requiere que cada cliente consulte al servidor cada N segundos. Con 8 jugadores haciendo polling cada segundo, se generan 8 req/s de "ruido" aunque nadie haya jugado. La latencia perceptible es exactamente el intervalo del poll: si un oponente envía su movimiento medio segundo después de tu último poll, esperas otro segundo entero para saberlo.

**Server-Sent Events (SSE)** permite que el servidor envíe eventos al cliente sobre una conexión HTTP abierta, pero es unidireccional. En RockDrop el servidor necesita saber qué jugadores están conectados para no seguir enviando mensajes a conexiones cerradas (`GoneException`). Con SSE, esa información solo llega cuando el cliente hace una petición HTTP adicional.

**WebSocket** establece una conexión full-duplex persistente. El servidor conoce en todo momento qué jugadores están conectados (almacena el `connection_id` en DynamoDB al hacer `$connect`) y puede enviar a todos sin latencia de round-trip. El cliente no necesita pedir información: la recibe en cuanto ocurre.

```python
# connect.py — el handler $connect del API Gateway WS
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    session_id = query_params.get("session_id")
    player_id  = query_params.get("player_id")

    # Registra la conexión para poder hacer broadcast después
    players_table.update_item(
        Key={"session_id": session_id, "player_id": player_id},
        UpdateExpression="SET ws_connection_id = :cid, #s = :s",
        ExpressionAttributeValues={":cid": connection_id, ":s": "CONNECTED"},
    )
```

---

## Cómo Se Implementó WebSocket: De La Conexión al Marcador en Pantalla

El flujo completo de una ronda sigue este camino:

```
Jugador elige ROCK
      ↓
submit_move (REST API) → guarda movimiento en DynamoDB
                       → si todos jugaron, dispara EventBridge
                              ↓
                       resolve_round Lambda
                              ↓
                       broadcast("ROUND_RESOLVED", {results, match_score})
                              ↓
                    WS API Gateway envía a cada connection_id
                              ↓
                  Frontend recibe → Zustand actualiza estado
                              ↓
              React re-renderiza solo los componentes suscritos
```

### El Singleton de WebSocket en el Frontend

El error más común en apps React con WebSocket es crear la conexión dentro de una página o componente individual. Cuando el usuario navega de `/lobby` a `/game`, React desmonta el componente, destruye la conexión, y la vuelve a crear. En ese instante el backend registra una desconexión y —en RockDrop— podría resolver una ronda antes de que todos los jugadores estén realmente presentes.

La solución es montar el WebSocket a nivel de `App.jsx`, fuera del sistema de rutas:

```jsx
// App.jsx
function SessionWebSocket() {
  const wsUrl     = useGameStore(s => s.wsUrl)
  const sessionId = useGameStore(s => s.sessionId)
  const playerId  = useGameStore(s => s.playerId)
  useWebSocket(wsUrl, sessionId, playerId)
  return null  // solo efectos, sin UI
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionWebSocket />  {/* vive aquí, nunca se desmonta */}
      <Routes>
        <Route path="/lobby/:sessionId" element={<LobbyPage />} />
        <Route path="/game/:sessionId"  element={<GamePage />} />
        {/* ... */}
      </Routes>
    </BrowserRouter>
  )
}
```

`SessionWebSocket` es un componente que no renderiza nada — solo llama al hook `useWebSocket` y existe durante toda la vida de la app.

### El Gestor de WebSocket con Reconexión Exponencial

`WebSocketManager` (`app/src/lib/ws.js`) encapsula toda la lógica de ciclo de vida:

```js
// ws.js — reconexión con backoff exponencial
_scheduleReconnect() {
  if (this._retries >= MAX_RETRIES) { /* desiste */ return }
  const delay = BASE_DELAY_MS * Math.pow(2, this._retries)  // 1s, 2s, 4s, 8s, 16s
  this._retries += 1
  this._retryTimer = setTimeout(() => this._connect(), delay)
}
```

El sistema intenta reconectarse hasta 5 veces con delays de 1, 2, 4, 8 y 16 segundos. Si el servidor cierra la conexión con código `1000` (cierre normal), no reintenta — eso indica que el servidor decidió desconectar deliberadamente.

El despacho de mensajes usa una tabla de handlers indexada por tipo de evento:

```js
// ws.js — dispatch por tipo de evento
this._socket.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  const eventType    = msg.event || msg.type
  const eventPayload = msg.payload ?? msg
  const handler = this._handlers[eventType]
  if (handler) handler(eventPayload)
}
```

Esto separa el "qué recibo" del "qué hago con ello", facilitando agregar o quitar handlers sin tocar la lógica de conexión.

### El Broadcast en el Backend

`ws.py` en la capa Lambda compartida itera todos los jugadores conectados a la sesión y llama a `post_to_connection` de API Gateway Management API:

```python
# lambdas/layers/common/python/ws.py
def broadcast(session_id, event_name, payload, exclude_player_id=None):
    client = _get_client()
    players = get_connected_players(session_id)
    message = json_dumps({"event": event_name, "payload": payload}).encode()

    for player in players:
        connection_id = player.get("ws_connection_id")
        try:
            client.post_to_connection(ConnectionId=connection_id, Data=message)
        except client.exceptions.GoneException:
            # La conexión ya no existe — marcar jugador como desconectado
            mark_player_disconnected(player["session_id"], player["player_id"])
```

Un bug crítico que surgió durante el desarrollo: `json.dumps` estándar no sabe serializar el tipo `Decimal` que DynamoDB devuelve para números. El resultado era un crash 502 sin headers CORS, que el frontend veía como un error de red opaco sin ninguna pista de la causa real. La solución fue usar un encoder personalizado `_DecimalEncoder` en `models.py`:

```python
class _DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)

def json_dumps(obj) -> str:
    return json.dumps(obj, cls=_DecimalEncoder)
```

---

## El Patrón Observer Aplicado

El patrón Observer define una relación uno-a-muchos donde cuando el sujeto cambia de estado, todos sus observadores son notificados automáticamente. En RockDrop, el store de Zustand es el sujeto y los componentes de React son los observadores.

### El Sujeto: Zustand Store con State Machine

El estado central se modela como una máquina de estados con `gamePhase` como variable de control:

```
'selecting' ──(jugador elige)──────→ 'waiting'
'waiting'   ──(ROUND_RESOLVED)─────→ 'result'
'result'    ──(overlay cerrado)────→ 'selecting'  (si el juego continúa)
cualquiera  ──(win condition met)──→ 'finished'
```

Cada transición ocurre en una acción del store, disparada desde un evento WebSocket:

```js
// app/src/stores/gameStore.js
roundResolved(payload) {
  set((state) => {
    const isMyRound = !payload.match_id || (state.playerId in results)
    // ...actualiza puntuaciones, bracket...
    return {
      gamePhase: ffaWinner ? 'finished' : 'result',
      lastRoundResult: payload,
      currentRound: payload.round_number + 1,
    }
  })
},
```

### Los Observadores: Componentes que Suscriben Solo lo que Necesitan

Zustand permite suscribirse a slices específicos del estado. Un componente que solo muestra el marcador no necesita conocer el estado de `bracket` ni de `gamePhase`:

```js
// Leaderboard.jsx — observa solo players
const players = useGameStore(s => s.players)

// GamePage.jsx — observa solo gamePhase para decidir qué renderizar
const gamePhase = useGameStore(s => s.gamePhase)

// Bracket.jsx — observa solo bracket
const bracket = useGameStore(s => s.bracket)
```

Cuando el backend emite `ROUND_RESOLVED`, el hook `useWebSocket` llama `roundResolved()` en el store. Zustand notifica solo a los componentes suscritos a las propiedades que cambiaron. `Leaderboard` re-renderiza porque `players` cambió; `Bracket` re-renderiza porque `bracket` cambió; un componente que solo usa `sessionId` no se vuelve a renderizar aunque llegue un evento de ronda.

```
WebSocket recv "ROUND_RESOLVED"
         ↓
useWebSocket.handlers.ROUND_RESOLVED(payload)
         ↓
store.roundResolved(payload)  ← acción que muta el store
         ↓
Zustand diff → ¿qué slices cambiaron?
         ├── players   ✓  → Leaderboard re-renders
         ├── gamePhase ✓  → GamePage re-renders
         ├── bracket   ✓  → Bracket re-renders
         └── sessionId ✗  → sin cambio → sin re-render
```

### Filtrado de Eventos por Match en Torneo

En modo TOURNAMENT todos los jugadores de la sesión reciben todos los broadcasts — pero un jugador en la match `r1_m1` no debe ver cambios de gameplay por la resolución de `r1_m2`. Cada handler del store verifica si el evento le pertenece:

```js
// app/src/stores/gameStore.js
moveSubmitted(payload) {
  set((state) => {
    const isMyMatch = !payload.match_id || payload.match_id === state.myMatch?.match_id
    if (!isMyMatch) return {}  // sin cambio de estado
    return { waitingFor: payload.waiting_for, /* ... */ }
  })
},

roundResolved(payload) {
  set((state) => {
    const isMyRound = !payload.match_id || (state.playerId in results)
    if (!isMyRound) return { bracket, myMatch: updatedMyMatch }  // solo actualiza el árbol visual
    // ... actualiza UI de gameplay solo si es mi ronda
  })
},
```

Esta separación garantiza que el bracket visual (que ven todos) siempre se actualice, pero la pantalla de "resultado de ronda" o el contador de "esperando a X jugadores" solo se activa para los jugadores involucrados.

---

## Mejores Prácticas Aplicadas

### 1. Identidad Persistida, Estado de Juego No

Zustand con `persist` guarda en `localStorage` solo lo necesario para sobrevivir un refresh del navegador:

```js
// app/src/stores/gameStore.js
partialize: (state) => ({
  playerId:  state.playerId,
  sessionId: state.sessionId,
  wsUrl:     state.wsUrl,
  isHost:    state.isHost,
  qrToken:   state.qrToken,
}),
```

El estado de juego (`gamePhase`, `currentRound`, `lastRoundResult`, `bracket`) no se persiste. Al recargar la página, el WebSocket se reconecta con la misma identidad y el servidor envía el estado actual fresco. Esto evita que un jugador vea un overlay de "resultado" obsoleto de la ronda anterior al refrescar.

### 2. Generación Completa del Bracket desde el Inicio

Una decisión de diseño clave para el torneo fue generar todos los matches de todas las rondas al arrancar (`build_bracket` en `start_session.py`), incluyendo los slots de rondas futuras como `PENDING` con punteros `source_matches`:

```python
# lambdas/session/start_session.py — rondas futuras pre-generadas
all_matches.append({
    "match_id": f"r{r}_m{i+1}",
    "tournament_round": r,
    "player1_id": None, "player1_name": f"Ganador r{r-1}_m{i*2+1}",
    "status": "PENDING",
    "source_matches": [f"r{r-1}_m{i*2+1}", f"r{r-1}_m{i*2+2}"],
})
```

La alternativa habría sido crear matches dinámicamente a medida que los rounds se completan. El enfoque upfront tiene dos ventajas: el componente `Bracket.jsx` puede renderizar el árbol completo desde el primer momento (con slots vacíos), y la lógica de `_fill_winner_slot` solo necesita encontrar el slot preexistente y actualizarlo en lugar de crear registros nuevos con posibles condiciones de carrera.

### 3. Teardown Limpio del WebSocket

`WebSocketManager.destroy()` hace un cierre ordenado eliminando todos los handlers antes de cerrar el socket:

```js
// app/src/lib/ws.js
destroy() {
  this._destroyed = true
  clearTimeout(this._retryTimer)
  // Eliminar handlers ANTES de close() para evitar que onclose dispare reconexión
  this._socket.onopen    = null
  this._socket.onmessage = null
  this._socket.onerror   = null
  this._socket.onclose   = null
  this._socket.close(1000, 'Component unmounted')
}
```

Si no se eliminan los handlers antes de llamar `close()`, el handler `onclose` podría llamar a `_scheduleReconnect()` justo cuando el componente ya está desmontado, creando conexiones fantasma.

### 4. Modo de Juego Determinado por el Servidor

El modo (`FREE_FOR_ALL` vs `TOURNAMENT`) no lo elige el host explícitamente — el servidor lo determina en función del número de jugadores al iniciar:

```python
# lambdas/session/start_session.py
mode = "TOURNAMENT" if len(players) >= TOURNAMENT_MIN else "FREE_FOR_ALL"
```

Esto elimina una clase entera de bugs donde el cliente y el servidor podrían tener visiones distintas del modo.

### 5. Lambda Layer Compartida

Las funciones Lambda comparten código común (modelos, acceso a DynamoDB, broadcast WS) a través de un Lambda Layer en `lambdas/layers/common/`. Esto garantiza que todos los handlers usen el mismo `json_dumps` con soporte de `Decimal` y la misma lógica de conexión WS.

---

## Flujo Completo: Del Movimiento al Marcador en Pantalla

Para ilustrar todo integrado, el flujo de una ronda en modo FFA con 3 jugadores:

```
1. Jugador A selecciona ROCK
   → MoveSelector llama REST POST /sessions/{id}/moves
   → store.setMyMove('ROCK') → gamePhase: 'waiting'
   → submit_move.py guarda en DynamoDB
   → broadcast("MOVE_SUBMITTED") → todos ven "faltan 2 jugadores"

2. Jugadores B y C seleccionan (el último activa la resolución)
   → submit_move.py detecta que todos votaron
   → dispara EventBridge → resolve_round Lambda

3. resolve_round calcula ganador
   → _resolve_ffa() compara todos los movimientos entre sí
   → actualiza scores en DynamoDB
   → broadcast("ROUND_RESOLVED", { results, winner_id })

4. Todos los clientes reciben ROUND_RESOLVED simultáneamente
   → useWebSocket despacha a store.roundResolved()
   → Zustand actualiza: players[].score, gamePhase='result'
   → Leaderboard re-renderiza con nuevas puntuaciones
   → RoundResult overlay aparece mostrando el resultado
   → Si algún jugador llegó a FFA_WINS_NEEDED=3 → gamePhase='finished'

5. Overlay se cierra (clearRoundResult)
   → gamePhase vuelve a 'selecting'
   → Siguiente ronda comienza
```

---

## Conclusión

RockDrop resuelve un problema con múltiples capas de complejidad simultánea: estado compartido entre N jugadores, navegación SPA sin perder la conexión, y modos de juego con reglas distintas sobre quién debe recibir qué evento. Las tres piezas que lo hacen funcionar son:

- **WebSocket** como canal de comunicación, porque el servidor necesita empujar eventos sin esperar que el cliente pregunte.
- **El patrón Observer** implementado con Zustand, porque cada componente solo escucha el slice de estado que le concierne, y el filtrado por `match_id` asegura que los eventos de otras partidas no contaminen la UI.
- **El singleton de WS en `App.jsx`** y la generación upfront del bracket, que eliminan las clases de bugs más sutiles: conexiones que se recrean al navegar, y una UI que no puede renderizar rondas futuras porque aún no existen en el servidor.
