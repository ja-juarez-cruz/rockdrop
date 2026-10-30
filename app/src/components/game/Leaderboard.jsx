/**
 * Leaderboard — ranked score table.
 *
 * Props:
 *   players    array of { player_id, display_name, score, status, ... }
 *   playerId   string   — current client's player_id (highlighted)
 *   columns    [{ key, label, aria }] numeric columns to show (default: score)
 *   presorted  boolean  — keep the given order instead of sorting by score
 */

import Badge from '../ui/Badge.jsx'

const MEDALS = ['🥇', '🥈', '🥉']

const DEFAULT_COLUMNS = [{ key: 'score', label: 'Pts', aria: 'puntos' }]

// Literal class names so Tailwind keeps them
const GRID_COLS = {
  1: 'grid-cols-[2rem_1fr_auto]',
  2: 'grid-cols-[2rem_1fr_4rem_4rem]',
}

export default function Leaderboard({ players = [], playerId, columns = DEFAULT_COLUMNS, presorted = false }) {
  const sorted = presorted
    ? players
    : [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const gridCols = GRID_COLS[columns.length] ?? GRID_COLS[1]

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-400 text-sm">
        Aún no hay puntuaciones
      </div>
    )
  }

  return (
    <div
      className="w-full overflow-hidden rounded-2xl border border-zinc-200"
      role="table"
      aria-label="Clasificación"
    >
      {/* Header */}
      <div
        className={`grid ${gridCols} gap-3 px-4 py-2.5 bg-zinc-50 border-b border-zinc-200`}
        role="row"
      >
        <span className="text-xs font-semibold text-zinc-400 uppercase" role="columnheader">#</span>
        <span className="text-xs font-semibold text-zinc-400 uppercase" role="columnheader">Jugador</span>
        {columns.map(col => (
          <span key={col.key} className="text-xs font-semibold text-zinc-400 uppercase text-right" role="columnheader">
            {col.label}
          </span>
        ))}
      </div>

      {/* Rows */}
      {sorted.map((player, idx) => {
        const isMe = player.player_id === playerId
        const medal = MEDALS[idx]

        return (
          <div
            key={player.player_id}
            role="row"
            aria-current={isMe ? 'true' : undefined}
            className={[
              `grid ${gridCols} gap-3 items-center px-4 py-3`,
              'border-b border-zinc-100 last:border-b-0',
              isMe ? 'bg-blue-50' : 'bg-white hover:bg-zinc-50',
            ].join(' ')}
          >
            {/* Rank */}
            <span
              className="text-base text-center select-none"
              role="cell"
              aria-label={`Posición ${idx + 1}`}
            >
              {medal ?? (
                <span className="text-sm font-semibold text-zinc-400">
                  {idx + 1}
                </span>
              )}
            </span>

            {/* Name + status */}
            <div className="flex items-center gap-2 min-w-0" role="cell">
              <span
                className={[
                  'truncate text-sm font-medium',
                  isMe ? 'text-blue-700' : 'text-zinc-900',
                ].join(' ')}
              >
                {player.display_name}
                {isMe && (
                  <span className="ml-1.5 text-xs font-normal text-blue-500">(Tú)</span>
                )}
              </span>
              {player.status === 'DISCONNECTED' && (
                <Badge variant="disconnected">off</Badge>
              )}
            </div>

            {/* Numeric columns */}
            {columns.map((col, i) => (
              <span
                key={col.key}
                role="cell"
                aria-label={`${player[col.key] ?? 0} ${col.aria}`}
                className={[
                  'text-sm tabular-nums text-right',
                  i === 0 ? 'font-bold' : 'font-medium',
                  isMe ? 'text-blue-600' : i === 0 ? 'text-zinc-900' : 'text-zinc-500',
                ].join(' ')}
              >
                {player[col.key] ?? 0}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
