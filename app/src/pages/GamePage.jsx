import { useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitMove, getSession, getPlayers } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import { useWebSocket } from '../hooks/useWebSocket.js'
import MoveSelector from '../components/game/MoveSelector.jsx'
import RoundResult from '../components/game/RoundResult.jsx'
import Leaderboard from '../components/game/Leaderboard.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'
import Badge from '../components/ui/Badge.jsx'

const MOVE_EMOJI = { ROCK: '🪨', PAPER: '📄', SCISSORS: '✂️' }
const MOVE_LABEL = { ROCK: 'Piedra', PAPER: 'Papel', SCISSORS: 'Tijeras' }

export default function GamePage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session,
    players,
    playerId,
    wsUrl,
    currentRound,
    myMove,
    waitingFor,
    submittedPlayers,
    lastRoundResult,
    setSession,
    setPlayers,
    setMyMove,
    clearRoundResult,
  } = useGameStore()

  useWebSocket(wsUrl, sessionId, playerId)

  // ── Load on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session || session.session_id !== sessionId) {
      Promise.all([getSession(sessionId), getPlayers(sessionId)])
        .then(([s, p]) => { setSession(s); setPlayers(p.players ?? p) })
        .catch(console.error)
    }
  }, [sessionId])

  // ── GAME_FINISHED → navigate ─────────────────────────────────────────────
  useEffect(() => {
    if (session?.status === 'FINISHED')
      navigate(`/finished/${sessionId}`, { replace: true })
  }, [session?.status])

  // ── Submit move ──────────────────────────────────────────────────────────
  const handleSelectMove = useCallback(async (move) => {
    if (myMove) return
    setMyMove(move)
    try {
      await submitMove(sessionId, { player_id: playerId, move, round_number: currentRound })
    } catch {
      setMyMove(null)
    }
  }, [myMove, currentRound, playerId, sessionId, setMyMove])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  const hasSubmitted   = !!myMove
  const connectedCount = players.filter(p => p.status === 'CONNECTED').length

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

      {/* Round result overlay */}
      {lastRoundResult && (
        <RoundResult
          result={lastRoundResult}
          playerId={playerId}
          players={players}
          onDismiss={clearRoundResult}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">
            Todos contra Todos
          </p>
          <h1 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
            Ronda {currentRound}
          </h1>
        </div>
        <span className="text-xs text-zinc-400 tabular-nums">
          {connectedCount} jugadores
        </span>
      </div>

      {/* ── Tu jugada ──────────────────────────────────────────────────── */}
      <Card>
        {!hasSubmitted ? (
          <>
            <p className="text-sm font-semibold text-zinc-900 mb-1">Elige tu jugada</p>
            <p className="text-xs text-zinc-400 mb-4">Todos juegan al mismo tiempo</p>
            <MoveSelector onSelect={handleSelectMove} selected={myMove} disabled={false} />
          </>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-5xl" aria-hidden="true">{MOVE_EMOJI[myMove]}</span>
            <div>
              <p className="text-xs text-zinc-400 mb-0.5">Tu jugada</p>
              <p className="text-lg font-bold text-zinc-900">{MOVE_LABEL[myMove]}</p>
              <p className="text-xs text-zinc-400 mt-1">Esperando a los demás…</p>
            </div>
            <span className="ml-auto">
              <Badge variant="connected">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
                Enviada
              </Badge>
            </span>
          </div>
        )}
      </Card>

      {/* ── Estado de jugadores ────────────────────────────────────────── */}
      <Card padding="sm">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-3">
          Jugadores · ronda {currentRound}
        </p>
        <div className="flex flex-col gap-1">
          {players
            .filter(p => p.status === 'CONNECTED')
            .map((player) => {
              const isMe        = player.player_id === playerId
              const hasThrown   = isMe
                ? hasSubmitted
                : submittedPlayers.includes(player.player_id)

              return (
                <div
                  key={player.player_id}
                  className="flex items-center justify-between px-2 py-2 rounded-xl"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        hasThrown ? 'bg-green-500' : 'bg-zinc-300'
                      }`}
                      aria-hidden="true"
                    />
                    <span className={`text-sm font-medium ${isMe ? 'text-blue-700' : 'text-zinc-900'}`}>
                      {player.display_name}
                      {isMe && <span className="ml-1 text-xs font-normal text-blue-400">(Tú)</span>}
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${hasThrown ? 'text-green-600' : 'text-zinc-400'}`}>
                    {hasThrown ? '✓ Listo' : '⏳ Pendiente'}
                  </span>
                </div>
              )
            })}
        </div>

        {/* Resumen de espera */}
        {hasSubmitted && waitingFor > 0 && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-100 px-1">
            <Spinner size="sm" className="text-blue-400 shrink-0" />
            <p className="text-xs text-zinc-500">
              Esperando {waitingFor} jugador{waitingFor !== 1 ? 'es' : ''}…
            </p>
          </div>
        )}
      </Card>

      {/* ── Clasificación ─────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Clasificación
        </p>
        <Leaderboard players={players} playerId={playerId} />
      </div>

    </main>
  )
}
