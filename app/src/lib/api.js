import { API_URL } from './config.js'

/**
 * Low-level fetch wrapper.
 * - Injects Content-Type: application/json for non-GET requests.
 * - On success: returns response.data
 * - On error: throws Error with response.error message (or HTTP status text)
 */
async function request(method, path, body) {
  const url = `${API_URL}${path}`
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(url, options)
  } catch (networkErr) {
    throw new Error('No se pudo conectar con el servidor. Verifica tu conexión.')
  }

  let payload
  try {
    payload = await res.json()
  } catch {
    if (!res.ok) {
      throw new Error(`Error ${res.status}: ${res.statusText}`)
    }
    throw new Error('Respuesta inesperada del servidor.')
  }

  if (!res.ok) {
    // Surface the backend's error message when available
    const msg = payload?.error || payload?.message || `Error ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.payload = payload
    throw err
  }

  return payload.data
}

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * Create a new session (host).
 * @param {{ host_player_id: string, display_name: string, mode: 'FREE_FOR_ALL'|'TOURNAMENT', max_players: number }} body
 * @returns {{ session_id, qr_token, ws_url, join_url }}
 */
export function createSession(body) {
  return request('POST', '/sessions', body)
}

/**
 * Join an existing session as a player (guest via QR token).
 * @param {string} sessionId
 * @param {{ display_name: string, token: string }} body
 * @returns {{ player_id, session_id, display_name, ws_url }}
 */
export function joinSession(sessionId, body) {
  return request('POST', `/sessions/${sessionId}/players`, body)
}

/**
 * Get session details.
 * @param {string} sessionId
 * @returns {{ session_id, status, mode, current_round, max_players, host_player_id, created_at }}
 */
export function getSession(sessionId) {
  return request('GET', `/sessions/${sessionId}`)
}

/**
 * Get all players in a session.
 * @param {string} sessionId
 * @returns {{ players: Array, count: number }}
 */
export function getPlayers(sessionId) {
  return request('GET', `/sessions/${sessionId}/players`)
}

// ─── Game ─────────────────────────────────────────────────────────────────────

/**
 * Submit a move for the current round.
 * @param {string} sessionId
 * @param {{ player_id: string, move: 'ROCK'|'PAPER'|'SCISSORS', round_number: number }} body
 * @returns {{ accepted, round_number, waiting_for }}
 */
export function submitMove(sessionId, body) {
  return request('POST', `/sessions/${sessionId}/game/move`, body)
}

/**
 * Get resolved results for a specific round.
 * @param {string} sessionId
 * @param {number} roundNumber
 * @returns {{ round_number, winner_id, is_tie, results, resolved_at }}
 */
export function getRound(sessionId, roundNumber) {
  return request('GET', `/sessions/${sessionId}/game/round/${roundNumber}`)
}

// ─── Tournament ───────────────────────────────────────────────────────────────

/**
 * Create / initialize the tournament bracket (host only).
 * @param {string} sessionId
 * @returns {{ bracket: { size, total_rounds, current_round, matches } }}
 */
export function createBracket(sessionId) {
  return request('POST', `/sessions/${sessionId}/tournament/bracket`)
}

/**
 * Get current bracket state.
 * @param {string} sessionId
 * @returns {{ bracket: { size, total_rounds, current_round, matches, champion } }}
 */
export function getBracket(sessionId) {
  return request('GET', `/sessions/${sessionId}/tournament/bracket`)
}

/**
 * Advance bracket to next round (host only).
 * @param {string} sessionId
 * @returns {{ current_round, champion, new_matches }}
 */
export function advanceBracket(sessionId) {
  return request('PUT', `/sessions/${sessionId}/tournament/bracket/advance`)
}
