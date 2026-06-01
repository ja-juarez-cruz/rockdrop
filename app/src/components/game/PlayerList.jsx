/**
 * PlayerList — responsive grid of connected players with status dot.
 *
 * Props:
 *   players     array of { player_id, display_name, is_host, score, status }
 *   playerId    string   — current client (self-highlight)
 *   maxPlayers  number   — to show empty slots
 */

export default function PlayerList({ players = [], playerId, maxPlayers }) {
  const emptySlots = maxPlayers
    ? Math.max(0, maxPlayers - players.length)
    : 0

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      role="list"
      aria-label="Jugadores"
    >
      {players.map((player) => {
        const isMe          = player.player_id === playerId
        const isConnected   = player.status !== 'DISCONNECTED'

        return (
          <div
            key={player.player_id}
            role="listitem"
            className={[
              'flex items-center gap-3 px-4 py-3 rounded-2xl border',
              'transition-colors duration-150',
              isMe
                ? 'border-blue-200 bg-blue-50'
                : 'border-zinc-200 bg-white',
            ].join(' ')}
          >
            {/* Status dot */}
            <span
              aria-hidden="true"
              className={[
                'w-2.5 h-2.5 rounded-full shrink-0',
                isConnected ? 'bg-green-500' : 'bg-zinc-300',
              ].join(' ')}
            />

            {/* Name area */}
            <div className="min-w-0 flex-1">
              <p
                className={[
                  'text-sm font-medium truncate',
                  isMe ? 'text-blue-700' : 'text-zinc-900',
                ].join(' ')}
              >
                {player.display_name}
              </p>
              {(player.is_host || isMe) && (
                <p className="text-xs text-zinc-400">
                  {player.is_host ? 'Host' : ''}
                  {player.is_host && isMe ? ' · ' : ''}
                  {isMe ? 'Tú' : ''}
                </p>
              )}
            </div>
          </div>
        )
      })}

      {/* Empty placeholder slots */}
      {Array.from({ length: emptySlots }).map((_, i) => (
        <div
          key={`empty-${i}`}
          role="listitem"
          aria-label="Slot vacío"
          className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50"
        >
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-full shrink-0 bg-zinc-200"
          />
          <p className="text-sm text-zinc-300">Esperando...</p>
        </div>
      ))}
    </div>
  )
}
