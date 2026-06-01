import { create } from 'zustand'

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
 * Shape:
 *   session      — { session_id, status, mode, current_round, max_players, host_player_id }
 *   players      — array of { player_id, display_name, is_host, score, status }
 *   game         — currentRound, myMove, waitingFor, lastRoundResult
 *   tournament   — bracket
 *   ws           — wsStatus
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
  currentRound: 1,
  myMove: null,
  waitingFor: 0,
  submittedPlayers: [],   // player_ids que ya tiraron esta ronda
  lastRoundResult: null,

  // ── Tournament ────────────────────────────────────────────────────────────
  bracket:          null,
  myMatch:          null,   // match actual del jugador
  eliminatedBy:     null,   // display_name del jugador que eliminó
  championId:       null,

  // ── WebSocket ─────────────────────────────────────────────────────────────
  wsStatus: 'disconnected',

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Called after successfully joining or creating a session.
   * @param {{ player_id, session_id, display_name, ws_url, is_host?, qr_token? }} data
   */
  setPlayer(data) {
    set({
      playerId:  data.player_id,
      sessionId: data.session_id,
      wsUrl:     data.ws_url,
      isHost:    data.is_host ?? false,
      qrToken:   data.qr_token ?? null,
    })
  },

  /**
   * Overwrite full session object (from GET /sessions/:id).
   * Also syncs currentRound with session.current_round.
   * @param {Object} session
   */
  setSession(session) {
    set({
      session,
      sessionId:    session.session_id,
      currentRound: session.current_round ?? get().currentRound,
    })
  },

  /**
   * Replace full player list (from GET /sessions/:id/players).
   * @param {Array} players
   */
  setPlayers(players) {
    set({ players })
  },

  // ── WS event handlers ─────────────────────────────────────────────────────

  /**
   * PLAYER_JOINED — add or update player in list.
   * @param {{ player_id, display_name, total_players }} payload
   */
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

  /**
   * PLAYER_DISCONNECTED — mark player as disconnected in list.
   * @param {{ player_id, display_name }} payload
   */
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
   * Track the move the current client has submitted for this round.
   * @param {'ROCK'|'PAPER'|'SCISSORS'} move
   */
  setMyMove(move) {
    set({ myMove: move })
  },

  /**
   * MOVE_SUBMITTED — update waiting count.
   * @param {{ player_id, round_number, submitted_count, waiting_for }} payload
   */
  moveSubmitted(payload) {
    set((state) => ({
      waitingFor: payload.waiting_for,
      submittedPlayers: payload.player_id
        ? [...new Set([...state.submittedPlayers, payload.player_id])]
        : state.submittedPlayers,
    }))
  },

  /**
   * ROUND_RESOLVED — store round result, update leaderboard, advance round.
   * @param {{ round_number, winner_id, is_tie, results, leaderboard }} payload
   */
  roundResolved(payload) {
    const results    = payload.results ?? {}
    const matchScore = payload.match_score ?? null

    set((state) => {
      // Update player scores (FFA mode)
      const updatedPlayers = state.players.map(p => {
        const r = results[p.player_id]
        if (!r || payload.match_id) return p  // tournament scores handled by matchFinished
        return r.outcome === 'WIN' ? { ...p, score: (p.score ?? 0) + 1 } : p
      })

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
      }
    })
  },

  /**
   * Clear lastRoundResult (after overlay has been shown).
   */
  clearRoundResult() {
    set({ lastRoundResult: null })
  },

  /**
   * BRACKET_UPDATED — merge new bracket data.
   * @param {{ bracket }} payload
   */
  bracketUpdated(payload) {
    const b = payload.bracket ?? payload
    set((state) => {
      const merged = { ...(state.bracket ?? {}), ...b }
      const myMatch = _findMyMatch(merged, state.playerId)
      return { bracket: merged, myMatch }
    })
  },

  matchFinished(payload) {
    const { winner_id, loser_id, winner_name, loser_name, match_id } = payload
    set((state) => {
      const isLoser   = state.playerId === loser_id
      const bracket   = state.bracket
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
        myMatch:      null,
        eliminatedBy: isLoser ? winner_name : state.eliminatedBy,
        currentRound: 1,
        myMove:       null,
        submittedPlayers: [],
      }
    })
  },

  tournamentRoundComplete(payload) {
    set((state) => {
      const b = payload.bracket ?? state.bracket
      const myMatch = _findMyMatch(b, state.playerId)
      return {
        bracket:      b,
        myMatch,
        currentRound: 1,
        myMove:       null,
        submittedPlayers: [],
      }
    })
  },

  championDeclared(payload) {
    set({ championId: payload.champion_id })
  },

  /**
   * GAME_FINISHED — mark session as finished.
   * @param {{ session_id, reason }} payload
   */
  gameFinished(payload) {
    set((state) => ({
      session: state.session
        ? { ...state.session, status: 'FINISHED' }
        : state.session,
    }))
  },

  /**
   * Update WebSocket connection status.
   * @param {'connecting'|'connected'|'disconnected'|'error'} status
   */
  setWsStatus(status) {
    set({ wsStatus: status })
  },

  /**
   * Full reset — used when leaving a session.
   */
  reset() {
    set({
      sessionId:        null,
      session:          null,
      playerId:         null,
      isHost:           false,
      qrToken:          null,
      wsUrl:            null,
      players:          [],
      currentRound:     1,
      myMove:           null,
      waitingFor:       0,
      submittedPlayers: [],
      lastRoundResult:  null,
      bracket:          null,
      wsStatus:         'disconnected',
    })
  },
}))

export default useGameStore
