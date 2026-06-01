/**
 * GamePage — /game/:sessionId
 *
 * FREE_FOR_ALL game flow:
 *  1. Show current round number
 *  2. Player selects a move via MoveSelector
 *  3. Submit move → POST /sessions/:id/game/move
 *  4. Disable selector, show "Waiting for X players"
 *  5. ROUND_RESOLVED WS event → show RoundResult overlay (3 sec)
 *  6. After overlay → clear result, ready for next round
 *  7. GAME_FINISHED → navigate to /finished/:sessionId
 */

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
    lastRoundResult,
    setSession,
    setPlayers,
    setMyMove,
    clearRoundResult,
  } = useGameStore()

  const { status: wsStatus } = useWebSocket(wsUrl, sessionId, playerId)

  // ── Load session on mount if not already loaded ─────────────────────────
  useEffect(() => {
    if (!session || session.session_id !== sessionId) {
      Promise.all([getSession(sessionId), getPlayers(sessionId)])
        .then(([s, p]) => {
          setSession(s)
          setPlayers(p.players ?? p)
        })
        .catch(console.error)
    }
  }, [sessionId])

  // ── Watch for GAME_FINISHED ─────────────────────────────────────────────
  useEffect(() => {
    if (session?.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [session?.status, sessionId, navigate])

  // ── Submit move ──────────────────────────────────────────────────────────
  const handleSelectMove = useCallback(
    async (move) => {
      if (myMove) return // already submitted

      setMyMove(move)

      try {
        await submitMove(sessionId, {
          player_id:    playerId,
          move,
          round_number: currentRound,
        })
      } catch (err) {
        // Revert optimistic selection on error
        setMyMove(null)
        console.error('[Game] Move submit error:', err)
      }
    },
    [myMove, currentRound, playerId, sessionId, setMyMove],
  )

  // ── Dismiss round result overlay ────────────────────────────────────────
  const handleDismissResult = useCallback(() => {
    clearRoundResult()
  }, [clearRoundResult])

  // ── Render ─────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  const hasSubmitted  = !!myMove
  const roundDisplay  = currentRound || session.current_round || 1

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 flex flex-col gap-6 max-w-lg mx-auto">
      {/* Round result overlay */}
      {lastRoundResult && (
        <RoundResult
          result={lastRoundResult}
          playerId={playerId}
          players={players}
          onDismiss={handleDismissResult}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">
            Todos contra Todos
          </p>
          <h1 className="text-xl font-extrabold text-zinc-900 tracking-tight">
            Ronda {roundDisplay}
          </h1>
        </div>
        <Badge variant={wsStatus === 'connected' ? 'connected' : 'waiting'}>
          <span
            aria-hidden="true"
            className={[
              'w-1.5 h-1.5 rounded-full',
              wsStatus === 'connected' ? 'bg-green-500' : 'bg-zinc-300',
            ].join(' ')}
          />
          {wsStatus === 'connected' ? 'En vivo' : 'Reconectando…'}
        </Badge>
      </div>

      {/* Move selector */}
      <Card>
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">
          {hasSubmitted ? 'Jugada enviada' : 'Elige tu jugada'}
        </h2>

        <MoveSelector
          onSelect={handleSelectMove}
          selected={myMove}
          disabled={hasSubmitted}
        />

        {/* Waiting message after submitting */}
        {hasSubmitted && (
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
            <Spinner size="sm" className="text-blue-500 shrink-0" />
            <span>
              {waitingFor > 0
                ? `Esperando ${waitingFor} jugador${waitingFor !== 1 ? 'es' : ''}…`
                : 'Esperando a los demás…'}
            </span>
          </div>
        )}
      </Card>

      {/* Leaderboard */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Clasificación
        </h2>
        <Leaderboard players={players} playerId={playerId} />
      </div>
    </main>
  )
}
