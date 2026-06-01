/**
 * WebSocketManager
 *
 * Manages a single WebSocket connection with:
 * - Exponential back-off reconnect (max 5 retries)
 * - Message routing via registered handlers
 * - Clean teardown via .destroy()
 *
 * Usage:
 *   const ws = new WebSocketManager(url, handlers, onStatusChange)
 *   ws.send({ type: 'PING' })
 *   ws.destroy()
 */

const MAX_RETRIES = 5
const BASE_DELAY_MS = 1000

export class WebSocketManager {
  /**
   * @param {string} url          Full WS URL including query params
   * @param {Object} handlers     Map of event_type → handler(payload)
   * @param {Function} onStatus   Called with 'connecting'|'connected'|'disconnected'|'error'
   */
  constructor(url, handlers = {}, onStatus = () => {}) {
    this._url = url
    this._handlers = handlers
    this._onStatus = onStatus
    this._retries = 0
    this._destroyed = false
    this._retryTimer = null
    this._socket = null

    this._connect()
  }

  _connect() {
    if (this._destroyed) return

    this._onStatus('connecting')

    try {
      this._socket = new WebSocket(this._url)
    } catch (err) {
      this._scheduleReconnect()
      return
    }

    this._socket.onopen = () => {
      this._retries = 0
      this._onStatus('connected')
    }

    this._socket.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        console.warn('[WS] Non-JSON message received:', event.data)
        return
      }

      const { type, ...payload } = msg
      if (!type) {
        console.warn('[WS] Message without type field:', msg)
        return
      }

      const handler = this._handlers[type]
      if (handler) {
        handler(payload)
      } else {
        // Silently ignore unknown event types — forward-compat
      }
    }

    this._socket.onerror = () => {
      // onerror always fires before onclose; log only, reconnect on close
      this._onStatus('error')
    }

    this._socket.onclose = (event) => {
      if (this._destroyed) {
        this._onStatus('disconnected')
        return
      }
      // 1000 = normal closure (server asked us to disconnect)
      if (event.code === 1000) {
        this._onStatus('disconnected')
        return
      }
      this._scheduleReconnect()
    }
  }

  _scheduleReconnect() {
    if (this._destroyed) return
    if (this._retries >= MAX_RETRIES) {
      console.error('[WS] Max retries reached. Giving up.')
      this._onStatus('error')
      return
    }

    const delay = BASE_DELAY_MS * Math.pow(2, this._retries)
    this._retries += 1
    console.info(`[WS] Reconnecting in ${delay}ms (attempt ${this._retries}/${MAX_RETRIES})`)

    this._retryTimer = setTimeout(() => {
      this._connect()
    }, delay)
  }

  /**
   * Send a JSON payload to the server.
   * @param {Object} data
   */
  send(data) {
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(data))
    } else {
      console.warn('[WS] send() called while socket is not open')
    }
  }

  /**
   * Register or replace a handler for a given event type.
   * @param {string} type
   * @param {Function} handler
   */
  on(type, handler) {
    this._handlers[type] = handler
  }

  /**
   * Close connection and prevent any further reconnect attempts.
   */
  destroy() {
    this._destroyed = true
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    if (this._socket) {
      this._socket.onopen = null
      this._socket.onmessage = null
      this._socket.onerror = null
      this._socket.onclose = null
      this._socket.close(1000, 'Component unmounted')
      this._socket = null
    }
  }
}
