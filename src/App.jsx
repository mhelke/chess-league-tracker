import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Home from './pages/Home'
import LeagueView from './pages/LeagueView'
import SubLeagueView from './pages/SubLeagueView'
import GlobalLeaderboard from './pages/GlobalLeaderboard'
import AllMatches from './pages/AllMatches'
import NotFound from './pages/NotFound'

const SITE_NAMES = {
    '1dpmc': '1 Day Per Move Club',
    'teamusa': 'Team USA'
}

const MEMBER_CLUB_IDS = {
    '1dpmc': '1dpmc',
    'teamusa': 'tusa'
}

const CLUB_API_IDS = {
    '1dpmc': '1-day-per-move-club',
    'teamusa': 'team-usa'
}

const NAV_LINKS = [
    { to: '/', label: 'Leagues' },
    { to: '/matches', label: 'All Matches' },
    { to: '/global', label: 'Global Leaderboard' },
]

function NavLink({ to, label, onClick }) {
    const location = useLocation()
    const active = location.pathname === to
    return (
        <Link
            to={to}
            onClick={onClick}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors hover:text-chess-light hover:bg-white/10 ${active ? 'text-chess-light' : ''}`}
        >
            {label}
        </Link>
    )
}

function App() {
    const siteName = SITE_NAMES[__SITE_KEY__] || 'Chess League Tracker'
    const [menuOpen, setMenuOpen] = useState(false)
    const [clubIcon, setClubIcon] = useState(null)

    useEffect(() => {
        const apiId = CLUB_API_IDS[__SITE_KEY__]
        if (!apiId) return
        fetch(`https://api.chess.com/pub/club/${apiId}`)
            .then(r => r.json())
            .then(data => { if (data?.icon) setClubIcon(data.icon) })
            .catch(() => { })
    }, [])

    return (
        <Router basename="/">
            <div className="min-h-screen bg-gray-50">
                {/* Header */}
                <header className="bg-chess-dark text-white shadow-lg">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                        <div className="flex items-center justify-between">
                            <Link to="/" className="flex items-center space-x-3" onClick={() => setMenuOpen(false)}>
                                {clubIcon ? (
                                    <img
                                        src={clubIcon}
                                        alt={siteName}
                                        className="w-10 h-10 rounded-full object-cover flex-shrink-0 ring-2 ring-white/30"
                                    />
                                ) : (
                                    <svg className="w-10 h-10 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M19 22H5v-2h14v2M17.16 8.26A8.92 8.92 0 0 0 12 6.5a8.92 8.92 0 0 0-5.16 1.76l-2.59-2.59C6.42 3.47 9.13 2.5 12 2.5s5.58.97 7.75 3.17l-2.59 2.59M12 10c1.87 0 3.61.65 5 1.73l-2.59 2.59A4.936 4.936 0 0 0 12 13.5c-.87 0-1.69.23-2.41.82l-2.59-2.59A6.935 6.935 0 0 1 12 10m0 5a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2z" />
                                    </svg>
                                )}
                                <div>
                                    <h1 className="text-xl sm:text-2xl font-bold leading-tight">Chess League Tracker</h1>
                                    <p className="text-xs sm:text-sm text-gray-300">{siteName}</p>
                                </div>
                            </Link>

                            {/* Desktop nav */}
                            <nav className="hidden sm:flex items-center space-x-1">
                                {NAV_LINKS.map(l => <NavLink key={l.to} {...l} />)}
                                <a
                                    href={`https://www.chessteamdata.com/members?clubid=${MEMBER_CLUB_IDS[__SITE_KEY__] || __SITE_KEY__}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block px-3 py-2 rounded-md text-sm font-medium transition-colors hover:text-chess-light hover:bg-white/10"
                                >
                                    Member Details ↗
                                </a>
                            </nav>

                            {/* Hamburger button — mobile only */}
                            <button
                                className="sm:hidden p-2 rounded-md hover:bg-white/10 transition-colors"
                                onClick={() => setMenuOpen(o => !o)}
                                aria-label="Toggle menu"
                                aria-expanded={menuOpen}
                            >
                                {menuOpen ? (
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                ) : (
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                                    </svg>
                                )}
                            </button>
                        </div>

                        {/* Mobile dropdown */}
                        {menuOpen && (
                            <nav className="sm:hidden mt-2 pb-1 border-t border-white/20 pt-2 flex flex-col gap-0.5">
                                {NAV_LINKS.map(l => <NavLink key={l.to} {...l} onClick={() => setMenuOpen(false)} />)}
                                <a
                                    href={`https://www.chessteamdata.com/members?clubid=${MEMBER_CLUB_IDS[__SITE_KEY__] || __SITE_KEY__}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setMenuOpen(false)}
                                    className="block px-3 py-2 rounded-md text-sm font-medium transition-colors hover:text-chess-light hover:bg-white/10"
                                >
                                    Member Details ↗
                                </a>
                            </nav>
                        )}
                    </div>
                </header>

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
                            <p className="mt-2">Questions? Email <a href="mailto:chess@helkelabs.com" className="hover:text-chess-light">chess@helkelabs.com</a> or reach out to <a href="https://www.chess.com/member/MasterMatthew52" target="_blank" rel="noopener noreferrer" className="hover:text-chess-light">MasterMatthew52</a> on Chess.com</p>
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
