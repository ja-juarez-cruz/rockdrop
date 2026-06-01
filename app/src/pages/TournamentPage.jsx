import { useEffect, useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitMove, getSession, getPlayers } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import { useWebSocket } from '../hooks/useWebSocket.js'
import MoveSelector from '../components/game/MoveSelector.jsx'
import RoundResult from '../components/game/RoundResult.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'
import Badge from '../components/ui/Badge.jsx'

const MOVE_EMOJI = { ROCK: '🪨', PAPER: '📄', SCISSORS: '✂️' }
const MOVE_LABEL = { ROCK: 'Piedra', PAPER: 'Papel', SCISSORS: 'Tijeras' }

export default function TournamentPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session, players, playerId, wsUrl,
    bracket, myMatch,
    currentRound, myMove, waitingFor, submittedPlayers,
    lastRoundResult, eliminatedBy, championId,
    setSession, setPlayers, bracketUpdated,
    setMyMove, clearRoundResult,
  } = useGameStore()

  useWebSocket(wsUrl, sessionId, playerId)

  // ── Load on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [s, p] = await Promise.all([getSession(sessionId), getPlayers(sessionId)])
        setSession(s)
        setPlayers(p.players ?? p)
        // Bracket comes from session on mount
        if (s.bracket) bracketUpdated({ bracket: s.bracket })
      } catch (e) { console.error('[Tournament] load error:', e) }
    }
    load()
  }, [sessionId])

  // ── Navigate when champion declared or game finished ──────────────────────
  useEffect(() => {
    if (championId || session?.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [championId, session?.status])

  // ── Navigate eliminated player ────────────────────────────────────────────
  useEffect(() => {
    if (eliminatedBy) {
      const t = setTimeout(() => navigate(`/finished/${sessionId}`, { replace: true }), 3500)
      return () => clearTimeout(t)
    }
  }, [eliminatedBy])

  // ── Submit move ──────────────────────────────────────────────────────────
  const handleSelect = useCallback(async (move) => {
    if (myMove || !myMatch) return
    setMyMove(move)
    try {
      await submitMove(sessionId, {
        player_id:    playerId,
        move,
        round_number: myMatch.current_match_round ?? currentRound,
        match_id:     myMatch.match_id,
      })
    } catch { setMyMove(null) }
  }, [myMove, myMatch, playerId, sessionId, currentRound, setMyMove])

  // ── Compute opponent ──────────────────────────────────────────────────────
  const opponent = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player2_name : myMatch.player1_name)
    : null

  const myWins = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player1_wins : myMatch.player2_wins)
    : 0

  const opponentWins = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player2_wins : myMatch.player1_wins)
    : 0

  const winsNeeded  = bracket?.wins_needed ?? 2
  const matchRound  = myMatch?.current_match_round ?? currentRound

  const opponentId = myMatch
    ? (myMatch.player1_id === playerId ? myMatch.player2_id : myMatch.player1_id)
    : null

  const opponentSubmitted = opponentId
    ? submittedPlayers.includes(opponentId)
    : false

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!session || !bracket) {
    return <div className="min-h-dvh flex items-center justify-center"><Spinner size="lg" className="text-blue-600" /></div>
  }

  // ── Eliminated overlay ───────────────────────────────────────────────────
  if (eliminatedBy) {
    return (
      <div className="fixed inset-0 z-50 bg-red-50 flex flex-col items-center justify-center px-6">
        <span className="text-7xl mb-4" aria-hidden="true">😓</span>
        <h2 className="text-3xl font-extrabold text-red-600 mb-2">Eliminado</h2>
        <p className="text-zinc-600 text-center mb-1">
          <span className="font-semibold">{eliminatedBy}</span> ganó el partido
        </p>
        <p className="text-xs text-zinc-400 mt-4">Redirigiendo…</p>
      </div>
    )
  }

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
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">Torneo</p>
          <h1 className="text-xl font-extrabold text-zinc-900">
            {myMatch ? `Ronda ${matchRound} del partido` : 'Torneo en curso'}
          </h1>
        </div>
        <Badge variant={myMatch ? 'connected' : 'waiting'}>
          {myMatch ? 'Tu turno' : 'Espera'}
        </Badge>
      </div>

      {/* ── Marcador del partido ────────────────────────────────────────── */}
      {myMatch ? (
        <Card>
          {/* VS header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col items-center flex-1">
              <p className="text-xs text-blue-500 font-semibold mb-1">Tú</p>
              <p className="text-sm font-bold text-zinc-900 truncate max-w-[100px] text-center">
                {players.find(p => p.player_id === playerId)?.display_name ?? 'Tú'}
              </p>
            </div>
            {/* Score */}
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
                {opponent}
              </p>
            </div>
          </div>

          {/* Progress: wins needed */}
          <p className="text-xs text-zinc-400 text-center mb-4">
            Primero en ganar {winsNeeded} rondas avanza
          </p>

          {/* Move selector */}
          {!myMove ? (
            <>
              <p className="text-sm font-semibold text-zinc-900 mb-3">Elige tu jugada</p>
              <MoveSelector onSelect={handleSelect} selected={null} disabled={false} />
            </>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-5xl">{MOVE_EMOJI[myMove]}</span>
              <div>
                <p className="text-xs text-zinc-400 mb-0.5">Tu jugada</p>
                <p className="text-lg font-bold text-zinc-900">{MOVE_LABEL[myMove]}</p>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1.5">
                <Badge variant="connected">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  Enviada
                </Badge>
                <span className={`text-xs font-medium ${opponentSubmitted ? 'text-green-600' : 'text-zinc-400'}`}>
                  {opponentSubmitted ? `✓ ${opponent} listo` : `⏳ ${opponent} pensando…`}
                </span>
              </div>
            </div>
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

      {/* ── Bracket resumen ─────────────────────────────────────────────── */}
      <Card padding="sm">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-3">
          Bracket · Ronda {bracket.current_tournament_round ?? 1}
        </p>
        {bracket.matches
          .filter(m => m.tournament_round === (bracket.current_tournament_round ?? 1))
          .map(m => {
            const isMyMatch  = m.match_id === myMatch?.match_id
            const isDone     = m.status === 'COMPLETE' || m.status === 'BYE'
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

    </main>
  )
}
