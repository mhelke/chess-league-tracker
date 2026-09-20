import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GameLinksModal } from '../components/EarlyResignModal'
import { buildEarlyResignationHistory } from '../utils/earlyResignUtils'

function formatHistoryDate(timestamp) {
    if (!Number.isFinite(timestamp)) return 'Date unavailable'

    return new Date(timestamp * 1000).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

function EarlyResignations() {
    const [leagueData, setLeagueData] = useState(null)
    const [earlyResignData, setEarlyResignData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [gameLinksFor, setGameLinksFor] = useState(null)

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(response => {
                if (!response.ok) throw new Error('Failed to load league data')
                return response.json()
            }),
            fetch('/data/earlyResignations.json').then(response => response.json()).catch(() => null),
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

    const history = useMemo(
        () => buildEarlyResignationHistory(earlyResignData, leagueData),
        [earlyResignData, leagueData]
    )
    const totalGames = history.reduce((sum, record) => sum + record.totalGames, 0)
    const totalPlayers = new Set(history.flatMap(record => record.players.map(player => player.username))).size

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
                    Review games where one of the club&apos;s players resigned within the early-move threshold.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                    {totalGames} early resignation{totalGames !== 1 ? 's' : ''} across {history.length} match{history.length !== 1 ? 'es' : ''} · {totalPlayers} player{totalPlayers !== 1 ? 's' : ''}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                    Dates use the match completion date when available, otherwise the match start date.
                </p>
            </div>

            {history.length === 0 ? (
                <div className="card border border-gray-200 bg-gray-50 text-center text-gray-600">
                    No early resignations have been recorded.
                </div>
            ) : (
                <div className="space-y-6">
                    {history.map(record => (
                        <section key={record.matchUrl} className="card">
                            <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-chess-green">
                                        {record.leagueName} · {record.subLeagueName}
                                    </div>
                                    <h3 className="mt-1 text-lg font-bold text-gray-900">{record.name}</h3>
                                    <p className="mt-1 text-sm text-gray-500">
                                        {formatHistoryDate(record.activityTime)} · {record.totalGames} early resignation{record.totalGames !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                {record.matchWebUrl && (
                                    <a
                                        href={record.matchWebUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 text-sm font-medium text-chess-green hover:underline"
                                    >
                                        View match &rarr;
                                    </a>
                                )}
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {record.players.map(player => (
                                    <div key={player.username} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                        <a
                                            href={`https://www.chess.com/member/${player.username}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="min-w-0 truncate text-sm font-medium text-chess-green hover:underline"
                                        >
                                            {player.username}
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => setGameLinksFor({ username: player.username, games: player.games })}
                                            className="shrink-0 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                                        >
                                            {player.games.length} game{player.games.length !== 1 ? 's' : ''}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
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
