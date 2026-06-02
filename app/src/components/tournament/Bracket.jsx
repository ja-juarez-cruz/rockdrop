/**
 * Bracket — visual single-elimination bracket tree.
 *
 * Renders all rounds side-by-side with connector lines.
 * Supports PENDING (TBD), ACTIVE, BYE, and COMPLETE match states.
 *
 * Props:
 *   bracket   { wins_needed, current_tournament_round, total_tournament_rounds,
 *               matches: [...], champion_id }
 *   playerId  string — current client (highlighted)
 */

// ── Layout constants ──────────────────────────────────────────────────────────
const CARD_H   = 68   // px — height of each match card
const SLOT_U   = 76   // px — slot unit for round 1 (card + gap)
const CARD_W   = 152  // px — width of each match card
const CONN_W   = 20   // px — width of connector column between rounds
const LINE_CLR = '#d4d4d8'  // zinc-300

function slotHeight(round) {
  return SLOT_U * Math.pow(2, round - 1)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PlayerRow({ name, wins, isWinner, isLoser, isMe, isTbd }) {
  return (
    <div className={`flex items-center justify-between px-2 py-0.5 rounded-lg ${isWinner ? 'bg-green-100' : ''}`}>
      <span className={[
        'text-[11px] font-medium truncate max-w-[98px]',
        isTbd      ? 'text-zinc-300 italic' :
        isWinner   ? 'text-green-700 font-semibold' :
        isLoser    ? 'text-zinc-300 line-through' :
        isMe       ? 'text-blue-600' :
        'text-zinc-700',
      ].join(' ')}>
        {name || '?'}
        {isMe && !isTbd && <span className="ml-0.5 text-blue-400 text-[9px]">★</span>}
      </span>
      <span className={`text-[11px] tabular-nums font-bold ml-1 shrink-0 ${
        isTbd ? 'text-zinc-300' : isWinner ? 'text-green-700' : 'text-zinc-400'
      }`}>
        {isTbd ? '–' : wins}
      </span>
    </div>
  )
}

function MatchCard({ match, playerId }) {
  const isPending = match.status === 'PENDING'
  const isBye     = match.status === 'BYE'
  const isActive  = match.status === 'ACTIVE'
  const isComplete = match.status === 'COMPLETE'

  const isMe = match.player1_id === playerId || match.player2_id === playerId

  const p1Wins = Number(match.player1_wins ?? 0)
  const p2Wins = Number(match.player2_wins ?? 0)

  const p1Tbd = isPending || !match.player1_id
  const p2Tbd = isPending || !match.player2_id

  const borderCls = isPending  ? 'border-dashed border-zinc-200' :
                    isActive && isMe ? 'border-blue-400' :
                    isActive   ? 'border-zinc-300' :
                    'border-zinc-200'

  const bgCls = isActive && isMe ? 'bg-blue-50' :
                isPending         ? 'bg-zinc-50' :
                'bg-white'

  return (
    <div
      style={{height: CARD_H, width: CARD_W}}
      className={`border-2 rounded-xl flex flex-col justify-center overflow-hidden shrink-0 ${borderCls} ${bgCls}`}
    >
      {isBye ? (
        <div className="px-2 py-1">
          <span className="text-[11px] font-medium text-zinc-700">
            {match.player1_id ? match.player1_name : match.player2_name}
          </span>
          <span className="ml-1 text-[10px] text-zinc-400">Pase directo</span>
        </div>
      ) : (
        <div className="flex flex-col justify-center px-0.5 py-0.5 gap-0.5">
          <PlayerRow
            name={match.player1_name}
            wins={p1Wins}
            isWinner={isComplete && match.winner_id === match.player1_id}
            isLoser={isComplete && match.winner_id && match.winner_id !== match.player1_id}
            isMe={match.player1_id === playerId}
            isTbd={p1Tbd}
          />
          <div className="border-t border-zinc-100 mx-2" />
          <PlayerRow
            name={match.player2_name}
            wins={p2Wins}
            isWinner={isComplete && match.winner_id === match.player2_id}
            isLoser={isComplete && match.winner_id && match.winner_id !== match.player2_id}
            isMe={match.player2_id === playerId}
            isTbd={p2Tbd}
          />
        </div>
      )}
    </div>
  )
}

/**
 * ConnectorCol — renders the ├── bracket connector lines between two rounds.
 * For each target match, it shows two "arms" (one from each source).
 */
function ConnectorCol({ numPairs, srcSlotH }) {
  const tgtSlotH = srcSlotH * 2
  return (
    <div style={{width: CONN_W}} className="flex flex-col shrink-0">
      {Array.from({length: numPairs}).map((_, i) => (
        <div key={i} style={{height: tgtSlotH}} className="flex flex-col">
          {/* Top arm: right border + bottom border form ┘ at midpoint */}
          <div style={{
            flex: 1,
            borderRight: `2px solid ${LINE_CLR}`,
            borderBottom: `2px solid ${LINE_CLR}`,
          }} />
          {/* Bottom arm: right border + top border form ┐ at midpoint */}
          <div style={{
            flex: 1,
            borderRight: `2px solid ${LINE_CLR}`,
            borderTop: `2px solid ${LINE_CLR}`,
          }} />
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Bracket({ bracket, playerId }) {
  if (!bracket?.matches?.length) {
    return (
      <div className="text-center text-zinc-400 text-sm py-8">
        El bracket aún no está disponible
      </div>
    )
  }

  const { total_tournament_rounds = 1, matches, current_tournament_round = 1 } = bracket

  // Group matches by tournament_round
  const byRound = {}
  for (let r = 1; r <= total_tournament_rounds; r++) {
    byRound[r] = matches.filter(m => Number(m.tournament_round) === r)
  }

  // Champion name
  const champId   = bracket.champion_id
  const champMatch = champId
    ? matches.find(m => m.status === 'COMPLETE' && m.winner_id === champId && Number(m.tournament_round) === total_tournament_rounds)
    : null
  const champName = champMatch
    ? (champMatch.winner_id === champMatch.player1_id ? champMatch.player1_name : champMatch.player2_name)
    : null

  return (
    <div className="overflow-x-auto pb-3 -mx-1" aria-label="Bracket del torneo">
      <div className="flex items-start px-1 pt-1">

        {Array.from({length: total_tournament_rounds}).map((_, ri) => {
          const r           = ri + 1
          const roundMatches = byRound[r] ?? []
          const slotH       = slotHeight(r)
          const isLast      = r === total_tournament_rounds
          const isCurrent   = r === current_tournament_round

          return (
            <div key={r} className="flex items-start">
              {/* Round column */}
              <div style={{width: CARD_W}} className="flex flex-col shrink-0">
                {/* Round header */}
                <p className={`text-[10px] font-semibold uppercase tracking-wider text-center mb-2 ${
                  isCurrent ? 'text-blue-500' : 'text-zinc-400'
                }`}>
                  {isLast ? 'Final' : `Ronda ${r}`}
                  {isCurrent && (
                    <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-blue-500 align-middle" />
                  )}
                </p>

                {/* Match slots */}
                {roundMatches.map(match => (
                  <div
                    key={match.match_id}
                    style={{height: slotH}}
                    className="flex items-center"
                  >
                    <MatchCard match={match} playerId={playerId} />
                    {/* Right stub to connector */}
                    {!isLast && (
                      <div style={{width: 8, height: 2, backgroundColor: LINE_CLR, flexShrink: 0}} />
                    )}
                  </div>
                ))}
              </div>

              {/* Connector column between rounds */}
              {!isLast && roundMatches.length > 0 && (
                <>
                  <ConnectorCol
                    numPairs={Math.ceil(roundMatches.length / 2)}
                    srcSlotH={slotH}
                  />
                  {/* Left stub from connector to next round card */}
                  <div className="flex flex-col shrink-0" style={{width: 8}}>
                    {(byRound[r + 1] ?? []).map(m => (
                      <div key={m.match_id} style={{height: slotHeight(r + 1)}} className="flex items-center">
                        <div style={{width: 8, height: 2, backgroundColor: LINE_CLR}} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}

        {/* Champion badge */}
        {champId && (
          <div className="flex flex-col shrink-0 ml-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-center mb-2 text-amber-500">
              Campeón
            </p>
            <div
              style={{height: slotHeight(total_tournament_rounds)}}
              className="flex items-center"
            >
              <div className="border-2 border-amber-400 bg-amber-50 rounded-xl px-3 py-2 text-center min-w-[80px]">
                <span className="text-2xl block">🏆</span>
                <p className="text-[11px] font-bold text-amber-700 mt-0.5 truncate max-w-[72px]">
                  {champName}
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
