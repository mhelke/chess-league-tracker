import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'

const STATUS_FILTERS = [
    { key: 'open', label: 'Open', color: 'text-green-700', activeColor: 'bg-green-50 border-green-200' },
    { key: 'in_progress', label: 'In progress', color: 'text-blue-700', activeColor: 'bg-blue-50 border-blue-200' },
    { key: 'finished', label: 'Finished', color: 'text-gray-700', activeColor: 'bg-gray-50 border-gray-200' },
]

function LeagueView() {
    const { leagueName } = useParams()
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [subLeagueSearch, setSubLeagueSearch] = useState('')
    const [visibleStatuses, setVisibleStatuses] = useState({
        open: true,
        in_progress: true,
        finished: true,
    })
    const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)

    useEffect(() => {
        fetch('/data/leagueData.json')
            .then(response => response.json())
            .then(data => {
                setData(data)
                setLoading(false)
            })
            .catch(err => {
                console.error('Error loading data:', err)
                setLoading(false)
            })
    }, [])

    useEffect(() => {
        setVisibleStatuses({ open: true, in_progress: true, finished: true })
        setDiagnosticsCopied(false)
    }, [leagueName])

    if (loading) {
        return (
            <div className="page-container">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-chess-green mx-auto"></div>
                </div>
            </div>
        )
    }

    const league = data?.leagues?.[leagueName]

    if (!league) {
        return (
            <div className="page-container">
                <div className="card">
                    <h2 className="text-xl font-bold mb-2">League Not Found</h2>
                    <Link to="/" className="text-chess-green hover:underline">
                        ← Back to all leagues
                    </Link>
                </div>
            </div>
        )
    }

    const getSubLeagueStats = (subLeagueData) => {
        let statusCounts = { open: 0, in_progress: 0, finished: 0 }
        subLeagueData.rounds.forEach(round => {
            statusCounts[round.status]++
        })
        return statusCounts
    }

    const sortSubLeagues = (entries) => {
        return [...entries].sort(([, a], [, b]) => {
            const getCategory = (subLeagueData) => {
                const rounds = subLeagueData.rounds
                if (rounds.some(r => r.status === 'open')) return 0
                if (rounds.some(r => r.status === 'in_progress')) return 1
                return 2
            }

            const catA = getCategory(a)
            const catB = getCategory(b)

            if (catA !== catB) return catA - catB

            // Sort by date descending
            if (catA === 1) {
                // in_progress: latest startTime descending
                const latestA = Math.max(...a.rounds.filter(r => r.status === 'in_progress').map(r => r.startTime || 0))
                const latestB = Math.max(...b.rounds.filter(r => r.status === 'in_progress').map(r => r.startTime || 0))
                return latestB - latestA
            }
            if (catA === 2) {
                // finished: latest endTime descending
                const latestA = Math.max(...a.rounds.filter(r => r.status === 'finished').map(r => r.endTime || 0))
                const latestB = Math.max(...b.rounds.filter(r => r.status === 'finished').map(r => r.endTime || 0))
                return latestB - latestA
            }
            return 0
        })
    }

    const normalizedSubLeagueSearch = subLeagueSearch.trim().toLowerCase()
    const subLeagueEntries = Object.entries(league.subLeagues || {})
    const diagnosticEntries = subLeagueEntries.map(([subLeagueName, subLeagueData]) => {
        const diagnostics = subLeagueData.diagnostics || {}
        return {
            subLeagueName,
            mergedFrom: Array.isArray(diagnostics.mergedFrom) ? diagnostics.mergedFrom : [],
            dateResolvedMatches: Array.isArray(diagnostics.dateResolvedMatches) ? diagnostics.dateResolvedMatches : [],
            ambiguousMatches: Array.isArray(diagnostics.ambiguousMatches) ? diagnostics.ambiguousMatches : [],
            missingRounds: Array.isArray(diagnostics.missingRounds) ? diagnostics.missingRounds : [],
        }
    })
    const diagnosticSummary = diagnosticEntries.reduce((summary, entry) => ({
        merged: summary.merged + entry.mergedFrom.length,
        dateResolved: summary.dateResolved + entry.dateResolvedMatches.length,
        ambiguous: summary.ambiguous + entry.ambiguousMatches.length,
        missingRounds: summary.missingRounds + entry.missingRounds.length,
    }), { merged: 0, dateResolved: 0, ambiguous: 0, missingRounds: 0 })
    const diagnosticIssues = diagnosticEntries.filter(entry =>
        entry.ambiguousMatches.length > 0 || entry.missingRounds.length > 0
    )
    const diagnosticActivity = diagnosticEntries.filter(entry =>
        entry.mergedFrom.length > 0 || entry.dateResolvedMatches.length > 0
    )
    const statusSubLeagueCounts = STATUS_FILTERS.reduce((counts, status) => {
        counts[status.key] = subLeagueEntries.filter(([, subLeagueData]) =>
            subLeagueData.rounds.some(round => round.status === status.key)
        ).length
        return counts
    }, {})
    const anyStatusVisible = Object.values(visibleStatuses).some(Boolean)
    const visibleSubLeagues = sortSubLeagues(subLeagueEntries).filter(([subLeagueName, subLeagueData]) => {
        const matchesSearch = subLeagueName.toLowerCase().includes(normalizedSubLeagueSearch)
        const matchesStatus = anyStatusVisible && Object.entries(visibleStatuses).some(([status, visible]) =>
            visible && subLeagueData.rounds.some(round => round.status === status)
        )
        return matchesSearch && matchesStatus
    })

    const toggleStatus = (status) => {
        setVisibleStatuses(current => ({ ...current, [status]: !current[status] }))
    }

    const copyDiagnosticsReport = async () => {
        const lines = [
            `League diagnostics: ${leagueName}`,
            `Merges: ${diagnosticSummary.merged}; date-resolved matches: ${diagnosticSummary.dateResolved}; ambiguous matches: ${diagnosticSummary.ambiguous}; missing rounds: ${diagnosticSummary.missingRounds}`,
        ]
        diagnosticActivity.forEach(entry => {
            if (entry.mergedFrom.length > 0) {
                lines.push(`${entry.subLeagueName}: merged ${entry.mergedFrom.join(', ')}`)
            }
        })
        diagnosticIssues.forEach(entry => {
            if (entry.missingRounds.length > 0) {
                lines.push(`${entry.subLeagueName}: missing ${entry.missingRounds.join(', ')}`)
            }
            entry.ambiguousMatches.forEach(match => {
                lines.push(`${entry.subLeagueName}: ${match.matchId || 'unknown match'} - ${match.reason}`)
            })
        })
        try {
            await navigator.clipboard.writeText(lines.join('\n'))
            setDiagnosticsCopied(true)
        } catch (error) {
            console.error('Unable to copy diagnostics report:', error)
        }
    }

    return (
        <div className="page-container">
            {/* Breadcrumb */}
            <div className="mb-6">
                <Link to="/" className="text-chess-green hover:underline">
                    ← All Leagues
                </Link>
            </div>

            {/* Header */}
            <div className="mb-8">
                <h2 className="text-4xl font-bold text-chess-dark mb-2">{leagueName}</h2>
                <p className="text-gray-600">
                    {Object.keys(league.subLeagues || {}).length} sub-league(s)
                </p>
            </div>

            <div className="mb-6 max-w-md">
                <label htmlFor="sub-league-search" className="block text-sm font-medium text-gray-700 mb-1">
                    Find a sub-league
                </label>
                <div className="relative">
                    <input
                        id="sub-league-search"
                        type="search"
                        value={subLeagueSearch}
                        onChange={(event) => setSubLeagueSearch(event.target.value)}
                        placeholder="Search sub-leagues by name"
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm shadow-sm outline-none transition focus:border-chess-green focus:ring-2 focus:ring-chess-green/20"
                    />
                    {subLeagueSearch && (
                        <button
                            type="button"
                            onClick={() => setSubLeagueSearch('')}
                            className="absolute inset-y-0 right-2 px-2 text-sm text-gray-500 hover:text-gray-800"
                            aria-label="Clear sub-league search"
                        >
                            ×
                        </button>
                    )}
                </div>
                {normalizedSubLeagueSearch && (
                    <p className="mt-2 text-sm text-gray-500">
                        {visibleSubLeagues.length} sub-league{visibleSubLeagues.length === 1 ? '' : 's'} shown
                    </p>
                )}
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-gray-700 mr-1">Show:</span>
                {STATUS_FILTERS.map(status => (
                    <label
                        key={status.key}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 cursor-pointer transition-colors ${visibleStatuses[status.key] ? status.activeColor : 'bg-white border-gray-200 opacity-60'}`}
                    >
                        <input
                            type="checkbox"
                            checked={visibleStatuses[status.key]}
                            onChange={() => toggleStatus(status.key)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-chess-green focus:ring-chess-green"
                        />
                        <span className={`font-medium ${status.color}`}>{status.label}</span>
                        <span className="text-xs text-gray-500">{statusSubLeagueCounts[status.key]}</span>
                    </label>
                ))}
                <span className="hidden sm:inline text-gray-300">|</span>
                <button
                    type="button"
                    onClick={() => setVisibleStatuses({ open: true, in_progress: true, finished: true })}
                    className="text-xs font-medium text-chess-green hover:underline"
                >
                    All
                </button>
            </div>

            <details className="mb-6 rounded-lg border border-gray-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-gray-700">
                    <span>Admin diagnostics</span>
                    <span className="text-xs font-normal text-gray-500">
                        {diagnosticSummary.ambiguous + diagnosticSummary.missingRounds > 0
                            ? `${diagnosticSummary.ambiguous} ambiguous · ${diagnosticSummary.missingRounds} missing`
                            : 'No unresolved issues'}
                    </span>
                </summary>
                <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-600">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>Merges: <strong>{diagnosticSummary.merged}</strong></span>
                        <span>Date-resolved: <strong>{diagnosticSummary.dateResolved}</strong></span>
                        <span>Ambiguous: <strong>{diagnosticSummary.ambiguous}</strong></span>
                        <span>Missing rounds: <strong>{diagnosticSummary.missingRounds}</strong></span>
                    </div>
                    {diagnosticIssues.length > 0 && (
                        <div className="mt-3 space-y-2">
                            {diagnosticIssues.map(entry => (
                                <div key={entry.subLeagueName} className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                                    <div className="font-semibold text-gray-800">{entry.subLeagueName}</div>
                                    {entry.missingRounds.length > 0 && (
                                        <div>Missing: {entry.missingRounds.join(', ')}</div>
                                    )}
                                    {entry.ambiguousMatches.map((match, index) => (
                                        <div key={`${match.matchId || match.name}-${index}`}>
                                            Ambiguous: {match.matchId || match.name}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={copyDiagnosticsReport}
                            className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
                        >
                            {diagnosticsCopied ? 'Copied' : 'Copy report'}
                        </button>
                        <a
                            href="https://www.chess.com/member/MasterMatthew52"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-chess-green hover:underline"
                        >
                            Contact MasterMatthew52
                        </a>
                    </div>
                </div>
            </details>

            {/* Sub-league Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {visibleSubLeagues.map(([subLeagueName, subLeagueData]) => {
                    const stats = getSubLeagueStats(subLeagueData)
                    const topPlayer = subLeagueData.leaderboard[0]

                    return (
                        <Link
                            key={subLeagueName}
                            to={`/league/${encodeURIComponent(leagueName)}/${encodeURIComponent(subLeagueName)}`}
                            className="card-hover"
                        >
                            <h3 className="text-xl font-bold text-gray-900 mb-4 capitalize">
                                {subLeagueName}
                            </h3>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Rounds:</span>
                                    <span className="font-semibold">{subLeagueData.rounds.length}</span>
                                </div>

                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Players:</span>
                                    <span className="font-semibold">{subLeagueData.leaderboard.length}</span>
                                </div>

                                {subLeagueData.record && (subLeagueData.record.wins > 0 || subLeagueData.record.losses > 0 || subLeagueData.record.draws > 0) && (
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-600">Record:</span>
                                        <span className="font-semibold">
                                            {subLeagueData.record.wins}W-{subLeagueData.record.losses}L-{subLeagueData.record.draws}D
                                        </span>
                                    </div>
                                )}

                                <div className="pt-3 border-t border-gray-200">
                                    <div className="flex flex-wrap gap-2">
                                        {stats.open > 0 && (
                                            <StatusBadge status="open" count={stats.open} />
                                        )}
                                        {stats.in_progress > 0 && (
                                            <StatusBadge status="in_progress" count={stats.in_progress} />
                                        )}
                                        {stats.finished > 0 && (
                                            <StatusBadge status="finished" count={stats.finished} />
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 text-sm text-chess-green font-medium flex items-center">
                                    View league →
                                </div>
                            </div>
                        </Link>
                    )
                })}
            </div>

            {visibleSubLeagues.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-gray-600">
                    {!anyStatusVisible
                        ? 'All status filters are hidden. Select a status above to show sub-leagues.'
                        : `No sub-leagues match “${subLeagueSearch.trim()}” with the selected statuses.`}
                </div>
            )}
        </div>
    )
}

export default LeagueView
