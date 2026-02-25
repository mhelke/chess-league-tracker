import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard'
import MatchCard from '../components/MatchCard'
import { buildEarlyResignIndex } from '../utils/earlyResignUtils'
import { GameLinksModal } from '../components/EarlyResignModal'

function SubLeagueView() {
    const { leagueName, subLeagueName } = useParams()
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [earlyResignData, setEarlyResignData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState('rounds')
    const [gameLinksFor, setGameLinksFor] = useState(null)

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(r => r.json()),
            fetch('/data/timeoutData.json').then(r => r.json()).catch(() => null),
            fetch('/data/earlyResignations.json').then(r => r.json()).catch(() => null),
        ])
            .then(([leagueJson, timeoutJson, earlyResignJson]) => {
                setData(leagueJson)
                setTimeoutData(timeoutJson)
                setEarlyResignData(earlyResignJson)
                setLoading(false)
            })
            .catch(err => {
                console.error('Error loading data:', err)
                setLoading(false)
            })
    }, [])

    const subLeague = data?.leagues?.[leagueName]?.subLeagues?.[subLeagueName]

    const earlyResignIndex = useMemo(() => buildEarlyResignIndex(earlyResignData), [earlyResignData])

    // Aggregate early resignations for this specific sub-league
    const subLeagueEarlyResigns = useMemo(() => {
        if (!earlyResignIndex?.byMatchUrl || !subLeague) return []
        const matchUrls = (subLeague.rounds || []).map(r => r.matchUrl).filter(Boolean)
        const byPlayer = {}
        matchUrls.forEach(matchUrl => {
            ; (earlyResignIndex.byMatchUrl[matchUrl] || []).forEach(entry => {
                const u = entry.username
                if (!byPlayer[u]) byPlayer[u] = { username: u, total: 0, games: [] }
                const alreadyAdded = byPlayer[u].games.some(g => g.game_api === entry.game_api)
                if (!alreadyAdded) {
                    byPlayer[u].total++
                    byPlayer[u].games.push({
                        game_api: entry.game_api,
                        board_api: entry.board_api,
                        moves_ply: entry.moves_ply,
                        matchWebUrl: entry.matchWebUrl,
                    })
                }
            })
        })
        return Object.values(byPlayer).sort((a, b) => b.total - a.total)
    }, [earlyResignIndex, subLeague])

    if (loading) {
        return (
            <div className="page-container">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-chess-green mx-auto"></div>
                </div>
            </div>
        )
    }

    if (!subLeague) {
        return (
            <div className="page-container">
                <div className="card">
                    <h2 className="text-xl font-bold mb-2">Sub-league Not Found</h2>
                    <Link to={`/league/${encodeURIComponent(leagueName)}`} className="text-chess-green hover:underline">
                        ← Back to {leagueName}
                    </Link>
                </div>
            </div>
        )
    }

    // Group rounds by status and sort by most recent first
    const roundsByStatus = {
        open: subLeague.rounds.filter(r => r.status === 'open').sort((a, b) => (b.startTime || 0) - (a.startTime || 0)),
        in_progress: subLeague.rounds.filter(r => r.status === 'in_progress').sort((a, b) => (b.startTime || 0) - (a.startTime || 0)),
        finished: subLeague.rounds.filter(r => r.status === 'finished').sort((a, b) => (b.startTime || 0) - (a.startTime || 0)),
    }

    return (
        <div className="page-container">
            {/* Breadcrumb */}
            <div className="mb-6 text-sm">
                <Link to="/" className="text-chess-green hover:underline">All Leagues</Link>
                <span className="mx-2 text-gray-400">/</span>
                <Link to={`/league/${encodeURIComponent(leagueName)}`} className="text-chess-green hover:underline">
                    {leagueName}
                </Link>
                <span className="mx-2 text-gray-400">/</span>
                <span className="text-gray-600 capitalize">{subLeagueName}</span>
            </div>

            {/* Header */}
            <div className="mb-8">
                <h2 className="text-4xl font-bold text-chess-dark mb-2 capitalize">
                    {subLeagueName}
                </h2>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-gray-600">
                    <span>{leagueName} • {subLeague.rounds.length} round(s) • {subLeague.leaderboard.length} player(s)</span>
                    {subLeague.record && (subLeague.record.wins > 0 || subLeague.record.losses > 0 || subLeague.record.draws > 0) && (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-chess-light text-chess-dark">
                            Record: {subLeague.record.wins}W - {subLeague.record.losses}L - {subLeague.record.draws}D
                        </span>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-6">
                <div className="border-b border-gray-200">
                    <nav className="-mb-px flex space-x-8">
                        <button
                            onClick={() => setActiveTab('rounds')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'rounds'
                                ? 'border-chess-green text-chess-green'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            Rounds ({subLeague.rounds.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('leaderboard')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'leaderboard'
                                ? 'border-chess-green text-chess-green'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            Leaderboard
                        </button>
                        {subLeagueEarlyResigns.length > 0 && (
                            <button
                                onClick={() => setActiveTab('early_resignations')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-1.5 ${activeTab === 'early_resignations'
                                        ? 'border-rose-500 text-rose-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                            >
                                <span className="text-rose-500 text-xs">&#9888;&#65039;</span>
                                Early Resignations
                            </button>
                        )}
                    </nav>
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'rounds' ? (
                <div className="space-y-8">
                    {/* Open Matches */}
                    {roundsByStatus.open.length > 0 && (
                        <div>
                            <h3 className="text-2xl font-bold text-green-700 mb-4">
                                Open for Registration ({roundsByStatus.open.length})
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {roundsByStatus.open.map((round, idx) => (
                                    <MatchCard
                                        key={idx}
                                        round={round}
                                        timeoutData={timeoutData}
                                        leagueName={leagueName}
                                        subLeagueName={subLeagueName}
                                        earlyResignIndex={earlyResignIndex}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* In Progress Matches */}
                    {roundsByStatus.in_progress.length > 0 && (
                        <div>
                            <h3 className="text-2xl font-bold text-blue-700 mb-4">
                                In Progress ({roundsByStatus.in_progress.length})
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {roundsByStatus.in_progress.map((round, idx) => (
                                    <MatchCard
                                        key={idx}
                                        round={round}
                                        timeoutData={timeoutData}
                                        leagueName={leagueName}
                                        subLeagueName={subLeagueName}
                                        earlyResignIndex={earlyResignIndex}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Finished Matches */}
                    {roundsByStatus.finished.length > 0 && (
                        <div>
                            <h3 className="text-2xl font-bold text-gray-700 mb-4">
                                Finished ({roundsByStatus.finished.length})
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {roundsByStatus.finished.map((round, idx) => (
                                    <MatchCard
                                        key={idx}
                                        round={round}
                                        timeoutData={timeoutData}
                                        leagueName={leagueName}
                                        subLeagueName={subLeagueName}
                                        earlyResignIndex={earlyResignIndex}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : activeTab === 'leaderboard' ? (
                <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-6">Player Rankings</h3>
                    <Leaderboard players={subLeague.leaderboard} />
                </div>
            ) : (
                <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-1">Early Resignations</h3>
                    <p className="text-sm text-gray-500 mb-6">{subLeagueEarlyResigns.length} player{subLeagueEarlyResigns.length !== 1 ? 's' : ''} with early resignations in this sub-league</p>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="table-header">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Player</th>
                                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Early Resignations</th>
                                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Games</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {subLeagueEarlyResigns.map((player, idx) => (
                                    <tr key={player.username} className={idx % 2 === 0 ? 'bg-white' : 'bg-rose-50/30'}>
                                        <td className="px-6 py-4 whitespace-nowrap font-medium">
                                            <a
                                                href={`https://www.chess.com/member/${player.username}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-chess-green hover:text-green-700 hover:underline"
                                            >
                                                {player.username}
                                            </a>
                                        </td>
                                        <td className="px-6 py-4 text-center whitespace-nowrap">
                                            <span className={`font-bold text-base ${player.total >= 3 ? 'text-red-700' :
                                                    player.total === 2 ? 'text-amber-700' :
                                                        'text-gray-700'
                                                }`}>
                                                {player.total}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center whitespace-nowrap">
                                            <button
                                                onClick={() => setGameLinksFor({ username: player.username, games: player.games })}
                                                className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-200 transition-colors"
                                            >
                                                <span>&#128279;</span>
                                                <span>{player.games.length} game{player.games.length !== 1 ? 's' : ''}</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <GameLinksModal
                isOpen={!!gameLinksFor}
                onClose={() => setGameLinksFor(null)}
                username={gameLinksFor?.username ?? ''}
                games={gameLinksFor?.games ?? []}
            />
        </div>
    )
}

export default SubLeagueView
