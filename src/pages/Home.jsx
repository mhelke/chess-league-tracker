import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'

function Home() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        fetch('/data/leagueData.json')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load league data')
                }
                return response.json()
            })
            .then(data => {
                setData(data)
                setLoading(false)
            })
            .catch(err => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    if (loading) {
        return (
            <div className="page-container">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-chess-green mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading league data...</p>
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

    const getLeagueStats = (leagueData) => {
        let totalRounds = 0
        let statusCounts = { open: 0, in_progress: 0, finished: 0 }
        let totalPlayers = new Set()

        Object.values(leagueData.subLeagues || {}).forEach(subLeague => {
            totalRounds += subLeague.rounds.length
            subLeague.rounds.forEach(round => {
                statusCounts[round.status]++
            })
            subLeague.leaderboard.forEach(player => {
                totalPlayers.add(player.username)
            })
        })

        return { totalRounds, statusCounts, totalPlayers: totalPlayers.size }
    }

    return (
        <div className="page-container">
            {/* Header Section */}
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Active Leagues</h2>
                <p className="text-gray-600">
                    Last updated: {new Date(data.lastUpdated).toLocaleString()}
                </p>
            </div>

            {/* View Open Matches Button */}
            <Link
                to="/matches"
                className="block mb-8 card bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-2">Open Matches</h3>
                        <p className="text-gray-800">View all open matches</p>
                    </div>
                    <div className="text-4xl">→</div>
                </div>
            </Link>

            {/* League Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                {Object.entries(data.leagues || {}).map(([leagueName, leagueData]) => {
                    const stats = getLeagueStats(leagueData)
                    return (
                        <Link
                            key={leagueName}
                            to={`/league/${encodeURIComponent(leagueName)}`}
                            className="card-hover"
                        >
                            <h3 className="text-2xl font-bold text-chess-dark mb-4">{leagueName}</h3>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Sub-leagues:</span>
                                    <span className="font-semibold text-lg">
                                        {Object.keys(leagueData.subLeagues || {}).length}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Total rounds:</span>
                                    <span className="font-semibold text-lg">{stats.totalRounds}</span>
                                </div>

                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Players:</span>
                                    <span className="font-semibold text-lg">{stats.totalPlayers}</span>
                                </div>

                                <div className="pt-3 border-t border-gray-200">
                                    <div className="flex flex-wrap gap-2">
                                        {stats.statusCounts.open > 0 && (
                                            <StatusBadge status="open" count={stats.statusCounts.open} />
                                        )}
                                        {stats.statusCounts.in_progress > 0 && (
                                            <StatusBadge status="in_progress" count={stats.statusCounts.in_progress} />
                                        )}
                                        {stats.statusCounts.finished > 0 && (
                                            <StatusBadge status="finished" count={stats.statusCounts.finished} />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </Link>
                    )
                })}
            </div>

            {/* Quick Stats */}
            <div className="card bg-gradient-to-r from-chess-dark to-gray-700 text-white">
                <h3 className="text-xl font-bold mb-4">Quick Stats</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                        <div className="text-3xl font-bold">{Object.keys(data.leagues || {}).length}</div>
                        <div className="text-sm text-gray-300">Leagues</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-bold">{data.globalLeaderboard.length}</div>
                        <div className="text-sm text-gray-300">Players</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-bold">
                            {Object.values(data.leagues || {}).reduce((sum, league) =>
                                sum + Object.keys(league.subLeagues || {}).length, 0
                            )}
                        </div>
                        <div className="text-sm text-gray-300">Sub-leagues</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-bold">
                            {Object.values(data.leagues || {}).reduce((sum, league) =>
                                sum + Object.values(league.subLeagues || {}).reduce((s, sl) =>
                                    s + sl.rounds.length, 0
                                ), 0
                            )}
                        </div>
                        <div className="text-sm text-gray-300">Rounds</div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Home
