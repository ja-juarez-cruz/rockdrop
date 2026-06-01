/**
 * MoveSelector — three large interactive buttons for ROCK / PAPER / SCISSORS.
 *
 * Props:
 *   onSelect     (move: 'ROCK'|'PAPER'|'SCISSORS') => void
 *   selected     'ROCK'|'PAPER'|'SCISSORS'|null   — current selection
 *   disabled     boolean                           — lock after submit
 *   loading      boolean                           — submitting in flight
 */

const MOVES = [
  { value: 'ROCK',     label: 'Piedra',  emoji: '🪨' },
  { value: 'PAPER',    label: 'Papel',   emoji: '📄' },
  { value: 'SCISSORS', label: 'Tijeras', emoji: '✂️' },
]

export default function MoveSelector({
  onSelect,
  selected = null,
  disabled = false,
  loading = false,
}) {
  return (
    <div
      className="grid grid-cols-3 gap-3 w-full"
      role="group"
      aria-label="Elige tu jugada"
    >
      {MOVES.map(({ value, label, emoji }) => {
        const isSelected = selected === value
        const isDisabled = disabled || loading

        return (
          <button
            key={value}
            type="button"
            onClick={() => !isDisabled && onSelect(value)}
            disabled={isDisabled}
            aria-pressed={isSelected}
            aria-label={label}
            className={[
              'flex flex-col items-center justify-center',
              'gap-2 py-5 rounded-2xl',
              'border-2 transition-all duration-150',
              'touch-manipulation select-none cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
              isSelected
                ? 'border-blue-600 bg-blue-50 scale-[1.03] shadow-md'
                : isDisabled
                  ? 'border-zinc-100 bg-zinc-50 opacity-50 cursor-not-allowed'
                  : 'border-zinc-200 bg-white hover:border-blue-300 hover:bg-blue-50 active:scale-95',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className="text-4xl leading-none"
              role="img"
              aria-hidden="true"
            >
              {emoji}
            </span>
            <span
              className={[
                'text-xs font-semibold tracking-wide uppercase',
                isSelected ? 'text-blue-600' : 'text-zinc-500',
              ].join(' ')}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
