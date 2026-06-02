import { create } from 'zustand'

export const FFA_WINS_NEEDED = 3

function _findMyMatch(bracket, playerId) {
  if (!bracket?.matches || !playerId) return null
  const tr = bracket.current_tournament_round ?? 1
  return bracket.matches.find(m =>
    m.tournament_round === tr &&
    m.status === 'ACTIVE' &&
    (m.player1_id === playerId || m.player2_id === playerId)
  ) ?? null
}

/**
 * Single Zustand store for all RockDrop game state.
 *
 * gamePhase drives the Observer pattern for UI rendering:
 *   'selecting' → player is choosing a move
 *   'waiting'   → move submitted, waiting for opponent(s)
 *   'result'    → ROUND_RESOLVED received, showing overlay
 *   'finished'  → game over (FFA win condition or GAME_FINISHED event)
 */

const useGameStore = create((set, get) => ({
  // ── Session ──────────────────────────────────────────────────────────────
  sessionId: null,
  session: null,
  playerId: null,
  isHost: false,
  qrToken: null,
  wsUrl: null,

  // ── Players ───────────────────────────────────────────────────────────────
  players: [],

  // ── Game ──────────────────────────────────────────────────────────────────
  gamePhase: 'selecting',  // 'selecting' | 'waiting' | 'result' | 'finished'
  currentRound: 1,
  myMove: null,
  waitingFor: 0,
  submittedPlayers: [],
  lastRoundResult: null,
  ffaWinnerId: null,

  // ── Tournament ────────────────────────────────────────────────────────────
  bracket:      null,
  myMatch:      null,
  eliminatedBy: null,
  championId:   null,

  // ── WebSocket ─────────────────────────────────────────────────────────────
  wsStatus: 'disconnected',

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Called after creating or joining a session.
   * Resets ALL game state so stale scores/phase from a previous game don't leak.
   */
  setPlayer(data) {
    set({
      // Identity
      playerId:  data.player_id,
      sessionId: data.session_id,
      wsUrl:     data.ws_url,
      isHost:    data.is_host ?? false,
      qrToken:   data.qr_token ?? null,
      // Full game-state reset for the new session
      session:          null,
      players:          [],
      gamePhase:        'selecting',
      currentRound:     1,
      myMove:           null,
      waitingFor:       0,
      submittedPlayers: [],
      lastRoundResult:  null,
      ffaWinnerId:      null,
      bracket:          null,
      myMatch:          null,
      eliminatedBy:     null,
      championId:       null,
    })
  },

  setSession(session) {
    set({
      session,
      sessionId: session.session_id,
      // current_round is 0 during WAITING phase — clamp to minimum 1
      currentRound: Math.max(1, session.current_round > 0 ? session.current_round : get().currentRound),
    })
  },

  setPlayers(players) {
    set({ players })
  },

  // ── WS event handlers ─────────────────────────────────────────────────────

  playerJoined(payload) {
    set((state) => {
      const exists = state.players.find(p => p.player_id === payload.player_id)
      if (exists) {
        return {
          players: state.players.map(p =>
            p.player_id === payload.player_id
              ? { ...p, status: 'CONNECTED' }
              : p
          ),
        }
      }
      return {
        players: [
          ...state.players,
          {
            player_id:    payload.player_id,
            display_name: payload.display_name,
            is_host:      false,
            score:        0,
            status:       'CONNECTED',
          },
        ],
      }
    })
  },

  playerDisconnected(payload) {
    set((state) => ({
      players: state.players.map(p =>
        p.player_id === payload.player_id
          ? { ...p, status: 'DISCONNECTED' }
          : p
      ),
    }))
  },

  /**
   * Called when the player selects a move — transitions to 'waiting' phase.
   */
  setMyMove(move) {
    set({ myMove: move, gamePhase: 'waiting' })
  },

  /**
   * Called on submit error — resets back to 'selecting' phase.
   */
  resetMove() {
    set({ myMove: null, gamePhase: 'selecting' })
  },

  moveSubmitted(payload) {
    set((state) => ({
      waitingFor: payload.waiting_for,
      submittedPlayers: payload.player_id
        ? [...new Set([...state.submittedPlayers, payload.player_id])]
        : state.submittedPlayers,
    }))
  },

  /**
   * ROUND_RESOLVED — stores result, updates scores, advances round.
   * Transitions to 'result' phase, or 'finished' if FFA win condition met.
   */
  roundResolved(payload) {
    const results    = payload.results ?? {}
    const matchScore = payload.match_score ?? null

    set((state) => {
      // Update player scores (FFA mode only; tournament handled by matchFinished)
      const updatedPlayers = state.players.map(p => {
        const r = results[p.player_id]
        if (!r || payload.match_id) return p
        return r.outcome === 'WIN' ? { ...p, score: (p.score ?? 0) + 1 } : p
      })

      // Check FFA win condition
      const ffaWinner = !payload.match_id
        ? updatedPlayers.find(p => (p.score ?? 0) >= FFA_WINS_NEEDED)
        : null

      // Update match win counts in bracket for tournament
      let bracket = state.bracket
      if (matchScore && bracket) {
        bracket = {
          ...bracket,
          matches: bracket.matches.map(m => {
            if (m.match_id !== payload.match_id) return m
            return {
              ...m,
              player1_wins: matchScore[m.player1_id] ?? m.player1_wins,
              player2_wins: matchScore[m.player2_id] ?? m.player2_wins,
              current_match_round: payload.round_number + 1,
            }
          }),
        }
      }

      return {
        lastRoundResult:  payload,
        currentRound:     payload.round_number + 1,
        myMove:           null,
        waitingFor:       0,
        submittedPlayers: [],
        players:          updatedPlayers,
        bracket,
        gamePhase:   ffaWinner ? 'finished' : 'result',
        ffaWinnerId: ffaWinner?.player_id ?? state.ffaWinnerId,
      }
    })
  },

  /**
   * Clears the round result overlay.
   * If game is finished, keeps 'finished' phase so navigation triggers.
   */
  clearRoundResult() {
    set((state) => ({
      lastRoundResult: null,
      gamePhase: state.gamePhase === 'finished' ? 'finished' : 'selecting',
    }))
  },

  bracketUpdated(payload) {
    const b = payload.bracket ?? payload
    set((state) => {
      const merged = { ...(state.bracket ?? {}), ...b }
      const myMatch = _findMyMatch(merged, state.playerId)
      return { bracket: merged, myMatch }
    })
  },

  matchFinished(payload) {
    const { winner_id, loser_id, winner_name, match_id } = payload
    set((state) => {
      const isLoser = state.playerId === loser_id
      const bracket = state.bracket
        ? {
            ...state.bracket,
            matches: state.bracket.matches.map(m =>
              m.match_id === match_id
                ? { ...m, status: 'COMPLETE', winner_id }
                : m
            ),
          }
        : state.bracket

      return {
        bracket,
        myMatch:          null,
        eliminatedBy:     isLoser ? winner_name : state.eliminatedBy,
        currentRound:     1,
        myMove:           null,
        submittedPlayers: [],
        gamePhase:        'selecting',
      }
    })
  },

  tournamentRoundComplete(payload) {
    set((state) => {
      const b = payload.bracket ?? state.bracket
      const myMatch = _findMyMatch(b, state.playerId)
      return {
        bracket:          b,
        myMatch,
        currentRound:     1,
        myMove:           null,
        submittedPlayers: [],
        gamePhase:        'selecting',
      }
    })
  },

  championDeclared(payload) {
    set((state) => ({
      championId: payload.champion_id,
      session: state.session ? { ...state.session, status: 'FINISHED' } : state.session,
      gamePhase: 'finished',
    }))
  },

  gameFinished() {
    set((state) => ({
      session: state.session
        ? { ...state.session, status: 'FINISHED' }
        : state.session,
      gamePhase: 'finished',
    }))
  },

  setWsStatus(status) {
    set({ wsStatus: status })
  },

  reset() {
    set({
      sessionId:        null,
      session:          null,
      playerId:         null,
      isHost:           false,
      qrToken:          null,
      wsUrl:            null,
      players:          [],
      gamePhase:        'selecting',
      currentRound:     1,
      myMove:           null,
      waitingFor:       0,
      submittedPlayers: [],
      lastRoundResult:  null,
      ffaWinnerId:      null,
      bracket:          null,
      myMatch:          null,
      eliminatedBy:     null,
      championId:       null,
      wsStatus:         'disconnected',
    })
  },
}))

export default useGameStore
