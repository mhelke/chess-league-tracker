import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GameLinksModal } from '../components/EarlyResignModal'
import {
    buildEarlyResignationHistory,
    buildEarlyResignationPlayers,
    filterEarlyResignationHistory,
} from '../utils/earlyResignUtils'

const PLAYERS_PER_PAGE = 20
const MATCHES_PER_PLAYER_PAGE = 5
const DATE_RANGE_OPTIONS = [
    { value: '7', label: '7 days' },
    { value: '14', label: '14 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
    { value: 'all', label: 'All' },
]

function chessMatchWebUrl(match) {
    if (match.matchWebUrl) return match.matchWebUrl

    const idMatch = String(match.matchUrl || '').match(/(?:\/match\/)?(\d+)\/?$/)
    return idMatch ? `https://www.chess.com/club/matches/${idMatch[1]}` : null
}

function formatRecordedDate(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Date unavailable'

    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

function PaginationControls({ currentPage, totalPages, onPageChange, label }) {
    if (totalPages <= 1) return null

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-gray-500">{label}</span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:border-chess-green hover:text-chess-green disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Go to previous page"
                >
                    Previous
                </button>
                <span className="whitespace-nowrap text-gray-600" aria-live="polite">
                    Page {currentPage} of {totalPages}
                </span>
                <button
                    type="button"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:border-chess-green hover:text-chess-green disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Go to next page"
                >
                    Next
                </button>
            </div>
        </div>
    )
}

function EarlyResignations() {
    const [leagueData, setLeagueData] = useState(null)
    const [earlyResignData, setEarlyResignData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [gameLinksFor, setGameLinksFor] = useState(null)
    const [expandedPlayers, setExpandedPlayers] = useState({})
    const [expandedPlayerPages, setExpandedPlayerPages] = useState({})
    const [currentPage, setCurrentPage] = useState(1)
    const [dateRange, setDateRange] = useState('90')

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(response => {
                if (!response.ok) throw new Error('Failed to load league data')
                return response.json()
            }),
            fetch('/data/earlyResignations.json')
                .then(response => response.ok ? response.json() : null)
                .catch(() => null),
        ])
            .then(([leagueJson, earlyResignJson]) => {
                setLeagueData(leagueJson)
                setEarlyResignData(earlyResignJson)
                setLoading(false)
            })
            .catch(err => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    const fullHistory = useMemo(
        () => buildEarlyResignationHistory(earlyResignData, leagueData),
        [earlyResignData, leagueData]
    )
    const history = useMemo(
        () => dateRange === 'all'
            ? fullHistory
            : filterEarlyResignationHistory(fullHistory, Number(dateRange)),
        [dateRange, fullHistory]
    )
    const playerHistory = useMemo(() => buildEarlyResignationPlayers(history), [history])
    const totalPages = Math.max(1, Math.ceil(playerHistory.players.length / PLAYERS_PER_PAGE))
    const page = Math.min(currentPage, totalPages)
    const pageStart = (page - 1) * PLAYERS_PER_PAGE
    const pagePlayers = playerHistory.players.slice(pageStart, pageStart + PLAYERS_PER_PAGE)

    useEffect(() => {
        setCurrentPage(current => Math.min(current, totalPages))
    }, [totalPages])

    useEffect(() => {
        setCurrentPage(1)
        setExpandedPlayers({})
        setExpandedPlayerPages({})
        setGameLinksFor(null)
    }, [dateRange])

    const togglePlayer = username => {
        setExpandedPlayers(current => ({
            ...current,
            [username]: !current[username],
        }))
    }

    const setPlayerMatchPage = (username, pageNumber) => {
        setExpandedPlayerPages(current => ({
            ...current,
            [username]: pageNumber,
        }))
    }

    if (loading) {
        return (
            <div className="page-container">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-chess-green mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading early resignation history...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="page-container">
                <div className="card bg-red-50 border border-red-200">
                    <h2 className="text-xl font-bold text-red-800 mb-2">Error</h2>
                    <p className="text-red-600">{error}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="page-container">
            <div className="mb-6">
                <Link to="/" className="text-chess-green hover:underline">
                    &larr; Admin Dashboard
                </Link>
            </div>

            <div className="mb-8">
                <h2 className="text-4xl font-bold text-chess-dark mb-2">Early Resignation History</h2>
                <p className="text-gray-600">
                    Review recorded early resignations by player and the matches and games where they occurred.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label htmlFor="early-resignation-date-range" className="text-sm font-medium text-gray-700">
                        Date range
                    </label>
                    <select
                        id="early-resignation-date-range"
                        value={dateRange}
                        onChange={event => setDateRange(event.target.value)}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-chess-green focus:outline-none focus:ring-1 focus:ring-chess-green"
                    >
                        {DATE_RANGE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                    {playerHistory.totalGames} early resignation{playerHistory.totalGames !== 1 ? 's' : ''} across {history.length} match{history.length !== 1 ? 'es' : ''} · {playerHistory.players.length} player{playerHistory.players.length !== 1 ? 's' : ''}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                    New records use the detector&apos;s first-seen date; legacy records use the match start date, then end date.
                </p>
            </div>

            {playerHistory.players.length === 0 ? (
                <div className="card border border-gray-200 bg-gray-50 text-center text-gray-600">
                    No early resignations have been recorded in the selected date range.
                </div>
            ) : (
                <div className="card divide-y divide-gray-200 p-0">
                    {pagePlayers.map(player => {
                        const isExpanded = Boolean(expandedPlayers[player.username])
                        const matchTotalPages = Math.max(1, Math.ceil(player.matches.length / MATCHES_PER_PLAYER_PAGE))
                        const matchPage = Math.min(expandedPlayerPages[player.username] || 1, matchTotalPages)
                        const matchPageStart = (matchPage - 1) * MATCHES_PER_PLAYER_PAGE
                        const pageMatches = player.matches.slice(matchPageStart, matchPageStart + MATCHES_PER_PLAYER_PAGE)

                        return (
                            <div key={player.username} className="p-4 transition-shadow sm:p-5">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <a
                                            href={`https://www.chess.com/member/${player.username}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="truncate text-base font-semibold text-chess-green hover:underline"
                                        >
                                            {player.username}
                                        </a>
                                        <p className="mt-1 text-sm text-gray-500">
                                            {player.totalGames} early resignation{player.totalGames !== 1 ? 's' : ''} across {player.matches.length} match{player.matches.length !== 1 ? 'es' : ''}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => togglePlayer(player.username)}
                                        aria-expanded={isExpanded}
                                        className="shrink-0 self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-chess-green hover:text-chess-green sm:self-auto"
                                    >
                                        {isExpanded ? 'Hide matches' : 'View matches'}
                                    </button>
                                </div>

                                {isExpanded && (
                                    <div className="mt-4 border-t border-gray-100 pt-4">
                                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                            {pageMatches.map(match => (
                                                <div
                                                    key={`${match.matchUrl}-${match.subLeagueName}`}
                                                    className="rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <a
                                                            href={chessMatchWebUrl(match) || '#'}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-chess-green hover:underline"
                                                        >
                                                            {match.name}
                                                        </a>
                                                        <button
                                                            type="button"
                                                            onClick={() => setGameLinksFor({ username: player.username, games: match.games })}
                                                            className="shrink-0 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                                                        >
                                                            {match.totalGames} game{match.totalGames !== 1 ? 's' : ''}
                                                        </button>
                                                    </div>
                                                    <div className="mt-1 truncate text-xs text-gray-500">{match.leagueName} · {match.subLeagueName}</div>
                                                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                                                        <span>{match.totalGames} early resignation{match.totalGames !== 1 ? 's' : ''}</span>
                                                        <span>Recorded {formatRecordedDate(match.latestDetectedAt)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-3">
                                            <PaginationControls
                                                currentPage={matchPage}
                                                totalPages={matchTotalPages}
                                                onPageChange={pageNumber => setPlayerMatchPage(player.username, pageNumber)}
                                                label={`Showing ${matchPageStart + 1}-${Math.min(matchPageStart + MATCHES_PER_PLAYER_PAGE, player.matches.length)} of ${player.matches.length} matches`}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {playerHistory.players.length > 0 && (
                <div className="mt-4">
                    <PaginationControls
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        label={`Showing ${pageStart + 1}-${Math.min(pageStart + PLAYERS_PER_PAGE, playerHistory.players.length)} of ${playerHistory.players.length} players`}
                    />
                </div>
            )}

            <GameLinksModal
                isOpen={Boolean(gameLinksFor)}
                onClose={() => setGameLinksFor(null)}
                username={gameLinksFor?.username}
                games={gameLinksFor?.games || []}
            />
        </div>
    )
}

export default EarlyResignations
