import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { buildTimeoutHistory, filterTimeoutHistory } from '../utils/timeoutHistoryUtils'

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

    const idMatch = String(match.matchId || match.matchUrl || '').match(/(?:\/match\/)?(\d+)\/?$/)
    return idMatch ? `https://www.chess.com/club/matches/${idMatch[1]}` : null
}

function formatMatchActivityDate(match) {
    const recordedTimestamp = Number(match.detectedAt)
    if (Number.isFinite(recordedTimestamp) && recordedTimestamp > 0) {
        const date = new Date(recordedTimestamp * 1000).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
        return `Timeout recorded ${date}`
    }

    const timestamp = Number(match.endTime || match.startTime)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Match date unavailable'

    const date = new Date(timestamp * 1000).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
    return match.endTime ? `Match completed ${date}` : `Match started ${date}`
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

function TimeoutHistory() {
    const [data, setData] = useState(null)
    const [timeoutHistoryData, setTimeoutHistoryData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [expandedPlayers, setExpandedPlayers] = useState({})
    const [expandedPlayerPages, setExpandedPlayerPages] = useState({})
    const [currentPage, setCurrentPage] = useState(1)
    const [highlightedPlayer, setHighlightedPlayer] = useState(null)
    const [dateRange, setDateRange] = useState('90')
    const [searchParams] = useSearchParams()
    const targetUsername = (searchParams.get('player') || '').trim().toLowerCase()

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(response => {
                if (!response.ok) throw new Error('Failed to load league data')
                return response.json()
            }),
            fetch('/data/timeout_history.json')
                .then(response => response.ok ? response.json() : null)
                .catch(() => null),
        ])
            .then(([leagueData, timeoutHistoryJson]) => {
                setData(leagueData)
                setTimeoutHistoryData(timeoutHistoryJson)
                setLoading(false)
            })
            .catch(err => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    const history = useMemo(() => {
        const fullHistory = buildTimeoutHistory(data)
        return filterTimeoutHistory(fullHistory, timeoutHistoryData, dateRange)
    }, [data, dateRange, timeoutHistoryData])
    const totalPages = Math.max(1, Math.ceil(history.players.length / PLAYERS_PER_PAGE))
    const page = Math.min(currentPage, totalPages)
    const pageStart = (page - 1) * PLAYERS_PER_PAGE
    const pagePlayers = history.players.slice(pageStart, pageStart + PLAYERS_PER_PAGE)
    const targetPlayerIndex = history.players.findIndex(player => player.username.toLowerCase() === targetUsername)
    const targetPage = targetPlayerIndex >= 0
        ? Math.floor(targetPlayerIndex / PLAYERS_PER_PAGE) + 1
        : null

    useEffect(() => {
        setCurrentPage(current => Math.min(current, totalPages))
    }, [totalPages])

    useEffect(() => {
        setCurrentPage(1)
        setExpandedPlayers({})
        setExpandedPlayerPages({})
        setHighlightedPlayer(null)
    }, [dateRange])

    useEffect(() => {
        if (!targetUsername || targetPlayerIndex < 0 || targetPage === null) return undefined

        const targetPlayer = history.players[targetPlayerIndex]
        setCurrentPage(targetPage)
        setExpandedPlayers(current => ({ ...current, [targetPlayer.username]: true }))
        setExpandedPlayerPages(current => ({ ...current, [targetPlayer.username]: 1 }))
        return undefined
    }, [history.players, targetPage, targetPlayerIndex, targetUsername])

    useEffect(() => {
        if (!targetUsername || targetPlayerIndex < 0 || targetPage === null || page !== targetPage) return undefined

        let highlightTimer
        const scrollTimer = window.setTimeout(() => {
            const targetPlayer = history.players[targetPlayerIndex]
            const targetElement = document.getElementById(`timeout-player-${encodeURIComponent(targetPlayer.username)}`)
            if (!targetElement) return

            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setHighlightedPlayer(targetPlayer.username)
            highlightTimer = window.setTimeout(() => setHighlightedPlayer(null), 3500)
        }, 50)

        return () => {
            window.clearTimeout(scrollTimer)
            if (highlightTimer) window.clearTimeout(highlightTimer)
        }
    }, [history.players, page, targetPage, targetPlayerIndex, targetUsername])

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
                    <p className="mt-4 text-gray-600">Loading timeout history...</p>
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
                <h2 className="text-4xl font-bold text-chess-dark mb-2">Timeout History</h2>
                <p className="text-gray-600">
                    Review recorded timeouts by player and the matches where they occurred.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label htmlFor="timeout-date-range" className="text-sm font-medium text-gray-700">
                        Date range
                    </label>
                    <select
                        id="timeout-date-range"
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
                    {history.totalTimeouts} timeout{history.totalTimeouts !== 1 ? 's' : ''} across {history.matches.length} match{history.matches.length !== 1 ? 'es' : ''} · {history.players.length} player{history.players.length !== 1 ? 's' : ''}
                </p>
            </div>

            {history.players.length === 0 ? (
                <div className="card border border-gray-200 bg-gray-50 text-center text-gray-600">
                    No timeouts have been recorded in the selected date range.
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
                            <div
                                key={player.username}
                                id={`timeout-player-${encodeURIComponent(player.username)}`}
                                className={`scroll-mt-[16vh] sm:scroll-mt-[22vh] p-4 transition-shadow sm:p-5 ${highlightedPlayer === player.username ? 'ring-2 ring-chess-green ring-inset' : ''}`}
                            >
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
                                            {player.totalTimeouts} timeout{player.totalTimeouts !== 1 ? 's' : ''} across {player.matches.length} match{player.matches.length !== 1 ? 'es' : ''}
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
                                            <a
                                                key={`${match.matchId}-${match.subLeagueName}`}
                                                href={chessMatchWebUrl(match) || '#'}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                            >
                                                <div className="truncate text-sm font-medium text-gray-900">{match.name}</div>
                                                <div className="mt-1 truncate text-xs text-gray-500">{match.leagueName} · {match.subLeagueName}</div>
                                                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                                                    <span>{match.timeouts} timeout{match.timeouts !== 1 ? 's' : ''}</span>
                                                    <span>{formatMatchActivityDate(match)}</span>
                                                </div>
                                            </a>
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

            {history.players.length > 0 && (
                <div className="mt-4">
                    <PaginationControls
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        label={`Showing ${pageStart + 1}-${Math.min(pageStart + PLAYERS_PER_PAGE, history.players.length)} of ${history.players.length} players`}
                    />
                </div>
            )}
        </div>
    )
}

export default TimeoutHistory
