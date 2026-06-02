import { HashRouter as BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import useGameStore from './stores/gameStore.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import JoinPage       from './pages/JoinPage.jsx'
import HostPage       from './pages/HostPage.jsx'
import LobbyPage      from './pages/LobbyPage.jsx'
import GamePage       from './pages/GamePage.jsx'
import TournamentPage from './pages/TournamentPage.jsx'
import FinishedPage   from './pages/FinishedPage.jsx'

/**
 * SessionWebSocket — singleton WS connection for the active session.
 *
 * Lives at App level so it persists across page navigation (Lobby → Game).
 * Destroying/recreating the WS on each page transition caused a race condition
 * where the backend counted fewer connected players and resolved rounds early.
 */
function SessionWebSocket() {
  const wsUrl     = useGameStore(s => s.wsUrl)
  const sessionId = useGameStore(s => s.sessionId)
  const playerId  = useGameStore(s => s.playerId)
  useWebSocket(wsUrl, sessionId, playerId)
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionWebSocket />
      <Routes>
        <Route path="/"              element={<Navigate to="/host" replace />} />
        <Route path="/host"          element={<HostPage />} />
        <Route path="/join"          element={<JoinPage />} />
        <Route path="/lobby/:sessionId"      element={<LobbyPage />} />
        <Route path="/game/:sessionId"       element={<GamePage />} />
        <Route path="/tournament/:sessionId" element={<TournamentPage />} />
        <Route path="/finished/:sessionId"   element={<FinishedPage />} />
        <Route path="*"              element={<Navigate to="/host" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
