/**
 * RoundResult — full-screen overlay shown for ~3 seconds after each round.
 *
 * Props:
 *   result        { round_number, winner_id, is_tie, results }
 *   playerId      string   — current client's player_id
 *   players       array    — to resolve winner display_name
 *   onDismiss     ()=>void — called after timeout or tap
 */

import { useEffect } from 'react'

const MOVE_EMOJI = { ROCK: '🪨', PAPER: '📄', SCISSORS: '✂️' }
const DISMISS_AFTER_MS = 3000

export default function RoundResult({ result, playerId, players, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  if (!result) return null

  const { round_number, winner_id, is_tie, results = [] } = result

  const isWin  = !is_tie && winner_id === playerId
  const isLose = !is_tie && winner_id !== playerId
  const isTie  = !!is_tie

  const outcomeLabel = isWin ? '¡Ganaste!' : isTie ? 'Empate' : 'Perdiste'
  const outerBg      = isWin ? 'bg-green-50' : isTie ? 'bg-zinc-50' : 'bg-red-50'
  const labelColor   = isWin ? 'text-green-700' : isTie ? 'text-zinc-600' : 'text-red-600'
  const bigEmoji     = isWin ? '🏆' : isTie ? '🤝' : '💔'

  const winnerName = players.find(p => p.player_id === winner_id)?.display_name ?? 'Alguien'

  // My move in this round
  const myResult   = results.find(r => r.player_id === playerId)
  const myMove     = myResult?.move

  return (
    <div
      className={[
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'animate-fade-in cursor-pointer',
        outerBg,
      ].join(' ')}
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={`Resultado ronda ${round_number}: ${outcomeLabel}`}
      onClick={onDismiss}
    >
      {/* Outcome emoji */}
      <span className="text-7xl mb-4 select-none" aria-hidden="true">
        {bigEmoji}
      </span>

      {/* Round label */}
      <p className="text-sm font-medium text-zinc-400 uppercase tracking-widest mb-1">
        Ronda {round_number}
      </p>

      {/* Outcome label */}
      <h2 className={`text-4xl font-extrabold mb-3 ${labelColor}`}>
        {outcomeLabel}
      </h2>

      {/* Winner name (when not a tie) */}
      {!isTie && (
        <p className="text-zinc-500 text-sm mb-6">
          {isWin ? 'Tú ganaste esta ronda' : `${winnerName} ganó esta ronda`}
        </p>
      )}

      {/* Moves summary */}
      {results.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3 mb-8 px-6">
          {results.map((r) => {
            const name   = players.find(p => p.player_id === r.player_id)?.display_name ?? r.player_id
            const isMe   = r.player_id === playerId
            const isWinner = r.player_id === winner_id && !is_tie
            return (
              <div
                key={r.player_id}
                className={[
                  'flex flex-col items-center gap-1 px-4 py-3 rounded-2xl border',
                  isWinner
                    ? 'border-green-300 bg-green-100'
                    : 'border-zinc-200 bg-white',
                ].join(' ')}
              >
                <span className="text-2xl" aria-hidden="true">
                  {MOVE_EMOJI[r.move] ?? '❓'}
                </span>
                <span className={`text-xs font-medium ${isMe ? 'text-blue-600' : 'text-zinc-600'}`}>
                  {isMe ? 'Tú' : name}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-zinc-400 text-xs">Toca para continuar</p>
    </div>
  )
}
