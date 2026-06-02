import { useEffect, useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitMove, getSession, getPlayers } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import MoveSelector from '../components/game/MoveSelector.jsx'
import RoundResult from '../components/game/RoundResult.jsx'
import DuelView from '../components/game/DuelView.jsx'
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

  const [submitError, setSubmitError] = useState('')

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

  // ── Navigate to finished — always wait for round result overlay to close ──
  useEffect(() => {
    if (lastRoundResult) return   // let players see the final cards first
    if (championId || session?.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [championId, session?.status, lastRoundResult])

  // ── Navigate eliminated player — also wait for round result overlay ───────
  useEffect(() => {
    if (!eliminatedBy || lastRoundResult) return
    const t = setTimeout(() => navigate(`/finished/${sessionId}`, { replace: true }), 3000)
    return () => clearTimeout(t)
  }, [eliminatedBy, lastRoundResult])

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
      setSubmitError(err.message || 'Error al enviar jugada. Inténtalo de nuevo.')
      resetMove()
    }
  }, [gamePhase, myMatch, playerId, sessionId, currentRound, setMyMove, resetMove])

  // ── Derive match data ──────────────────────────────────────────────────────
  const opponentId = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player2_id : myMatch.player1_id)
    : null

  const opponentName = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player2_name : myMatch.player1_name)
    : null

  const myWins = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player1_wins : myMatch.player2_wins)
    : 0

  const opponentWins = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player2_wins : myMatch.player1_wins)
    : 0

  const winsNeeded = bracket?.wins_needed ?? 2

  const opponentAsArray = opponentId && opponentName
    ? [{ player_id: opponentId, display_name: opponentName }]
    : []

  const opponentSubmittedIds = opponentId && submittedPlayers.includes(opponentId)
    ? [opponentId]
    : []

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!session || !bracket) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

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
      {eliminatedBy && !lastRoundResult && (
        <div className="fixed inset-0 z-50 bg-red-50 flex flex-col items-center justify-center px-6 animate-fade-in">
          <span className="text-7xl mb-4" aria-hidden="true">😓</span>
          <h2 className="text-3xl font-extrabold text-red-600 mb-2">Eliminado</h2>
          <p className="text-zinc-600 text-center mb-1">
            <span className="font-semibold">{eliminatedBy}</span> ganó el partido
          </p>
          <p className="text-xs text-zinc-400 mt-4">Redirigiendo…</p>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">Torneo</p>
          <h1 className="text-xl font-extrabold text-zinc-900">
            {myMatch ? `Ronda ${myMatch.current_match_round ?? 1} del partido` : 'Torneo en curso'}
          </h1>
        </div>
        <Badge variant={myMatch ? 'connected' : 'waiting'}>
          {myMatch ? 'Tu turno' : 'Espera'}
        </Badge>
      </div>

      {/* ── Marcador del partido ────────────────────────────────────────── */}
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
            <div className="flex items-center gap-3 px-4">
              <span className={`text-4xl font-extrabold tabular-nums ${myWins >= winsNeeded ? 'text-green-600' : 'text-zinc-900'}`}>
                {myWins}
              </span>
              <span className="text-xl text-zinc-300 font-light">–</span>
              <span className={`text-4xl font-extrabold tabular-nums ${opponentWins >= winsNeeded ? 'text-red-500' : 'text-zinc-900'}`}>
                {opponentWins}
              </span>
            </div>
            <div className="flex flex-col items-center flex-1">
              <p className="text-xs text-zinc-400 font-semibold mb-1">Rival</p>
              <p className="text-sm font-bold text-zinc-900 truncate max-w-[100px] text-center">
                {opponentName}
              </p>
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
        <Card>
          <div className="flex items-center gap-3 py-2">
            <Spinner size="sm" className="text-blue-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-zinc-900">Esperando tu próximo rival…</p>
              <p className="text-xs text-zinc-400 mt-0.5">Las otras partidas están en curso</p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Bracket resumen — solo para el host ─────────────────────────── */}
      {isHost && (
        <Card padding="sm">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-3">
            Todas las partidas · Ronda {bracket.current_tournament_round ?? 1}
          </p>
          {bracket.matches
            .filter(m => m.tournament_round === (bracket.current_tournament_round ?? 1))
            .map(m => {
              const isMyMatch = m.match_id === myMatch?.match_id
              const isDone    = m.status === 'COMPLETE' || m.status === 'BYE'
              return (
                <div
                  key={m.match_id}
                  className={`flex items-center justify-between px-2 py-2.5 rounded-xl mb-1 ${
                    isMyMatch ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-zinc-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isDone ? 'bg-zinc-300' : 'bg-green-400'}`} />
                    <span className="text-sm text-zinc-800">
                      {m.player1_name ?? 'BYE'}
                      {' '}
                      <span className="text-zinc-400 text-xs font-normal">vs</span>
                      {' '}
                      {m.player2_name ?? 'BYE'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums">
                    <span className={m.winner_id === m.player1_id ? 'text-green-600' : 'text-zinc-700'}>
                      {m.player1_wins}
                    </span>
                    <span className="text-zinc-300 font-light">–</span>
                    <span className={m.winner_id === m.player2_id ? 'text-green-600' : 'text-zinc-700'}>
                      {m.player2_wins}
                    </span>
                  </div>
                </div>
              )
            })}
        </Card>
      )}

    </main>
  )
}
