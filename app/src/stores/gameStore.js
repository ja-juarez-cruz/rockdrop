import { create } from 'zustand'

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
  currentRound: 0,
  myMove: null,
  waitingFor: 0,
  lastRoundResult: null,

  // ── Tournament ────────────────────────────────────────────────────────────
  bracket: null,

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
    set({ waitingFor: payload.waiting_for })
  },

  /**
   * ROUND_RESOLVED — store round result, update leaderboard, advance round.
   * @param {{ round_number, winner_id, is_tie, results, leaderboard }} payload
   */
  roundResolved(payload) {
    // Merge leaderboard scores into players list
    const leaderboard = payload.leaderboard ?? []
    set((state) => {
      const updatedPlayers = state.players.map(p => {
        const entry = leaderboard.find(e => e.player_id === p.player_id)
        return entry ? { ...p, score: entry.score } : p
      })
      return {
        lastRoundResult: payload,
        currentRound:    payload.round_number + 1,
        myMove:          null,
        waitingFor:      0,
        players:         updatedPlayers,
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
    set((state) => ({
      bracket: { ...(state.bracket ?? {}), ...payload.bracket },
    }))
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
      sessionId:       null,
      session:         null,
      playerId:        null,
      isHost:          false,
      qrToken:         null,
      wsUrl:           null,
      players:         [],
      currentRound:    0,
      myMove:          null,
      waitingFor:      0,
      lastRoundResult: null,
      bracket:         null,
      wsStatus:        'disconnected',
    })
  },
}))

export default useGameStore
