/**
 * Leaderboard — ranked score table.
 *
 * Props:
 *   players   array of { player_id, display_name, score, status }
 *   playerId  string   — current client's player_id (highlighted)
 */

import Badge from '../ui/Badge.jsx'

const MEDALS = ['🥇', '🥈', '🥉']

export default function Leaderboard({ players = [], playerId }) {
  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

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
        className="grid grid-cols-[2rem_1fr_auto] gap-3 px-4 py-2.5 bg-zinc-50 border-b border-zinc-200"
        role="row"
      >
        <span className="text-xs font-semibold text-zinc-400 uppercase" role="columnheader">#</span>
        <span className="text-xs font-semibold text-zinc-400 uppercase" role="columnheader">Jugador</span>
        <span className="text-xs font-semibold text-zinc-400 uppercase" role="columnheader">Pts</span>
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
              'grid grid-cols-[2rem_1fr_auto] gap-3 items-center px-4 py-3',
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

            {/* Score */}
            <span
              role="cell"
              aria-label={`${player.score ?? 0} puntos`}
              className={[
                'text-sm font-bold tabular-nums',
                isMe ? 'text-blue-600' : 'text-zinc-900',
              ].join(' ')}
            >
              {player.score ?? 0}
            </span>
          </div>
        )
      })}
    </div>
  )
}
