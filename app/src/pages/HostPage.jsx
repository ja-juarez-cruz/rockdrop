/**
 * HostPage — /host
 *
 * Host creates a new session from the browser (dev / demo flow).
 * Steps:
 *   1. Form: display_name, mode, max_players
 *   2. POST /sessions → show QR + join URL
 *   3. "Ir al lobby" → /lobby/:sessionId
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSession } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import Button from '../components/ui/Button.jsx'
import Card from '../components/ui/Card.jsx'
import QRDisplay from '../components/lobby/QRDisplay.jsx'

const HOST_PLAYER_ID_KEY = 'rockdrop_host_player_id'

function getOrCreateHostId() {
  let id = localStorage.getItem(HOST_PLAYER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(HOST_PLAYER_ID_KEY, id)
  }
  return id
}

const MODES = [
  {
    value: 'FREE_FOR_ALL',
    label: 'Todos contra todos',
    description: 'Gana quien acumule más puntos por ronda.',
  },
  {
    value: 'TOURNAMENT',
    label: 'Torneo',
    description: 'Bracket eliminatorio 1v1 hasta el campeón.',
  },
]

export default function HostPage() {
  const navigate = useNavigate()
  const { setPlayer, setSession } = useGameStore()

  const [step, setStep] = useState('form') // 'form' | 'ready'

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [mode, setMode]               = useState('FREE_FOR_ALL')
  const [maxPlayers, setMaxPlayers]   = useState(10)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  // Result state
  const [joinUrl, setJoinUrl]     = useState('')
  const [sessionId, setSessionId] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    if (!displayName.trim()) return

    setLoading(true)
    setError('')

    try {
      const hostPlayerId = getOrCreateHostId()
      const data = await createSession({
        host_player_id: hostPlayerId,
        display_name:   displayName.trim(),
        mode,
        max_players:    maxPlayers,
      })

      // data: { session_id, qr_token, ws_url, join_url }
      setPlayer({
        player_id:  hostPlayerId,
        session_id: data.session_id,
        ws_url:     data.ws_url,
        is_host:    true,
        qr_token:   data.qr_token,
      })

      // Build join URL using current origin + hash routing (works in dev and prod)
      const localJoinUrl = `${window.location.origin}${window.location.pathname}#/join?token=${data.qr_token}`

      setJoinUrl(localJoinUrl)
      setSessionId(data.session_id)
      setStep('ready')
    } catch (err) {
      setError(err.message || 'No se pudo crear la sesión.')
    } finally {
      setLoading(false)
    }
  }

  function goToLobby() {
    navigate(`/lobby/${sessionId}`)
  }

  return (
    <main className="min-h-dvh bg-zinc-50 flex flex-col items-center justify-center px-4 py-10">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <span className="text-5xl select-none" aria-hidden="true">🪨</span>
        <h1 className="text-2xl font-extrabold text-zinc-900 tracking-tight">RockDrop</h1>
        <p className="text-sm text-zinc-500">Crear partida</p>
      </div>

      {step === 'form' && (
        <Card className="w-full max-w-sm">
          <h2 className="text-lg font-semibold text-zinc-900 mb-1">Nueva partida</h2>
          <p className="text-sm text-zinc-500 mb-6">
            Configura la sesión y comparte el QR con los jugadores.
          </p>

          <form onSubmit={handleCreate} noValidate className="flex flex-col gap-5">
            {/* Display name */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="host_name" className="text-sm font-medium text-zinc-700">
                Tu nombre
              </label>
              <input
                id="host_name"
                type="text"
                autoFocus
                autoComplete="nickname"
                maxLength={24}
                placeholder="Ej: Jose (Host)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
                className={[
                  'h-11 px-4 rounded-xl border text-sm text-zinc-900 bg-white',
                  'placeholder:text-zinc-300',
                  'transition-colors duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                ].join(' ')}
              />
            </div>

            {/* Mode selector */}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-zinc-700 mb-1">Modo de juego</legend>
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={[
                    'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    mode === m.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-zinc-200 bg-white hover:border-zinc-300',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{m.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{m.description}</p>
                  </div>
                </label>
              ))}
            </fieldset>

            {/* Max players */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <label htmlFor="max_players" className="text-sm font-medium text-zinc-700">
                  Máximo de jugadores
                </label>
                <span className="text-sm font-semibold text-zinc-900 tabular-nums w-6 text-right">
                  {maxPlayers}
                </span>
              </div>
              <input
                id="max_players"
                type="range"
                min={2}
                max={30}
                step={1}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                disabled={loading}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-zinc-400">
                <span>2</span>
                <span>30</span>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-500">
                {error}
              </p>
            )}

            <Button
              type="submit"
              fullWidth
              loading={loading}
              disabled={!displayName.trim()}
            >
              Crear partida
            </Button>
          </form>
        </Card>
      )}

      {step === 'ready' && (
        <Card className="w-full max-w-sm text-center">
          <h2 className="text-lg font-semibold text-zinc-900 mb-1">¡Sesión lista!</h2>
          <p className="text-sm text-zinc-500 mb-6">
            Comparte el QR o el enlace con los jugadores.
          </p>

          <QRDisplay joinUrl={joinUrl} />

          <div className="mt-6 pt-6 border-t border-zinc-100">
            <Button fullWidth onClick={goToLobby}>
              Ir al lobby
            </Button>
            <button
              onClick={() => setStep('form')}
              className="mt-3 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Crear otra sesión
            </button>
          </div>
        </Card>
      )}

      <p className="mt-6 text-xs text-zinc-300">
        ¿Eres un jugador?{' '}
        <a href="/join" className="underline hover:text-zinc-500 transition-colors">
          Escanea el QR del anfitrión
        </a>
      </p>
    </main>
  )
}
