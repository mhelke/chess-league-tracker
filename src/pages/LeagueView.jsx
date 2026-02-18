import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'

function LeagueView() {
    const { leagueName } = useParams()
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)

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

            {/* Sub-league Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(league.subLeagues || {}).map(([subLeagueName, subLeagueData]) => {
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
        </div>
    )
}

export default LeagueView
