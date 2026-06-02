/**
 * DuelView — shown after submitting a move, while waiting for the opponent.
 *
 * Props:
 *   myMove       'ROCK'|'PAPER'|'SCISSORS'
 *   opponentName string
 */

const MOVE_EMOJI = { ROCK: '🪨', PAPER: '📄', SCISSORS: '✂️' }
const MOVE_LABEL = { ROCK: 'Piedra', PAPER: 'Papel', SCISSORS: 'Tijeras' }

function CardFace({ move, label, revealed }) {
  if (revealed) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="w-28 h-36 rounded-2xl border-2 border-blue-400 bg-blue-50 shadow-lg flex flex-col items-center justify-center gap-2 animate-scale-in">
          <span className="text-5xl leading-none select-none" aria-hidden="true">
            {MOVE_EMOJI[move]}
          </span>
          <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">
            {MOVE_LABEL[move]}
          </span>
        </div>
        <span className="text-xs font-semibold text-blue-600">Tú</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-28 h-36 rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-100 flex flex-col items-center justify-center gap-2 animate-pulse">
        <span className="text-4xl leading-none select-none text-zinc-300" aria-hidden="true">
          ❓
        </span>
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
          Oculto
        </span>
      </div>
      <span className="text-xs font-semibold text-zinc-500">{label}</span>
    </div>
  )
}

export default function DuelView({ myMove, opponentName }) {
  return (
    <div className="flex flex-col items-center gap-8 py-6 animate-fade-in">
      {/* Waiting message */}
      <div className="text-center">
        <p className="text-sm text-zinc-500">
          Esperando a{' '}
          <span className="font-semibold text-zinc-800">{opponentName}</span>
          {' '}…
        </p>
        <p className="text-xs text-zinc-400 mt-1">
          La carta se revelará cuando elija
        </p>
      </div>

      {/* Cards VS layout */}
      <div className="flex items-center justify-center gap-6 w-full">
        <CardFace move={myMove} revealed />

        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-extrabold text-zinc-300 select-none">VS</span>
        </div>

        <CardFace label={opponentName} revealed={false} />
      </div>
    </div>
  )
}
