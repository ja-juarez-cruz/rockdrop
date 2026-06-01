/**
 * TournamentPage — /tournament/:sessionId
 *
 * Tournament flow:
 *  1. Load bracket on mount
 *  2. Determine current player's match in the active round
 *  3. If player has a match: show MoveSelector
 *  4. BRACKET_UPDATED → re-render bracket
 *  5. ROUND_RESOLVED → show RoundResult overlay
 *  6. When bracket.champion is set → navigate to /finished/:sessionId
 */

import { useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitMove, getBracket, getSession, getPlayers } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import { useWebSocket } from '../hooks/useWebSocket.js'
import Bracket from '../components/tournament/Bracket.jsx'
import MoveSelector from '../components/game/MoveSelector.jsx'
import RoundResult from '../components/game/RoundResult.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'
import Badge from '../components/ui/Badge.jsx'

export default function TournamentPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session,
    players,
    playerId,
    wsUrl,
    bracket,
    currentRound,
    myMove,
    waitingFor,
    lastRoundResult,
    setSession,
    setPlayers,
    bracketUpdated,
    setMyMove,
    clearRoundResult,
  } = useGameStore()

  const { status: wsStatus } = useWebSocket(wsUrl, sessionId, playerId)

  // ── Load data on mount ───────────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      try {
        const [s, p, b] = await Promise.all([
          getSession(sessionId),
          getPlayers(sessionId),
          getBracket(sessionId),
        ])
        setSession(s)
        setPlayers(p.players ?? p)
        bracketUpdated({ bracket: b.bracket ?? b })
      } catch (err) {
        console.error('[Tournament] Load error:', err)
      }
    }
    loadAll()
  }, [sessionId])

  // ── Navigate when champion is declared ─────────────────────────────────
  useEffect(() => {
    if (bracket?.champion || session?.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [bracket?.champion, session?.status, sessionId, navigate])

  // ── Find player's current match ─────────────────────────────────────────
  const myCurrentMatch = (() => {
    if (!bracket?.matches) return null
    const activeRound = bracket.current_round
    return bracket.matches.find(
      (m) =>
        m.round === activeRound &&
        (m.player1_id === playerId || m.player2_id === playerId) &&
        !m.winner_id &&
        m.status !== 'BYE',
    ) ?? null
  })()

  const isEliminated = (() => {
    if (!bracket?.matches || !playerId) return false
    // Check if player lost any past match
    return bracket.matches.some(
      (m) =>
        m.winner_id &&
        m.winner_id !== playerId &&
        (m.player1_id === playerId || m.player2_id === playerId),
    )
  })()

  // ── Submit move ──────────────────────────────────────────────────────────
  const handleSelectMove = useCallback(
    async (move) => {
      if (myMove || !myCurrentMatch) return

      setMyMove(move)

      try {
        await submitMove(sessionId, {
          player_id:    playerId,
          move,
          round_number: bracket?.current_round ?? currentRound,
        })
      } catch (err) {
        setMyMove(null)
        console.error('[Tournament] Move submit error:', err)
      }
    },
    [myMove, myCurrentMatch, playerId, sessionId, bracket, currentRound, setMyMove],
  )

  // ── Dismiss round result ────────────────────────────────────────────────
  const handleDismissResult = useCallback(() => {
    clearRoundResult()
  }, [clearRoundResult])

  // ── Render ─────────────────────────────────────────────────────────────
  if (!session || !bracket) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  const roundDisplay = bracket.current_round ?? currentRound ?? 1

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 flex flex-col gap-6 max-w-2xl mx-auto">
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
            Torneo
          </p>
          <h1 className="text-xl font-extrabold text-zinc-900 tracking-tight">
            Ronda {roundDisplay}{' '}
            {bracket.total_rounds ? (
              <span className="font-normal text-zinc-400 text-base">
                de {bracket.total_rounds}
              </span>
            ) : null}
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

      {/* Bracket visualization */}
      <Card padding="sm">
        <h2 className="text-sm font-semibold text-zinc-900 mb-4 px-1">Bracket</h2>
        <Bracket
          bracket={bracket}
          players={players}
          playerId={playerId}
        />
      </Card>

      {/* Move area */}
      {isEliminated ? (
        <Card>
          <div className="text-center py-4">
            <span className="text-4xl mb-3 block" aria-hidden="true">👀</span>
            <p className="text-base font-semibold text-zinc-900 mb-1">Has sido eliminado</p>
            <p className="text-sm text-zinc-500">Puedes seguir viendo el torneo</p>
          </div>
        </Card>
      ) : myCurrentMatch ? (
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 mb-1">Tu partida</h2>
          <p className="text-xs text-zinc-400 mb-4">
            vs.{' '}
            {(() => {
              const opponentId = myCurrentMatch.player1_id === playerId
                ? myCurrentMatch.player2_id
                : myCurrentMatch.player1_id
              return players.find(p => p.player_id === opponentId)?.display_name ?? 'Tu rival'
            })()}
          </p>

          <MoveSelector
            onSelect={handleSelectMove}
            selected={myMove}
            disabled={!!myMove}
          />

          {myMove && (
            <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
              <Spinner size="sm" className="text-blue-500 shrink-0" />
              <span>
                {waitingFor > 0
                  ? `Esperando ${waitingFor} jugador${waitingFor !== 1 ? 'es' : ''}…`
                  : 'Esperando a tu rival…'}
              </span>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-3 py-2">
            <Spinner size="sm" className="text-blue-500 shrink-0" />
            <p className="text-sm text-zinc-600">
              Esperando resultados de las partidas activas…
            </p>
          </div>
        </Card>
      )}
    </main>
  )
}
