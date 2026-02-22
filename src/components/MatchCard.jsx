import { Link } from 'react-router-dom'
import { useState } from 'react'
import StatusBadge from './StatusBadge'
import TimeoutModal from './TimeoutModal'

function MatchCard({ round, timeoutData, leagueName, subLeagueName }) {
    const [showTimeoutModal, setShowTimeoutModal] = useState(false)
    const [modalTitle, setModalTitle] = useState('')
    const [modalPlayers, setModalPlayers] = useState([])

    const formatDate = (timestamp) => {
        if (!timestamp) return null
        return new Date(timestamp * 1000).toLocaleDateString()
    }

    // Count timeouts by our players (finished/in_progress only)
    const matchTimeoutInfo = () => {
        if (!round.playerStats) return null
        let totalTimeouts = 0
        Object.values(round.playerStats).forEach(stats => {
            if (stats.timeouts) totalTimeouts += stats.timeouts
        })
        return { totalTimeouts }
    }

    const timeoutInfo = matchTimeoutInfo()

    // For open matches, calculate alerts using timeoutData.json
    const openMatchAlerts = () => {
        if (round.status !== 'open' || !timeoutData?.players) return null

        // Open matches have no playerStats; players are in registrationData.ourRoster
        const ourRoster = round.registrationData?.ourRoster ?? []
        if (ourRoster.length === 0) return null

        let playersWithHighTimeoutPercent = 0
        const alertPlayers = []
        const seen = new Set()

        ourRoster.forEach(({ username }) => {
            if (!username) return
            const td = timeoutData.players[username.toLowerCase()]
            if (!td?.riskFlag) return

            const subleagueTimeouts = td.subLeagueTimeouts?.[leagueName]?.[subLeagueName] ?? 0

            if ((td.timeoutPercent ?? 0) > 25) playersWithHighTimeoutPercent++

            if (!seen.has(username)) {
                seen.add(username)
                alertPlayers.push({
                    username,
                    dailyRating: td.dailyRating ?? null,
                    rating960: td.rating960 ?? null,
                    timeoutPercent: td.timeoutPercent ?? null,
                    totalLeagueTimeouts90Days: td.totalLeagueTimeouts90Days ?? 0,
                    subleagueTimeouts,
                    dailyTimeouts: td.dailyTimeouts ?? {},
                    riskFlag: true,
                    riskLevel: td.riskLevel,
                    riskReason: td.riskReason,
                })
            }
        })

        // Sort HIGH → MEDIUM → LOW
        const order = { HIGH: 0, MEDIUM: 1, LOW: 2 }
        alertPlayers.sort((a, b) => (order[a.riskLevel] ?? 99) - (order[b.riskLevel] ?? 99))

        return { playersWithHighTimeoutPercent, alertPlayers }
    }

    const alerts = openMatchAlerts()

    const handleAlertClick = (title, players) => {
        setModalTitle(title)
        setModalPlayers(players)
        setShowTimeoutModal(true)
    }

    return (
        <div className="card overflow-hidden">
            {/* Warning Banner / Registration Status */}
            {round.status === 'open' && round.registeredPlayers && (() => {
                const minRequired = round.minTeamPlayers || 0
                const ourCount = round.registeredPlayers.our || 0
                const needsAttention = minRequired > 0 && ourCount < minRequired

                return (
                    <div className={`-mx-6 -mt-6 mb-6 p-4 border-b-2 text-sm font-medium ${needsAttention
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                        }`}>
                        <div className="flex justify-between items-center">
                            <span className="font-semibold">
                                {needsAttention ? '⚠️ Registration Incomplete' : '📝 Open for Registration'}
                            </span>
                            <span>
                                {ourCount}{minRequired > 0 ? `/${minRequired}` : ''} registered
                            </span>
                        </div>
                    </div>
                )
            })()}

            {/* Timeout alerts for open matches */}
            {round.status === 'open' && alerts && alerts.playersWithHighTimeoutPercent > 0 && (
                <div className={`flex flex-col mb-6 -mx-6 block ${!round.registeredPlayers ? '-mt-6' : ''}`}>
                    <button
                        onClick={() => handleAlertClick(
                            'Players with High Timeout Risk (>25%)',
                            alerts.alertPlayers.filter(p => p.timeoutPercent > 25)
                        )}
                        className="w-full p-4 border-b border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 transition-all text-left"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">⏱️</span>
                                <div>
                                    <div className="font-bold text-amber-900 text-sm">Timeout Risk Alert</div>
                                    <div className="text-xs text-amber-800">{alerts.playersWithHighTimeoutPercent} player{alerts.playersWithHighTimeoutPercent !== 1 ? 's' : ''} with high timeout ratio</div>
                                </div>
                            </div>
                            <span className="text-xs font-bold text-amber-700">View Details →</span>
                        </div>
                    </button>
                </div>
            )}

            <div className="flex justify-between items-start mb-3">
                <h4 className="text-lg font-bold text-gray-900">{round.round}</h4>
                <StatusBadge status={round.status} />
            </div>

            {round.name && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">{round.name}</p>
            )}

            {round.matchResult && round.matchResult.result && round.matchResult.result !== 'unknown' && round.status === 'finished' && (() => {
                const result = round.matchResult.result
                const isWin = result === 'win' || result === 'win by forfeit'
                const isLoss = result === 'lose' || result === 'forfeit' || result === 'double forfeit'
                const isDraw = result === 'draw'

                return (
                    <div className={`mb-3 p-2 rounded-md text-sm font-medium ${isWin ? 'bg-green-50 text-green-700 border border-green-200' :
                        isLoss ? 'bg-red-50 text-red-700 border border-red-200' :
                            isDraw ? 'bg-gray-50 text-gray-700 border border-gray-200' : ''
                        }`}>
                        <div className="flex justify-between items-center">
                            <span className="font-semibold">
                                {result === 'win' ? '✓ Won' :
                                    result === 'win by forfeit' ? '✓ Won by Forfeit' :
                                        result === 'lose' ? '✗ Lost' :
                                            result === 'forfeit' ? '✗ Lost by Forfeit' :
                                                result === 'double forfeit' ? '✗ Lost (Double Forfeit)' :
                                                    '= Draw'}
                            </span>
                            <span>
                                {round.matchResult.ourScore} - {round.matchResult.opponentScore}
                            </span>
                        </div>
                    </div>
                )
            })()}

            {round.status === 'in_progress' && round.matchResult && (() => {
                const { ourScore, opponentScore } = round.matchResult
                const threshold = (round.boards || 0) + 0.5
                const isProjectedWin = ourScore > threshold
                const isProjectedLoss = opponentScore > threshold
                const ptsNeeded = threshold - ourScore

                return (
                    <div className="mb-3 p-2 rounded-md text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold">⏳ In Progress</span>
                            <span>{ourScore} - {opponentScore}</span>
                        </div>
                        <div className="text-xs mt-1 opacity-80">
                            {isProjectedWin ? '🟢 Projected Win'
                                : isProjectedLoss ? '🔴 Projected Loss'
                                    : `${ptsNeeded} pts needed to win`}
                        </div>
                    </div>
                )
            })()}

            {/* Timeout info for finished/in_progress matches */}
            {(round.status === 'finished' || round.status === 'in_progress') && timeoutInfo && timeoutInfo.totalTimeouts > 0 && (
                <div className="mb-3 p-2 rounded-md text-sm bg-orange-50 border border-orange-200">
                    <div className="flex items-center gap-2">
                        <span className="text-orange-700">⏱️</span>
                        <span className="text-orange-800 font-medium">
                            {timeoutInfo.totalTimeouts} timeout{timeoutInfo.totalTimeouts !== 1 ? 's' : ''} by our team
                        </span>
                    </div>
                </div>
            )}

            {round.boardsData && round.boardsData.length > 0 && (() => {
                const diffs = round.boardsData.map(b => b.ratingDiff).filter(d => d !== null)
                const avgDiff = diffs.length > 0 ? (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(0) : 0
                const ahead = diffs.filter(d => d > 0).length
                const behind = diffs.filter(d => d < 0).length
                const even = diffs.filter(d => d === 0).length

                return (
                    <div className="mb-3 p-2 rounded-md text-xs bg-gray-50 border border-gray-200">
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-semibold text-gray-700">Match Stats:</span>
                            <span className={`font-semibold ${avgDiff > 0 ? 'text-green-600' : avgDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                Avg: {avgDiff > 0 ? '+' : ''}{avgDiff}
                            </span>
                        </div>
                        <div className="flex gap-3 text-xs mb-2">
                            <span className="text-green-600">⬆ {ahead}</span>
                            <span className="text-gray-600">= {even}</span>
                            <span className="text-red-600">⬇ {behind}</span>
                        </div>
                    </div>
                )
            })()
            }

            {
                round.registrationData && round.registrationData.type === 'roster' && (() => {
                    const ourRatings = round.registrationData.ourRoster?.map(p => p.rating).filter(r => r) || []
                    const oppRatings = round.registrationData.oppRoster?.map(p => p.rating).filter(r => r) || []
                    const ourAvg = ourRatings.length > 0 ? (ourRatings.reduce((a, b) => a + b, 0) / ourRatings.length).toFixed(0) : 0
                    const oppAvg = oppRatings.length > 0 ? (oppRatings.reduce((a, b) => a + b, 0) / oppRatings.length).toFixed(0) : 0
                    const avgDiff = ourAvg - oppAvg
                    const ourCount = round.registeredPlayers?.our || 0
                    const oppCount = round.registeredPlayers?.opponent || 0
                    const playerDeficit = ourCount < oppCount

                    return (
                        <div className="mb-3 p-2 rounded-md text-xs bg-gray-50 border border-gray-200">
                            <div className="flex justify-between items-center mb-2">
                                <div className="font-semibold text-gray-700">
                                    Players: {ourCount} vs {oppCount}
                                </div>
                                <div className={`font-bold text-base ${avgDiff > 0 ? 'text-green-600' : avgDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                    {avgDiff > 0 ? '+' : ''}{avgDiff}
                                </div>
                            </div>
                            <div className="flex justify-between text-[10px] text-gray-600">
                                <span>Our Avg: <span className="font-semibold text-gray-900">{ourAvg}</span></span>
                                <span>Opp Avg: <span className="font-semibold text-gray-900">{oppAvg}</span></span>
                            </div>
                        </div>
                    )
                })()
            }

            <div className="space-y-2 text-sm">
                {round.startTime && (
                    <div className="flex justify-between">
                        <span className="text-gray-500">{round.status === 'open' ? 'Starts:' : 'Started:'}</span>
                        <span className="text-gray-900">{formatDate(round.startTime)}</span>
                    </div>
                )}

                {round.endTime && (
                    <div className="flex justify-between">
                        <span className="text-gray-500">Ended:</span>
                        <span className="text-gray-900">{formatDate(round.endTime)}</span>
                    </div>
                )}

                {round.boards > 0 && (
                    <div className="flex justify-between pt-2 border-t border-gray-200">
                        <span className="text-gray-500">Players:</span>
                        <span className="text-gray-900 font-medium">{round.boards}</span>
                    </div>
                )}
            </div>

            {
                round.status === 'open' && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                        <Link
                            to="/matches"
                            className="text-sm text-chess-dark hover:text-chess-green font-medium inline-flex items-center gap-1"
                        >
                            View full details →
                        </Link>
                    </div>
                )
            }

            {
                (round.matchWebUrl || round.matchUrl) && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                        <a
                            href={round.matchWebUrl || round.matchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-chess-green hover:text-green-700 font-medium inline-flex items-center gap-1"
                        >
                            View on chess.com →
                        </a>
                    </div>
                )
            }

            <TimeoutModal
                isOpen={showTimeoutModal}
                onClose={() => setShowTimeoutModal(false)}
                title={modalTitle}
                players={modalPlayers}
            />
        </div >
    )
}

export default MatchCard
