/**
 * JoinPage — /join?token=xxx
 *
 * Reads JWT token from query param, decodes session_id from payload,
 * asks for a display_name, then POSTs to join the session.
 *
 * On success → navigate to /lobby/:sessionId
 * Errors: 401 (token expired), 409 (session full / not waiting)
 */

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { joinSession } from '../lib/api.js'
import useGameStore from '../stores/gameStore.js'
import Button from '../components/ui/Button.jsx'
import Card from '../components/ui/Card.jsx'

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1]
    // atob requires standard base64; JWT uses base64url — replace url-safe chars
    const base64Fixed = base64.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64Fixed))
  } catch {
    return null
  }
}

function getErrorMessage(err) {
  if (err.status === 401) return 'Este enlace ha expirado. Pide uno nuevo al anfitrión.'
  if (err.status === 409) return 'La sesión está llena o ya inició. No puedes unirte ahora.'
  return err.message || 'Ocurrió un error inesperado. Inténtalo de nuevo.'
}

export default function JoinPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setPlayer = useGameStore((s) => s.setPlayer)

  const token     = searchParams.get('token') || ''
  const payload   = token ? decodeJwtPayload(token) : null
  const sessionId = payload?.session_id ?? null

  const [name,    setName]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // Validate token on mount
  const tokenInvalid = token && !sessionId

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !sessionId) return

    setLoading(true)
    setError('')

    try {
      const data = await joinSession(sessionId, {
        display_name: name.trim(),
        token,
      })

      // data: { player_id, session_id, display_name, ws_url }
      setPlayer({ ...data, is_host: false })
      navigate(`/lobby/${data.session_id}`, { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-dvh bg-zinc-50 flex flex-col items-center justify-center px-4 py-10">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <span className="text-5xl select-none" aria-hidden="true">🪨</span>
        <h1 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
          RockDrop
        </h1>
        <p className="text-sm text-zinc-500">Piedra · Papel · Tijeras</p>
      </div>

      <Card className="w-full max-w-sm animate-scale-in">
        <h2 className="text-lg font-semibold text-zinc-900 mb-1">
          Unirse a la partida
        </h2>
        <p className="text-sm text-zinc-500 mb-6">
          Ingresa tu nombre para que los demás te reconozcan.
        </p>

        {/* Token invalid state */}
        {tokenInvalid ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            El enlace de invitación no es válido. Pide uno nuevo al anfitrión.
          </div>
        ) : !token ? (
          <div className="rounded-xl bg-zinc-100 border border-zinc-200 px-4 py-3 text-sm text-zinc-500">
            No se encontró un token de invitación. Escanea el QR del anfitrión.
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="display_name"
                className="text-sm font-medium text-zinc-700"
              >
                Tu nombre
              </label>
              <input
                id="display_name"
                type="text"
                autoComplete="nickname"
                autoFocus
                maxLength={24}
                placeholder="Ej: Juanito"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                aria-required="true"
                aria-describedby={error ? 'join-error' : undefined}
                className={[
                  'h-11 px-4 rounded-xl border text-sm text-zinc-900 bg-white',
                  'placeholder:text-zinc-300',
                  'transition-colors duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:border-blue-400',
                  error ? 'border-red-400' : 'border-zinc-200',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                ].join(' ')}
              />
              {error && (
                <p
                  id="join-error"
                  role="alert"
                  className="text-xs text-red-500 mt-0.5"
                >
                  {error}
                </p>
              )}
            </div>

            <Button
              type="submit"
              fullWidth
              loading={loading}
              disabled={!name.trim()}
            >
              Entrar a la partida
            </Button>
          </form>
        )}
      </Card>

      <p className="mt-6 text-xs text-zinc-300">
        ¿Problemas? Pide al anfitrión que reenvíe el enlace.
      </p>
    </main>
  )
}
