import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard'

function GlobalLeaderboard() {
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

    if (!data) {
        return (
            <div className="page-container">
                <div className="card">
                    <h2 className="text-xl font-bold mb-2">Error Loading Data</h2>
                    <Link to="/" className="text-chess-green hover:underline">
                        ← Back to home
                    </Link>
                </div>
            </div>
        )
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
                <h2 className="text-4xl font-bold text-chess-dark mb-2">
                    Global Leaderboard
                </h2>
                <p className="text-gray-600">
                    Combined rankings across all leagues • {data.globalLeaderboard.length} players
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="card bg-gradient-to-br from-yellow-400 to-yellow-600 text-white">
                    <div className="text-sm font-medium mb-1">🥇 Top Player</div>
                    {data.globalLeaderboard[0] && (
                        <>
                            <div className="text-2xl font-bold">{data.globalLeaderboard[0].username}</div>
                            <div className="text-xl">{data.globalLeaderboard[0].points} points</div>
                        </>
                    )}
                </div>

                <div className="card bg-gradient-to-br from-blue-400 to-blue-600 text-white">
                    <div className="text-sm font-medium mb-1">📊 Total Games</div>
                    <div className="text-3xl font-bold">
                        {data.globalLeaderboard.reduce((sum, p) => sum + p.games, 0)}
                    </div>
                </div>

                <div className="card bg-gradient-to-br from-purple-400 to-purple-600 text-white">
                    <div className="text-sm font-medium mb-1">👥 Active Players</div>
                    <div className="text-3xl font-bold">{data.globalLeaderboard.length}</div>
                </div>
            </div>

            {/* Leaderboard */}
            <div className="card">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">All Players</h3>
                <Leaderboard players={data.globalLeaderboard} showRank />
            </div>
        </div>
    )
}

export default GlobalLeaderboard
