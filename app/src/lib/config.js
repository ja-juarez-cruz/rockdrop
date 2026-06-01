/**
 * Central config — reads env vars set in .env / .env.local
 * VITE_API_URL  e.g. https://xxx.execute-api.us-east-1.amazonaws.com/dev
 * VITE_WS_URL   e.g. wss://xxx.execute-api.us-east-1.amazonaws.com/dev
 *
 * In dev mode, API calls go through the Vite proxy at /api to avoid CORS.
 * In production the full URL is used directly (backend returns CORS headers).
 */

export const API_URL = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_URL || '')

export const WS_URL = import.meta.env.VITE_WS_URL || ''
