import { useEffect, useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitMove, getSession, getPlayers } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import MoveSelector from '../components/game/MoveSelector.jsx'
import RoundResult from '../components/game/RoundResult.jsx'
import DuelView from '../components/game/DuelView.jsx'
import Bracket from '../components/tournament/Bracket.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'
import Badge from '../components/ui/Badge.jsx'

export default function TournamentPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session, players, playerId, isHost,
    bracket, myMatch,
    gamePhase, currentRound, myMove, submittedPlayers,
    lastRoundResult, eliminatedBy, championId,
    setSession, setPlayers, bracketUpdated,
    setMyMove, resetMove, clearRoundResult,
  } = useGameStore()

  const [submitError,       setSubmitError]       = useState('')
  // For the host: auto-dismiss the eliminated overlay then stay as spectator
  const [hostDismissedElim, setHostDismissedElim] = useState(false)

  // ── Load on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [s, p] = await Promise.all([getSession(sessionId), getPlayers(sessionId)])
        setSession(s)
        setPlayers(p.players ?? p)
        if (s.bracket) bracketUpdated({ bracket: s.bracket })
      } catch (e) { console.error('[Tournament] load error:', e) }
    }
    load()
  }, [sessionId])

  // ── Navigate to finished — wait for round result overlay to close first ──
  useEffect(() => {
    if (lastRoundResult) return
    if (championId || session?.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [championId, session?.status, lastRoundResult])

  // ── Eliminated: non-host navigates away; host auto-dismisses overlay ──────
  useEffect(() => {
    if (!eliminatedBy || lastRoundResult) {
      setHostDismissedElim(false)
      return
    }
    if (isHost) {
      // Host stays as spectator — just dismiss the overlay after 3s
      const t = setTimeout(() => setHostDismissedElim(true), 3000)
      return () => clearTimeout(t)
    }
    // Non-host: navigate to finished after brief overlay
    const t = setTimeout(() => navigate(`/finished/${sessionId}`, { replace: true }), 3000)
    return () => clearTimeout(t)
  }, [eliminatedBy, lastRoundResult, isHost])

  // ── Submit move ──────────────────────────────────────────────────────────
  const handleSelect = useCallback(async (move) => {
    if (gamePhase !== 'selecting' || !myMatch) return
    setSubmitError('')
    setMyMove(move)
    try {
      await submitMove(sessionId, {
        player_id:    playerId,
        move,
        round_number: Math.max(1, myMatch.current_match_round ?? currentRound),
        match_id:     myMatch.match_id,
      })
    } catch (err) {
      if (err.status === 409) {
        // Move already submitted (e.g. page was refreshed mid-round).
        // Stay in 'waiting' phase — round resolves when opponent submits.
      } else {
        setSubmitError(err.message || 'Error al enviar jugada. Inténtalo de nuevo.')
        resetMove()
      }
    }
  }, [gamePhase, myMatch, playerId, sessionId, currentRound, setMyMove, resetMove])

  // ── Derive match data ──────────────────────────────────────────────────────
  const winsNeeded = bracket?.wins_needed ?? 3

  // Build player entries for the match (myself + all opponents)
  const matchPlayers = myMatch
    ? [
        myMatch.player1_id && { player_id: myMatch.player1_id, display_name: myMatch.player1_name, wins: myMatch.player1_wins ?? 0 },
        myMatch.player2_id && { player_id: myMatch.player2_id, display_name: myMatch.player2_name, wins: myMatch.player2_wins ?? 0 },
        myMatch.player3_id && { player_id: myMatch.player3_id, display_name: myMatch.player3_name, wins: myMatch.player3_wins ?? 0 },
      ].filter(Boolean)
    : []

  const myMatchEntry   = matchPlayers.find(p => p.player_id === playerId) ?? { wins: 0 }
  const myWins         = myMatchEntry.wins
  const opponents      = matchPlayers.filter(p => p.player_id !== playerId)

  const opponentAsArray      = opponents.map(o => ({ player_id: o.player_id, display_name: o.display_name }))
  const opponentSubmittedIds = opponents.filter(o => submittedPlayers.includes(o.player_id)).map(o => o.player_id)

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!session || !bracket) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  // Whether to show the eliminated overlay
  const showEliminatedOverlay = !!eliminatedBy && !lastRoundResult &&
    !(isHost && hostDismissedElim)

  const currentTournamentRound = bracket.current_tournament_round ?? 1

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

      {/* Round result overlay — shown first so players see the final cards */}
      {lastRoundResult && (
        <RoundResult
          result={lastRoundResult}
          playerId={playerId}
          players={players}
          onDismiss={clearRoundResult}
        />
      )}

      {/* Eliminated overlay — only after RoundResult has been dismissed */}
      {showEliminatedOverlay && (
        <div className="fixed inset-0 z-50 bg-red-50 flex flex-col items-center justify-center px-6 animate-fade-in">
          <span className="text-7xl mb-4" aria-hidden="true">😓</span>
          <h2 className="text-3xl font-extrabold text-red-600 mb-2">Eliminado</h2>
          <p className="text-zinc-600 text-center mb-1">
            <span className="font-semibold">{eliminatedBy}</span> ganó el partido
          </p>
          <p className="text-xs text-zinc-400 mt-4">
            {isHost ? 'Continuarás viendo el torneo…' : 'Redirigiendo…'}
          </p>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">
            Torneo · Ronda {currentTournamentRound}
          </p>
          <h1 className="text-xl font-extrabold text-zinc-900">
            {myMatch
              ? `Partido — ronda ${myMatch.current_match_round ?? 1}`
              : eliminatedBy
                ? 'Modo espectador'
                : 'Torneo en curso'}
          </h1>
        </div>
        <Badge variant={myMatch ? 'connected' : 'waiting'}>
          {myMatch ? 'Tu turno' : eliminatedBy ? 'Eliminado' : 'Espera'}
        </Badge>
      </div>

      {/* ── Active match card ───────────────────────────────────────────── */}
      {myMatch ? (
        <Card>
          {/* VS header with scores */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col items-center flex-1">
              <p className="text-xs text-blue-500 font-semibold mb-1">Tú</p>
              <p className="text-sm font-bold text-zinc-900 truncate max-w-[100px] text-center">
                {players.find(p => p.player_id === playerId)?.display_name ?? 'Tú'}
              </p>
            </div>
            <div className="flex items-center gap-3 px-4 flex-wrap justify-center">
              <span className={`text-4xl font-extrabold tabular-nums ${myWins >= winsNeeded ? 'text-green-600' : 'text-zinc-900'}`}>
                {myWins}
              </span>
              {opponents.map((opp, idx) => (
                <span key={opp.player_id} className="flex items-center gap-3">
                  <span className="text-xl text-zinc-300 font-light">–</span>
                  <span className={`text-4xl font-extrabold tabular-nums ${opp.wins >= winsNeeded ? 'text-red-500' : 'text-zinc-900'}`}>
                    {opp.wins}
                  </span>
                </span>
              ))}
            </div>
            <div className="flex flex-col items-end flex-1 gap-1">
              {opponents.map(opp => (
                <div key={opp.player_id} className="flex flex-col items-center">
                  <p className="text-xs text-zinc-400 font-semibold">Rival</p>
                  <p className="text-sm font-bold text-zinc-900 truncate max-w-[100px] text-center">
                    {opp.display_name}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-zinc-400 text-center mb-4">
            Primero en ganar {winsNeeded} rondas avanza
          </p>

          {/* Phase-based content */}
          {gamePhase === 'selecting' && (
            <>
              <p className="text-sm font-semibold text-zinc-900 mb-3">Elige tu jugada</p>
              <MoveSelector onSelect={handleSelect} selected={null} />
              {submitError && (
                <p role="alert" className="text-xs text-red-500 mt-3 text-center">
                  {submitError}
                </p>
              )}
            </>
          )}

          {gamePhase === 'waiting' && myMove && (
            <DuelView
              myMove={myMove}
              opponents={opponentAsArray}
              submittedOpponentIds={opponentSubmittedIds}
            />
          )}
        </Card>
      ) : (
        /* No active match: winner waiting or eliminated host spectating */
        <Card>
          {eliminatedBy ? (
            <div className="flex flex-col gap-1 py-2">
              <p className="text-sm font-medium text-zinc-700">
                Fuiste eliminado por{' '}
                <span className="font-bold text-zinc-900">{eliminatedBy}</span>
              </p>
              <p className="text-xs text-zinc-400">
                Sigue el torneo como espectador
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 py-2">
              <Spinner size="sm" className="text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Esperando tu próximo rival…
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Las otras partidas están en curso
                </p>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Bracket — visible to all players ───────────────────────────── */}
      <Card padding="sm">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-2">
          Bracket del torneo
        </p>
        <Bracket bracket={bracket} playerId={playerId} />
      </Card>

    </main>
  )
}
