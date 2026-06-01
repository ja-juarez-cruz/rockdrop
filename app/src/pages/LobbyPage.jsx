/**
 * LobbyPage — /lobby/:sessionId
 *
 * - Loads session + players on mount
 * - Connects WebSocket
 * - Polls GET /sessions every 3s while status === 'WAITING'
 * - Shows QR code if is_host
 * - Navigates to /game or /tournament when session.status → PLAYING
 */

import { useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSession, getPlayers } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import { useWebSocket } from '../hooks/useWebSocket.js'
import PlayerList from '../components/game/PlayerList.jsx'
import QRDisplay from '../components/lobby/QRDisplay.jsx'
import Spinner from '../components/ui/Spinner.jsx'
import Card from '../components/ui/Card.jsx'
import Badge from '../components/ui/Badge.jsx'

const POLL_INTERVAL_MS = 3000

function buildJoinUrl(session) {
  if (!session) return ''
  const base = window.location.origin
  // Prefer join_url from session; fall back to constructing from qr_token
  return session.join_url
    ? session.join_url
    : `${base}/join?token=${session.qr_token ?? ''}`
}

export default function LobbyPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const {
    session,
    players,
    playerId,
    isHost,
    wsUrl,
    qrToken,
    setSession,
    setPlayers,
  } = useGameStore()

  const { status: wsStatus } = useWebSocket(wsUrl, sessionId, playerId)

  const pollRef = useRef(null)

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

  // ── Build join URL for QR display ──────────────────────────────────────
  const joinUrl = session?.join_url
    ? session.join_url
    : qrToken
      ? `${window.location.origin}/join?token=${qrToken}`
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

      {/* Waiting state message */}
      <Card padding="sm">
        <div className="flex items-center gap-3 py-1">
          <Spinner size="sm" className="text-blue-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-900">
              {isHost
                ? 'Esperando jugadores…'
                : 'Esperando que el anfitrión inicie el juego…'}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {session.mode === 'TOURNAMENT'
                ? 'Modo Torneo'
                : 'Modo Todos contra Todos'}
              {maxPlayers > 0 ? ` · Máx. ${maxPlayers} jugadores` : ''}
            </p>
          </div>
        </div>
      </Card>

      {/* Player list */}
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

      {/* Session ID footnote */}
      <p className="text-center text-xs text-zinc-300 mt-auto">
        Sesión: <span className="font-mono">{sessionId?.slice(0, 8)}…</span>
      </p>
    </main>
  )
}
