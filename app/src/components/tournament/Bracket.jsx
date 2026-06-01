/**
 * Bracket — visual tournament bracket tree.
 *
 * Props:
 *   bracket     { size, total_rounds, current_round, matches, champion }
 *               matches: [{ match_id, round, player1_id, player2_id,
 *                           winner_id, status }]
 *   players     array of { player_id, display_name }
 *   playerId    string  — current client (highlight their matches)
 */

function getPlayerName(players, id) {
  if (!id) return 'TBD'
  return players.find((p) => p.player_id === id)?.display_name ?? id.slice(0, 8)
}

function MatchCard({ match, players, playerId }) {
  const isMyMatch =
    match.player1_id === playerId || match.player2_id === playerId

  const isComplete  = !!match.winner_id
  const isBye       = match.status === 'BYE'

  const p1Name  = getPlayerName(players, match.player1_id)
  const p2Name  = getPlayerName(players, match.player2_id)

  function playerRowClasses(pid) {
    const isMe      = pid === playerId
    const isWinner  = match.winner_id && match.winner_id === pid
    const isLoser   = match.winner_id && match.winner_id !== pid && pid

    if (isWinner) return 'text-green-700 font-semibold'
    if (isLoser)  return 'text-zinc-400 line-through'
    if (isMe)     return 'text-blue-600 font-medium'
    return 'text-zinc-700'
  }

  return (
    <div
      className={[
        'rounded-xl border px-3 py-2.5 text-xs min-w-[120px] max-w-[160px] shrink-0',
        isMyMatch && !isComplete
          ? 'border-blue-400 bg-blue-50'
          : 'border-zinc-200 bg-white',
        isBye ? 'opacity-50' : '',
      ].join(' ')}
    >
      {isBye ? (
        <p className="text-zinc-400 text-center">BYE</p>
      ) : (
        <>
          <p className={playerRowClasses(match.player1_id)}>{p1Name}</p>
          <div className="my-1 border-t border-zinc-100" />
          <p className={playerRowClasses(match.player2_id)}>
            {match.player2_id ? p2Name : <span className="text-zinc-300">TBD</span>}
          </p>
        </>
      )}
    </div>
  )
}

export default function Bracket({ bracket, players = [], playerId }) {
  if (!bracket || !bracket.matches || bracket.matches.length === 0) {
    return (
      <div className="text-center text-zinc-400 text-sm py-8">
        El bracket aún no está disponible
      </div>
    )
  }

  const { total_rounds = 1, matches = [], champion } = bracket

  // Group matches by round number (rounds are 1-indexed)
  const rounds = {}
  for (let r = 1; r <= total_rounds; r++) {
    rounds[r] = matches.filter((m) => m.round === r)
  }

  const championName = champion ? getPlayerName(players, champion) : null

  return (
    <div className="w-full overflow-x-auto pb-2" aria-label="Bracket del torneo">
      <div className="flex gap-6 min-w-max px-1 py-2">
        {Array.from({ length: total_rounds }, (_, i) => i + 1).map((roundNum) => {
          const roundMatches = rounds[roundNum] ?? []
          const isCurrentRound = roundNum === bracket.current_round

          return (
            <div key={roundNum} className="flex flex-col gap-4">
              {/* Round label */}
              <p
                className={[
                  'text-xs font-semibold uppercase tracking-wider text-center mb-1',
                  isCurrentRound ? 'text-blue-600' : 'text-zinc-400',
                ].join(' ')}
              >
                {roundNum === total_rounds ? 'Final' : `Ronda ${roundNum}`}
                {isCurrentRound && (
                  <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 align-middle" />
                )}
              </p>

              {/* Match cards stacked with connector spacing */}
              <div className="flex flex-col gap-6 justify-around h-full">
                {roundMatches.length > 0 ? (
                  roundMatches.map((match) => (
                    <MatchCard
                      key={match.match_id ?? `${match.round}-${match.player1_id}`}
                      match={match}
                      players={players}
                      playerId={playerId}
                    />
                  ))
                ) : (
                  <div className="min-w-[120px] h-14 rounded-xl border border-dashed border-zinc-200 bg-zinc-50" />
                )}
              </div>
            </div>
          )
        })}

        {/* Champion column */}
        {champion && (
          <div className="flex flex-col items-center justify-center gap-3 pl-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">
              Campeón
            </p>
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700 text-center min-w-[120px]">
              <span className="text-2xl block mb-1">🏆</span>
              {championName}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
