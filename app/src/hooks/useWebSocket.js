import { useEffect, useRef, useCallback } from 'react'
import { WebSocketManager } from '../lib/ws.js'
import useGameStore from '../stores/gameStore.js'

/**
 * useWebSocket
 *
 * Creates a WebSocket connection to `wsUrl?session_id=X&player_id=Y`.
 * Dispatches incoming events to the Zustand store.
 * Cleans up on unmount.
 *
 * @param {string|null} wsUrl       Base WS URL (from store.wsUrl)
 * @param {string|null} sessionId   Session identifier
 * @param {string|null} playerId    Player identifier
 * @returns {{ status: string, send: Function }}
 */
export function useWebSocket(wsUrl, sessionId, playerId) {
  const wsRef = useRef(null)

  const {
    setWsStatus,
    playerJoined,
    playerDisconnected,
    moveSubmitted,
    roundResolved,
    bracketUpdated,
    matchFinished,
    tournamentRoundComplete,
    championDeclared,
    gameFinished,
    setSession,
  } = useGameStore()

  // Stable send function
  const send = useCallback((data) => {
    wsRef.current?.send(data)
  }, [])

  useEffect(() => {
    if (!wsUrl || !sessionId || !playerId) return

    const url = `${wsUrl}?session_id=${encodeURIComponent(sessionId)}&player_id=${encodeURIComponent(playerId)}`

    const handlers = {
      PLAYER_JOINED(payload) {
        playerJoined(payload)
      },
      PLAYER_DISCONNECTED(payload) {
        playerDisconnected(payload)
      },
      MOVE_SUBMITTED(payload) {
        moveSubmitted(payload)
      },
      ROUND_RESOLVED(payload) {
        roundResolved(payload)
      },
      BRACKET_UPDATED(payload) {
        bracketUpdated(payload)
      },
      MATCH_FINISHED(payload) {
        matchFinished(payload)
      },
      TOURNAMENT_ROUND_COMPLETE(payload) {
        tournamentRoundComplete(payload)
      },
      CHAMPION_DECLARED(payload) {
        championDeclared(payload)
      },
      GAME_FINISHED(payload) {
        gameFinished(payload)
      },
      // Some backends emit a GAME_STARTED event with the session object
      GAME_STARTED(payload) {
        if (payload.session) {
          setSession(payload.session)
        } else {
          // Minimal update so pages can react to status change
          const current = useGameStore.getState().session
          if (current) {
            setSession({ ...current, status: 'PLAYING' })
          }
        }
      },
      SESSION_UPDATED(payload) {
        if (payload.session) {
          setSession(payload.session)
        }
      },
    }

    const manager = new WebSocketManager(url, handlers, setWsStatus)
    wsRef.current = manager

    return () => {
      manager.destroy()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, sessionId, playerId])

  const wsStatus = useGameStore((s) => s.wsStatus)

  return { status: wsStatus, send }
}
