import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard'
import MatchCard from '../components/MatchCard'

function SubLeagueView() {
    const { leagueName, subLeagueName } = useParams()
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState('rounds')

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(r => r.json()),
            fetch('/data/timeoutData.json').then(r => r.json()).catch(() => null),
        ])
            .then(([leagueJson, timeoutJson]) => {
                setData(leagueJson)
                setTimeoutData(timeoutJson)
                setLoading(false)
            })
            .catch(err => {
                console.error('Error loading data:', err)
                setLoading(false)
            })
    }, [])

    const subLeague = data?.leagues?.[leagueName]?.subLeagues?.[subLeagueName]


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
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-6">Player Rankings</h3>
                    <Leaderboard players={subLeague.leaderboard} />
                </div>
            )}
        </div>
    )
}

export default SubLeagueView
