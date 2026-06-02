/**
 * DuelView — shown after submitting a move, while waiting for opponents.
 *
 * Props:
 *   myMove               'ROCK'|'PAPER'|'SCISSORS'
 *   opponents            Array<{ player_id: string, display_name: string }>
 *   submittedOpponentIds string[]  — opponent ids who have already submitted
 */

const MOVE_EMOJI = { ROCK: '🪨', PAPER: '📄', SCISSORS: '✂️' }
const MOVE_LABEL = { ROCK: 'Piedra', PAPER: 'Papel', SCISSORS: 'Tijeras' }

function RevealedCard({ move }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-24 h-32 rounded-2xl border-2 border-blue-400 bg-blue-50 shadow-lg flex flex-col items-center justify-center gap-2 animate-scale-in">
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

function HiddenCard({ displayName, submitted }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={[
          'w-24 h-32 rounded-2xl border-2 flex flex-col items-center justify-center gap-2',
          submitted
            ? 'border-green-300 bg-green-50'
            : 'border-dashed border-zinc-300 bg-zinc-100 animate-pulse',
        ].join(' ')}
      >
        <span
          className={`text-4xl leading-none select-none ${
            submitted ? 'text-green-400' : 'text-zinc-300'
          }`}
          aria-hidden="true"
        >
          {submitted ? '✓' : '❓'}
        </span>
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            submitted ? 'text-green-600' : 'text-zinc-400'
          }`}
        >
          {submitted ? 'Listo' : 'Oculto'}
        </span>
      </div>
      <span className="text-xs font-semibold text-zinc-500 max-w-[88px] truncate text-center">
        {displayName}
      </span>
    </div>
  )
}

export default function DuelView({ myMove, opponents = [], submittedOpponentIds = [] }) {
  const pendingCount = opponents.filter(
    o => !submittedOpponentIds.includes(o.player_id)
  ).length

  const waitingLabel = pendingCount === 0
    ? 'Revelando cartas…'
    : opponents.length === 1
      ? `Esperando a ${opponents[0].display_name}…`
      : `Esperando a ${pendingCount} jugador${pendingCount !== 1 ? 'es' : ''}…`

  return (
    <div className="flex flex-col items-center gap-8 py-6 animate-fade-in">
      {/* Status message */}
      <div className="text-center">
        <p className="text-sm text-zinc-500">{waitingLabel}</p>
        <p className="text-xs text-zinc-400 mt-1">
          Las cartas se revelarán cuando todos elijan
        </p>
      </div>

      {/* Cards row */}
      <div className="flex items-center justify-center gap-4 w-full flex-wrap">
        <RevealedCard move={myMove} />

        <span className="text-xl font-extrabold text-zinc-300 select-none">VS</span>

        <div className="flex gap-3 flex-wrap justify-center">
          {opponents.map(opp => (
            <HiddenCard
              key={opp.player_id}
              displayName={opp.display_name}
              submitted={submittedOpponentIds.includes(opp.player_id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
