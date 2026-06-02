/**
 * LobbyPage — /lobby/:sessionId
 *
 * - Loads session + players on mount
 * - Connects WebSocket
 * - Polls GET /sessions every 3s while status === 'WAITING'
 * - Shows QR code if is_host
 * - Navigates to /game or /tournament when session.status → PLAYING
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSession, getPlayers, startSession } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import PlayerList from '../components/game/PlayerList.jsx'
import QRDisplay from '../components/lobby/QRDisplay.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'
import Badge from '../components/ui/Badge.jsx'
import Button from '../components/ui/Button.jsx'

const POLL_INTERVAL_MS = 3000


export default function LobbyPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session,
    players,
    playerId,
    isHost,
    qrToken,
    wsStatus,
    setSession,
    setPlayers,
  } = useGameStore()

  const pollRef                       = useRef(null)
  const [starting, setStarting]       = useState(false)
  const [startError, setStartError]   = useState('')

  // ── Load session and players ────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [sessionData, playersData] = await Promise.all([
        getSession(sessionId),
        getPlayers(sessionId),
      ])
      setSession(sessionData)
      setPlayers(playersData.players ?? playersData)
    } catch (err) {
      console.error('[Lobby] Failed to load session data:', err)
    }
  }, [sessionId, setSession, setPlayers])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Polling while WAITING ───────────────────────────────────────────────
  useEffect(() => {
    if (!session) return

    if (session.status === 'PLAYING' || session.status === 'FINISHED') {
      clearInterval(pollRef.current)
      return
    }

    if (session.status === 'WAITING') {
      pollRef.current = setInterval(async () => {
        try {
          const data = await getSession(sessionId)
          setSession(data)
        } catch {
          // Ignore transient errors during polling
        }
      }, POLL_INTERVAL_MS)
    }

    return () => clearInterval(pollRef.current)
  }, [session?.status, sessionId, setSession])

  // ── Navigate when game starts ───────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    if (session.status === 'PLAYING') {
      const route = session.mode === 'TOURNAMENT'
        ? `/tournament/${sessionId}`
        : `/game/${sessionId}`
      navigate(route, { replace: true })
    }
    if (session.status === 'FINISHED') {
      navigate(`/finished/${sessionId}`, { replace: true })
    }
  }, [session?.status, session?.mode, sessionId, navigate])

  // ── Start game (host only, FREE_FOR_ALL) ───────────────────────────────
  async function handleStart() {
    setStarting(true)
    setStartError('')
    try {
      await startSession(sessionId, playerId)
      // Navigation happens automatically when session.status → PLAYING
    } catch (e) {
      setStartError(e.message || 'No se pudo iniciar la partida.')
      setStarting(false)
    }
  }

  // ── Build join URL for QR display ──────────────────────────────────────
  const joinUrl = qrToken
    ? `${window.location.origin}/#/join?token=${qrToken}`
    : ''

  // ── Render ─────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    )
  }

  const playerCount = players.length
  const maxPlayers  = session.max_players ?? 0

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 flex flex-col gap-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Sala de espera</p>
          <h1 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
            RockDrop
          </h1>
        </div>
        <div className="flex flex-col items-end gap-1.5 mt-1">
          {/* WS status */}
          <Badge variant={wsStatus === 'connected' ? 'connected' : 'waiting'}>
            <span
              aria-hidden="true"
              className={[
                'w-1.5 h-1.5 rounded-full',
                wsStatus === 'connected' ? 'bg-green-500' : 'bg-zinc-300',
              ].join(' ')}
            />
            {wsStatus === 'connected' ? 'En vivo' : 'Conectando...'}
          </Badge>
          {/* Player count */}
          <span className="text-xs text-zinc-400 tabular-nums">
            {playerCount}{maxPlayers > 0 ? ` / ${maxPlayers}` : ''} jugadores
          </span>
        </div>
      </div>

      {/* QR code section (host only) */}
      {isHost && joinUrl && (
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">
            Comparte este código para invitar jugadores
          </h2>
          <QRDisplay joinUrl={joinUrl} />
        </Card>
      )}

      {/* Host: botón de inicio + lista de jugadores */}
      {isHost ? (
        <>
          <Card>
            <p className="text-xs text-zinc-500 mb-1">
              {playerCount >= 4 ? 'Modo Torneo (automático)' : 'Modo Todos contra Todos (automático)'}
              {maxPlayers > 0 ? ` · Máx. ${maxPlayers} jugadores` : ''}
            </p>
            <p className="text-sm text-zinc-700 mb-4">
              {playerCount >= 4
                ? 'Con 4 o más jugadores se genera bracket eliminatorio automáticamente.'
                : 'Con menos de 4 jugadores todos juegan en grupo. Primero en 3 victorias gana.'}
            </p>
            {startError && (
              <p role="alert" className="text-xs text-red-500 mb-3">{startError}</p>
            )}
            <Button
              fullWidth
              loading={starting}
              disabled={playerCount < 2}
              onClick={handleStart}
            >
              {starting ? 'Iniciando…' : 'Iniciar partida'}
            </Button>
            {playerCount < 2 && (
              <p className="text-xs text-zinc-400 text-center mt-2">
                Mínimo 2 jugadores para iniciar
              </p>
            )}
          </Card>

          <div>
            <h2 className="text-sm font-semibold text-zinc-700 mb-3">
              Jugadores ({playerCount})
            </h2>
            <PlayerList
              players={players}
              playerId={playerId}
              maxPlayers={maxPlayers || undefined}
            />
          </div>
        </>
      ) : (
        /* Guest: solo pantalla de espera */
        <div className="flex flex-col items-center justify-center flex-1 gap-6 py-12">
          <span className="text-6xl select-none" aria-hidden="true">🪨</span>
          <div className="text-center">
            <p className="text-lg font-bold text-zinc-900">
              ¡Te uniste a la partida!
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              Esperando que el anfitrión inicie el juego…
            </p>
          </div>
          <Spinner size="lg" className="text-blue-500" />
        </div>
      )}

      {/* Session ID footnote */}
      <p className="text-center text-xs text-zinc-300 mt-auto">
        Sesión: <span className="font-mono">{sessionId?.slice(0, 8)}…</span>
      </p>
    </main>
  )
}
