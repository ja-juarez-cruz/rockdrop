/**
 * FinishedPage — /finished/:sessionId
 *
 * Shows:
 *   - Tournament mode: champion banner + final bracket
 *   - FREE_FOR_ALL mode: final leaderboard with winner on top
 */

import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getSession, getPlayers, getBracket } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import Leaderboard from '../components/game/Leaderboard.jsx'
import Bracket from '../components/tournament/Bracket.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'

function WinnerBanner({ name, isMe }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <span className="text-6xl select-none" aria-hidden="true">🏆</span>
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-500">
        {isMe ? '¡Eres el campeón!' : 'Campeón'}
      </p>
      <h2 className="text-3xl font-extrabold text-zinc-900 text-center">
        {name}
      </h2>
      {isMe && (
        <p className="text-sm text-zinc-500">¡Felicidades, ganaste la partida!</p>
      )}
    </div>
  )
}

export default function FinishedPage() {
  const { sessionId } = useParams()

  const {
    session,
    players,
    playerId,
    bracket,
    championId,
    eliminatedBy,
    setSession,
    setPlayers,
    bracketUpdated,
  } = useGameStore()

  // ── Load final state on mount ────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      try {
        const [s, p] = await Promise.all([
          getSession(sessionId),
          getPlayers(sessionId),
        ])
        setSession(s)
        setPlayers(p.players ?? p)

        // Only fetch bracket for tournament sessions
        if (s.mode === 'TOURNAMENT') {
          try {
            const b = await getBracket(sessionId)
            bracketUpdated({ bracket: b.bracket ?? b })
          } catch {
            // Bracket may not exist in all scenarios
          }
        }
      } catch (err) {
        console.error('[Finished] Load error:', err)
      }
    }
    loadAll()
  }, [sessionId])

  // ── Determine winner ────────────────────────────────────────────────────
  const isTournament = session?.mode === 'TOURNAMENT'

  const champId   = championId ?? bracket?.champion_id
  const champion  = champId ? players.find(p => p.player_id === champId) : null
  const isChampion = champId === playerId
  const isEliminated = !!eliminatedBy && !isChampion

  const sortedPlayers = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const winner    = isTournament ? champion : sortedPlayers[0] ?? null
  const winnerName = winner?.display_name ?? (isTournament ? 'Por determinar' : 'Nadie')
  const isMyWin   = winner?.player_id === playerId

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 flex flex-col gap-6 max-w-lg mx-auto">
      <div className="text-center">
        <p className="text-xs text-zinc-400 uppercase tracking-widest mb-1">
          {isEliminated ? 'Partido terminado' : 'Partida terminada'}
        </p>
        <h1 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
          {isEliminated ? '¡Hasta la próxima!' : 'Resultados Finales'}
        </h1>
      </div>

      {/* Eliminated card */}
      {isEliminated && (
        <Card>
          <div className="flex flex-col items-center py-4 gap-2">
            <span className="text-5xl" aria-hidden="true">👊</span>
            <p className="text-lg font-bold text-zinc-900">Fuiste eliminado</p>
            <p className="text-sm text-zinc-500">
              <span className="font-semibold text-zinc-700">{eliminatedBy}</span> ganó el partido
            </p>
          </div>
        </Card>
      )}

      {/* Winner/champion banner */}
      {!isEliminated && winner && (
        <Card>
          <WinnerBanner name={winnerName} isMe={isMyWin} />
        </Card>
      )}

      {/* Tournament bracket */}
      {isTournament && bracket && (
        <Card padding="sm">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4 px-1">
            Bracket final
          </h2>
          <Bracket
            bracket={bracket}
            players={players}
            playerId={playerId}
          />
        </Card>
      )}

      {/* Leaderboard (always show for FREE_FOR_ALL; also for tournament as summary) */}
      {(!isTournament || players.some(p => p.score > 0)) && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">
            Clasificación final
          </h2>
          <Leaderboard players={players} playerId={playerId} />
        </div>
      )}

      {/* Play again nudge */}
      <p className="text-center text-xs text-zinc-300 mt-4 pb-4">
        Pide al anfitrión que inicie otra partida.
      </p>
    </main>
  )
}
