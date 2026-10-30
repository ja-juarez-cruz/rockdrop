/**
 * Final tournament standings derived from the bracket, so they match what the
 * bracket shows:
 *   matches_won — matches the player won (decides the ranking)
 *   rounds_won  — sum of the player's round wins across all their matches
 *                 (the numbers next to each name in the bracket; tiebreak)
 *
 * The champion always ranks first.  Players are taken from the bracket, so a
 * host who only organized never appears.
 *
 * @param {object} bracket  { matches, champion_id }
 * @param {Array}  players  [{ player_id, status }] — used for connection status
 * @returns {Array} [{ player_id, display_name, status, matches_won, rounds_won }]
 */
export function tournamentStandings(bracket, players = []) {
  const rows = new Map()
  const statusById = new Map(players.map(p => [p.player_id, p.status]))

  for (const m of bracket?.matches ?? []) {
    const count = Number(m.player_count ?? 2)
    for (let k = 1; k <= count; k++) {
      const id = m[`player${k}_id`]
      if (!id) continue
      if (!rows.has(id)) {
        rows.set(id, {
          player_id:    id,
          display_name: m[`player${k}_name`],
          status:       statusById.get(id),
          matches_won:  0,
          rounds_won:   0,
        })
      }
      const row = rows.get(id)
      row.rounds_won += Number(m[`player${k}_wins`] ?? 0)
      if (m.status === 'COMPLETE' && m.winner_id === id) row.matches_won += 1
    }
  }

  const championId = bracket?.champion_id
  return [...rows.values()].sort((a, b) =>
    (b.player_id === championId) - (a.player_id === championId) ||
    b.matches_won - a.matches_won ||
    b.rounds_won - a.rounds_won ||
    a.display_name.localeCompare(b.display_name)
  )
}
