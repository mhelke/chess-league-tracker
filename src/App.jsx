import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home'
import LeagueView from './pages/LeagueView'
import SubLeagueView from './pages/SubLeagueView'
import GlobalLeaderboard from './pages/GlobalLeaderboard'
import AllMatches from './pages/AllMatches'
import NotFound from './pages/NotFound'

function App() {
    return (
        <Router basename="/">
            <div className="min-h-screen bg-gray-50">
                {/* Header */}
                <header className="bg-chess-dark text-white shadow-lg">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                        <div className="flex items-center justify-between">
                            <Link to="/" className="flex items-center space-x-3">
                                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M19 22H5v-2h14v2M17.16 8.26A8.92 8.92 0 0 0 12 6.5a8.92 8.92 0 0 0-5.16 1.76l-2.59-2.59C6.42 3.47 9.13 2.5 12 2.5s5.58.97 7.75 3.17l-2.59 2.59M12 10c1.87 0 3.61.65 5 1.73l-2.59 2.59A4.936 4.936 0 0 0 12 13.5c-.87 0-1.69.23-2.41.82l-2.59-2.59A6.935 6.935 0 0 1 12 10m0 5a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2z" />
                                </svg>
                                <div>
                                    <h1 className="text-2xl font-bold">Chess League Tracker</h1>
                                    <p className="text-sm text-gray-300">1 Day Per Move Club</p>
                                </div>
                            </Link>
                            <nav className="flex space-x-4">
                                <Link to="/" className="hover:text-chess-light transition-colors">
                                    Leagues
                                </Link>
                                <Link to="/matches" className="hover:text-chess-light transition-colors">
                                    All Matches
                                </Link>
                                <Link to="/global" className="hover:text-chess-light transition-colors">
                                    Global Leaderboard
                                </Link>
                            </nav>
                        </div>
                    </div>
                </header>

                {/* BETA Warning */}
                <div className="bg-yellow-50 border-b border-yellow-200">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
                        <div className="flex items-center justify-center space-x-2 text-yellow-800">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <span className="font-semibold">BETA</span>
                            <span className="text-sm">This site is in beta. Data may be incomplete or unreliable.</span>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <main>
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/matches" element={<AllMatches />} />
                        <Route path="/league/:leagueName" element={<LeagueView />} />
                        <Route path="/league/:leagueName/:subLeagueName" element={<SubLeagueView />} />
                        <Route path="/global" element={<GlobalLeaderboard />} />
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </main>

                {/* Footer */}
                <footer className="bg-chess-dark text-white mt-12">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                        <div className="text-center text-sm text-gray-300">
                            <p>Data from <a href="https://www.chess.com" target="_blank" rel="noopener noreferrer" className="hover:text-chess-light">Chess.com</a> API</p>
                            <p className="mt-2">Updated daily</p>
                            <p className="mt-4 text-xs text-gray-400">
                                © {new Date().getFullYear()} <a href="https://helkelabs.com" target="_blank" rel="noopener noreferrer" className="hover:text-chess-light">Helke Labs</a>. Released under the <a href="https://github.com/mhelke/chess-league-tracker/blob/master/LICENSE" target="_blank" rel="noopener noreferrer" className="hover:text-chess-light">MIT License</a>.
                            </p>
                        </div>
                    </div>
                </footer>
            </div>
        </Router>
    )
}

export default App
