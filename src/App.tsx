import { Link, Outlet } from 'react-router-dom'
import { GameCanvas } from './components/GameCanvas'
import { StationSheet } from './components/StationSheet'
import { TrainDetailsSheet } from './components/TrainDetailsSheet'

function App() {
  return (
    <div className="flex h-screen w-screen flex-col bg-db-dark dark">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-db-gray-dark bg-db-dark px-4">
        <Link to="/" className="text-lg font-bold text-db-red">
          OpenSFS
        </Link>
        <nav className="flex gap-4 text-sm text-db-gray-light">
          <Link to="/org" className="rounded px-2 py-1 hover:bg-db-gray-dark/60">
            Org Dashboard
          </Link>
        </nav>
      </header>

      {/* Main Game Area */}
      <main className="relative flex-1">
        <GameCanvas />
        <Outlet />
      </main>

      {/* Footer/Status Bar */}
      <footer className="flex h-8 items-center justify-between border-t border-db-gray-dark bg-db-dark px-4 text-xs text-db-gray">
        <span>Ready</span>
        <span>Germany Railway Network</span>
      </footer>

      {/* Station Details Sheet */}
      <StationSheet />
      <TrainDetailsSheet />
    </div>
  )
}

export default App
