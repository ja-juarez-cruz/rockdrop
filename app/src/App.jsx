import { HashRouter as BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import JoinPage from './pages/JoinPage.jsx'
import HostPage from './pages/HostPage.jsx'
import LobbyPage from './pages/LobbyPage.jsx'
import GamePage from './pages/GamePage.jsx'
import TournamentPage from './pages/TournamentPage.jsx'
import FinishedPage from './pages/FinishedPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/host" replace />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/lobby/:sessionId" element={<LobbyPage />} />
        <Route path="/game/:sessionId" element={<GamePage />} />
        <Route path="/tournament/:sessionId" element={<TournamentPage />} />
        <Route path="/finished/:sessionId" element={<FinishedPage />} />
        <Route path="*" element={<Navigate to="/host" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
