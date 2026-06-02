import { useEffect, useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitMove, getSession, getPlayers } from '../lib/api.js'
import useGameStore, { FFA_WINS_NEEDED } from '../stores/gameStore.js'
import MoveSelector from '../components/game/MoveSelector.jsx'
import RoundResult from '../components/game/RoundResult.jsx'
import DuelView from '../components/game/DuelView.jsx'
import Leaderboard from '../components/game/Leaderboard.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'

// ── Score board — adapts to 2-player (face-off) or N-player (chip row) ────────

function FfaScoreBoard({ players, playerId }) {
  const connected = players.filter(p => p.status !== 'DISCONNECTED')
  if (connected.length === 0) return null

  const sorted = [...connected].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  // 2-player: dramatic face-off layout
  if (connected.length === 2) {
    const me       = sorted.find(p => p.player_id === playerId)
    const opponent = sorted.find(p => p.player_id !== playerId)
    if (!me || !opponent) return null

    return (
      <div className="flex items-center justify-center rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-900">
        <div className="flex flex-col items-center px-6 py-4 flex-1">
          <span className="text-3xl font-extrabold text-white tabular-nums leading-none">
            {me.score ?? 0}
          </span>
          <span className="text-[11px] text-zinc-400 mt-1 font-medium">Tú</span>
        </div>
        <span className="text-sm font-bold text-zinc-600 px-2">—</span>
        <div className="flex flex-col items-center px-6 py-4 flex-1">
          <span className="text-3xl font-extrabold text-white tabular-nums leading-none">
            {opponent.score ?? 0}
          </span>
          <span className="text-[11px] text-zinc-400 mt-1 font-medium truncate max-w-[80px] text-center">
            {opponent.display_name}
          </span>
        </div>
      </div>
    )
  }

  // N-player: horizontal score chips
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {sorted.map(p => {
        const isMe = p.player_id === playerId
        return (
          <div
            key={p.player_id}
            className={[
              'flex flex-col items-center px-4 py-3 rounded-2xl border-2 min-w-[72px] shrink-0',
              isMe
                ? 'border-blue-400 bg-blue-50'
                : 'border-zinc-200 bg-white',
            ].join(' ')}
          >
            <span className={`text-2xl font-extrabold tabular-nums leading-none ${isMe ? 'text-blue-700' : 'text-zinc-900'}`}>
              {p.score ?? 0}
            </span>
            <span className={`text-[10px] font-medium mt-1 truncate max-w-[56px] text-center ${isMe ? 'text-blue-500' : 'text-zinc-500'}`}>
              {isMe ? 'Tú' : p.display_name}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GamePage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session,
    players,
    playerId,
    gamePhase,
    currentRound,
    myMove,
    waitingFor,
    submittedPlayers,
    lastRoundResult,
    setSession,
    setPlayers,
    setMyMove,
    resetMove,
    clearRoundResult,
  } = useGameStore()

  const [submitError, setSubmitError] = useState('')

  // ── Load on mount (fallback if store is empty) ───────────────────────────
  useEffect(() => {
    if (!session || session.session_id !== sessionId) {
      Promise.all([getSession(sessionId), getPlayers(sessionId)])
        .then(([s, p]) => { setSession(s); setPlayers(p.players ?? p) })
        .catch(console.error)
    }
  }, [sessionId])

  // ── Navigate to finished — always wait for round result overlay to close ──
  useEffect(() => {
    if (lastRoundResult) return   // let players see the final cards first
    if (gamePhase === 'finished' || session?.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [gamePhase, session?.status, lastRoundResult])

  // ── Submit move ──────────────────────────────────────────────────────────
  const handleSelectMove = useCallback(async (move) => {
    if (gamePhase !== 'selecting') return
    setSubmitError('')
    setMyMove(move)
    try {
      await submitMove(sessionId, { player_id: playerId, move, round_number: Math.max(1, currentRound) })
    } catch (err) {
      setSubmitError(err.message || 'Error al enviar jugada. Inténtalo de nuevo.')
      resetMove()
    }
  }, [gamePhase, currentRound, playerId, sessionId, setMyMove, resetMove])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  const opponents      = players.filter(p => p.player_id !== playerId && p.status !== 'DISCONNECTED')
  const connectedCount = players.filter(p => p.status !== 'DISCONNECTED').length

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

      {/* ── Round result overlay ─────────────────────────────────────────── */}
      {lastRoundResult && (
        <RoundResult
          result={lastRoundResult}
          playerId={playerId}
          players={players}
          onDismiss={clearRoundResult}
          isGameOver={gamePhase === 'finished'}
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
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-zinc-400 tabular-nums">
            {connectedCount} jugadores
          </span>
          <span className="text-[11px] text-zinc-300">
            Primero en {FFA_WINS_NEEDED} victorias
          </span>
        </div>
      </div>

      {/* ── Score board ────────────────────────────────────────────────── */}
      <FfaScoreBoard players={players} playerId={playerId} />

      {/* ── Phase: waiting (submitted, waiting for opponent) ───────────── */}
      {gamePhase === 'waiting' && myMove && (
        <Card>
          <DuelView
            myMove={myMove}
            opponents={opponents}
            submittedOpponentIds={submittedPlayers}
          />
        </Card>
      )}

      {/* ── Phase: selecting (pick a move) ─────────────────────────────── */}
      {gamePhase === 'selecting' && (
        <Card>
          <p className="text-sm font-semibold text-zinc-900 mb-1">Elige tu jugada</p>
          <p className="text-xs text-zinc-400 mb-4">Todos juegan al mismo tiempo</p>
          <MoveSelector onSelect={handleSelectMove} selected={null} />
          {submitError && (
            <p role="alert" className="text-xs text-red-500 mt-3 text-center">
              {submitError}
            </p>
          )}
        </Card>
      )}

      {/* ── Player status (visible in selecting phase) ─────────────────── */}
      {gamePhase === 'selecting' && (
        <Card padding="sm">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-3">
            Jugadores · ronda {currentRound}
          </p>
          <div className="flex flex-col gap-1">
            {players
              .filter(p => p.status === 'CONNECTED')
              .map((player) => {
                const isMe      = player.player_id === playerId
                const hasThrown = submittedPlayers.includes(player.player_id)

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
        </Card>
      )}

      {/* ── Waiting: opponent status ────────────────────────────────────── */}
      {gamePhase === 'waiting' && waitingFor > 0 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Spinner size="sm" className="text-zinc-400 shrink-0" />
          <p className="text-xs text-zinc-500">
            Esperando {waitingFor} jugador{waitingFor !== 1 ? 'es' : ''}…
          </p>
        </div>
      )}

      {/* ── Leaderboard (always visible) ───────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Clasificación
        </p>
        <Leaderboard players={players} playerId={playerId} />
      </div>

    </main>
  )
}
