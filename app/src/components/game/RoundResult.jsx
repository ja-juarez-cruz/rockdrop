/**
 * RoundResult — full-screen overlay shown after each round resolves.
 *
 * Props:
 *   result      { round_number, winner_id, results: {player_id: {move,outcome}} }
 *   playerId    string
 *   players     array — to resolve display_name
 *   onDismiss   ()=>void
 *   isGameOver  boolean — true when this round ended the FFA match
 */

import { useEffect } from 'react'

const MOVE_EMOJI = { ROCK: '🪨', PAPER: '📄', SCISSORS: '✂️' }
const MOVE_LABEL = { ROCK: 'Piedra', PAPER: 'Papel', SCISSORS: 'Tijeras' }
const DISMISS_MS = 5000

export default function RoundResult({ result, playerId, players, onDismiss, isGameOver = false }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, DISMISS_MS)
    return () => clearTimeout(t)
  }, [onDismiss])

  if (!result) return null

  const { round_number, winner_id, results = {} } = result

  const rows = Object.entries(results).map(([pid, data]) => ({
    player_id:    pid,
    move:         data.move,
    outcome:      data.outcome,
    display_name: players.find(p => p.player_id === pid)?.display_name ?? 'Jugador',
    isMe:         pid === playerId,
    isWinner:     pid === winner_id,
  }))

  const myRow     = rows.find(r => r.isMe)
  const myOutcome = myRow?.outcome ?? 'TIE'
  const isTie     = !winner_id
  const isWin     = myOutcome === 'WIN'

  const bgColor   = isWin ? 'bg-green-50'   : isTie ? 'bg-zinc-50'    : 'bg-red-50'
  const bigEmoji  = isGameOver
    ? (isWin ? '🏆' : '🎮')
    : (isWin ? '🏆' : isTie ? '🤝' : '😓')
  const headline  = isGameOver
    ? (isWin ? '¡Ganaste el juego!' : isTie ? 'Empate' : 'Perdiste el juego')
    : (isWin ? '¡Ganaste!'          : isTie ? 'Empate' : 'Perdiste')
  const headColor = isWin ? 'text-green-700' : isTie ? 'text-zinc-600' : 'text-red-600'

  const winnerName = rows.find(r => r.isWinner)?.display_name

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-4 ${bgColor} animate-fade-in cursor-pointer`}
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
      onClick={onDismiss}
    >
      <span className="text-7xl mb-3 select-none" aria-hidden="true">{bigEmoji}</span>

      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-1">
        {isGameOver ? 'Partido terminado' : `Ronda ${round_number}`}
      </p>
      <h2 className={`text-4xl font-extrabold mb-1 ${headColor}`}>{headline}</h2>

      {!isTie && winnerName && (
        <p className="text-sm text-zinc-500 mb-6">
          {isWin
            ? (isGameOver ? '¡Alcanzaste las victorias necesarias!' : 'Tú ganas esta ronda')
            : `${winnerName} ${isGameOver ? 'ganó el partido' : 'gana esta ronda'}`}
        </p>
      )}
      {isTie && (
        <p className="text-sm text-zinc-500 mb-6">Nadie gana puntos</p>
      )}

      <div className="flex flex-wrap justify-center gap-3 w-full max-w-sm mb-6">
        {rows.map((r) => {
          const outcomeBg =
            r.outcome === 'WIN'  ? 'border-green-400 bg-green-100' :
            r.outcome === 'LOSE' ? 'border-red-200   bg-red-50'    :
                                   'border-zinc-200  bg-white'

          const outcomeLabel =
            r.outcome === 'WIN'  ? 'Ganó'  :
            r.outcome === 'LOSE' ? 'Perdió': 'Empató'

          const outcomeColor =
            r.outcome === 'WIN'  ? 'text-green-700 bg-green-200' :
            r.outcome === 'LOSE' ? 'text-red-600   bg-red-100'   :
                                   'text-zinc-500  bg-zinc-200'

          return (
            <div
              key={r.player_id}
              className={`flex flex-col items-center gap-1.5 px-5 py-3 rounded-2xl border-2 ${outcomeBg}`}
            >
              <span className="text-3xl" aria-hidden="true">
                {MOVE_EMOJI[r.move] ?? '❓'}
              </span>
              <span className={`text-[11px] font-medium ${r.isMe ? 'text-blue-600' : 'text-zinc-600'}`}>
                {r.isMe ? `Tú · ${MOVE_LABEL[r.move] ?? r.move}` : r.display_name}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${outcomeColor}`}>
                {outcomeLabel}
              </span>
            </div>
          )
        })}
      </div>

      <p className="text-zinc-400 text-xs">
        {isGameOver ? 'Toca para ver resultados finales' : 'Toca para continuar'}
      </p>
    </div>
  )
}
