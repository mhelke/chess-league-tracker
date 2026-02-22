import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'
import TimeoutModal from '../components/TimeoutModal'

function AllMatches() {
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState('open')
    const [showTimeoutModal, setShowTimeoutModal] = useState(false)
    const [modalTitle, setModalTitle] = useState('')
    const [modalPlayers, setModalPlayers] = useState([])

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

    if (loading) {
        return (
            <div className="page-container">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-chess-green mx-auto"></div>
                </div>
            </div>
        )
    }

    // Collect all matches from all leagues and sub-leagues
    const allMatches = {
        open: [],
        in_progress: [],
        finished: []
    }

    if (data?.leagues) {
        Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
            Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
                subLeagueData.rounds?.forEach(round => {
                    const matchWithContext = {
                        ...round,
                        leagueName,
                        subLeagueName
                    }

                    if (round.status === 'open') {
                        allMatches.open.push(matchWithContext)
                    } else if (round.status === 'in_progress') {
                        allMatches.in_progress.push(matchWithContext)
                    } else if (round.status === 'finished') {
                        allMatches.finished.push(matchWithContext)
                    }
                })
            })
        })
    }

    // Sort by most recent first
    allMatches.open.sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
    allMatches.in_progress.sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
    allMatches.finished.sort((a, b) => (b.startTime || 0) - (a.startTime || 0))

    const formatDate = (timestamp) => {
        if (!timestamp) return 'Not started'
        return new Date(timestamp * 1000).toLocaleDateString()
    }

    const MatchRow = ({ match }) => {
        // Calculate timeout info for this match
        const matchTimeouts = useMemo(() => {
            let totalTimeouts = 0
            let playersWithHighTimeout = 0
            const alertPlayers = []
            const seen = new Set()

            if (match.status === 'open' && timeoutData?.players) {
                // Open matches: players are in registrationData.ourRoster, not playerStats
                const ourRoster = match.registrationData?.ourRoster ?? []
                ourRoster.forEach(({ username }) => {
                    if (!username) return
                    const td = timeoutData.players[username.toLowerCase()]
                    if (!td?.riskFlag) return
                    if (seen.has(username)) return
                    seen.add(username)
                    playersWithHighTimeout++
                    const subleagueTimeouts = td.subLeagueTimeouts?.[match.leagueName]?.[match.subLeagueName] ?? 0
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
                })
            } else if (match.playerStats) {
                // In-progress / finished: count timeouts from playerStats
                Object.values(match.playerStats).forEach(stats => {
                    if (stats.timeouts) totalTimeouts += stats.timeouts
                })
            }

            // Sort HIGH → MEDIUM → LOW
            const order = { HIGH: 0, MEDIUM: 1, LOW: 2 }
            alertPlayers.sort((a, b) => (order[a.riskLevel] ?? 99) - (order[b.riskLevel] ?? 99))

            return { totalTimeouts, hasHighTimeout: playersWithHighTimeout > 0, playersWithHighTimeout, alertPlayers }
        }, [match, timeoutData])

        // Calculate warning conditions for registration matches
        const minRequired = match.minTeamPlayers || 0
        const ourCount = match.registeredPlayers?.our || 0
        const oppCount = match.registeredPlayers?.opponent || 0
        const playerDeficit = ourCount < oppCount
        const minNotMet = minRequired > 0 && ourCount < minRequired

        // Calculate rating differential for registration matches
        let avgDiff = 0
        let ratingDisadvantage = false
        if (match.registrationData && match.registrationData.type === 'roster') {
            const ourRatings = match.registrationData.ourRoster?.map(p => p.rating).filter(r => r) || []
            const oppRatings = match.registrationData.oppRoster?.map(p => p.rating).filter(r => r) || []
            const ourAvg = ourRatings.length > 0 ? (ourRatings.reduce((a, b) => a + b, 0) / ourRatings.length) : 0
            const oppAvg = oppRatings.length > 0 ? (oppRatings.reduce((a, b) => a + b, 0) / oppRatings.length) : 0
            avgDiff = ourAvg - oppAvg
            ratingDisadvantage = avgDiff < -50  // More than 50 points behind
        }

        const hasWarning = minNotMet || playerDeficit || ratingDisadvantage
        const hasTimeoutWarning = match.status === 'open' && matchTimeouts.hasHighTimeout
        const hasAlert = hasWarning || hasTimeoutWarning

        const cardBorder = (() => {
            if (match.status === 'finished') {
                const result = match.matchResult?.result
                if (result === 'win' || result === 'win by forfeit') return 'border-2 border-green-400'
                if (result === 'lose' || result === 'forfeit' || result === 'double forfeit') return 'border-2 border-red-400'
                return 'border-2 border-gray-300'
            }
            if (match.status === 'in_progress') {
                const threshold = (match.boards || 0) + 0.5
                if ((match.matchResult?.ourScore ?? 0) > threshold) return 'border-2 border-green-400'
                if ((match.matchResult?.opponentScore ?? 0) > threshold) return 'border-2 border-red-400'
                return 'border-2 border-gray-300'
            }
            // open
            if (hasAlert) return 'border-2 border-red-300'
            return 'border-2 border-gray-300'
        })()

        return (
            <div className={`card mb-3 overflow-hidden ${cardBorder}`}>
                {/* Warning Banner */}
                {hasWarning && match.status === 'open' && (
                    <div className="bg-red-50 border-b-2 border-red-200 -mx-6 -mt-6 mb-2 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                            <span className="text-xl">⚠️</span>
                            <span>Action Required</span>
                        </div>
                        <div className="mt-1 text-xs text-red-600 space-y-1">
                            {minNotMet && <div>• Need {minRequired - ourCount} more player(s) to avoid forfeit</div>}
                            {playerDeficit && !minNotMet && <div>• Opponent has {oppCount - ourCount} more player(s) registered</div>}
                            {ratingDisadvantage && <div>• Team average rating is {Math.abs(avgDiff).toFixed(0)} points lower</div>}
                        </div>
                    </div>
                )}

                {/* Timeout alerts for open matches */}
                {hasTimeoutWarning && (
                    <button
                        onClick={() => {
                            setModalTitle('Players with High Timeout Risk (>25%)')
                            setModalPlayers(matchTimeouts.alertPlayers)
                            setShowTimeoutModal(true)
                        }}
                        className={`w-[calc(100%+3.05rem)] bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-300 -mx-6 p-4 mb-4 hover:from-orange-100 hover:to-amber-100 transition-all text-left ${!hasWarning ? '-mt-6' : ''}`}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-2xl">⏱️</span>
                                <div>
                                    <div className="text-sm font-bold text-amber-900">Timeout Risk Alert</div>
                                    <div className="text-xs text-amber-800 mt-0.5">{matchTimeouts.playersWithHighTimeout} player{matchTimeouts.playersWithHighTimeout !== 1 ? 's' : ''} with high timeout ratio</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-xs font-bold text-amber-700">
                                <span>View Details</span>
                                <span>→</span>
                            </div>
                        </div>
                    </button>
                )}

                {/* Timeout info for finished/in_progress matches */}
                {(match.status === 'finished' || match.status === 'in_progress') && matchTimeouts.totalTimeouts > 0 && (
                    <div className="bg-orange-50 border-b border-orange-200 -m-4 mb-3 p-2 rounded-t-lg">
                        <div className="flex items-center gap-2 text-xs font-medium text-orange-800">
                            <span>⏱️</span>
                            <span>{matchTimeouts.totalTimeouts} timeout{matchTimeouts.totalTimeouts !== 1 ? 's' : ''} by our team</span>
                        </div>
                    </div>
                )}

                {/* Success Banner for open matches */}
                {match.status === 'open' && !hasWarning && minRequired > 0 && ourCount >= minRequired && (
                    <div className="bg-green-50 border-b border-green-200 -m-4 mb-3 p-2 rounded-t-lg">
                        <div className="flex items-center gap-2 text-xs font-medium text-green-700">
                            <span>✔️</span>
                            <span>Minimum players met ({ourCount}/{minRequired})</span>
                        </div>
                    </div>
                )}

                <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={match.status} />
                            <span className="text-xs text-gray-500">{match.leagueName}</span>
                        </div>
                        <Link
                            to={`/league/${encodeURIComponent(match.leagueName)}/${encodeURIComponent(match.subLeagueName)}`}
                            className="text-sm font-semibold text-chess-dark hover:text-chess-green"
                        >
                            {match.subLeagueName}
                        </Link>
                        <p className="text-sm text-gray-600 mt-1">{match.name}</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-gray-600 mt-3">
                    <span>{match.status === 'open' ? `Starts: ${formatDate(match.startTime)}` : `Started: ${formatDate(match.startTime)}`}</span>
                    {match.endTime && <span>Ended: {formatDate(match.endTime)}</span>}

                    {match.boards > 0 && (
                        <span className="font-medium text-chess-dark">
                            Players: {match.boards}
                        </span>
                    )}

                    {match.matchResult && match.status === 'finished' && (() => {
                        const result = match.matchResult.result
                        const isWin = result === 'win' || result === 'win by forfeit'
                        const isLoss = result === 'lose' || result === 'forfeit' || result === 'double forfeit'

                        return (
                            <span className={`font-medium ${isWin ? 'text-green-600' :
                                isLoss ? 'text-red-600' :
                                    'text-gray-600'
                                }`}>
                                {result === 'win' ? '✓ Won' :
                                    result === 'win by forfeit' ? '✓ Won by Forfeit' :
                                        result === 'lose' ? '✗ Lost' :
                                            result === 'forfeit' ? '✗ Lost by Forfeit' :
                                                result === 'double forfeit' ? '✗ Lost (Double Forfeit)' :
                                                    '= Draw'} ({match.matchResult.ourScore} - {match.matchResult.opponentScore})
                            </span>
                        )
                    })()}

                    {match.matchResult && match.status === 'in_progress' && (() => {
                        const { ourScore, opponentScore } = match.matchResult
                        const threshold = (match.boards || 0) + 0.5
                        const isProjectedWin = ourScore > threshold
                        const isProjectedLoss = opponentScore > threshold
                        const ptsNeeded = threshold - ourScore

                        return (
                            <span className={`font-medium ${isProjectedWin ? 'text-green-600' : isProjectedLoss ? 'text-red-600' : 'text-yellow-600'
                                }`}>
                                {isProjectedWin ? '🟢 Projected Win' : isProjectedLoss ? '🔴 Projected Loss' : '🟡 In Progress'}
                                {' '}({ourScore} - {opponentScore})
                                {!isProjectedWin && !isProjectedLoss && (
                                    <span className="text-xs ml-1 opacity-75">
                                        · {ptsNeeded} pts needed to win
                                    </span>
                                )}
                            </span>
                        )
                    })()}
                </div>

                {match.boardsData && match.boardsData.length > 0 && (() => {
                    const diffs = match.boardsData.map(b => b.ratingDiff).filter(d => d !== null)
                    const avgDiff = diffs.length > 0 ? (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(0) : 0
                    const ahead = diffs.filter(d => d > 0).length
                    const behind = diffs.filter(d => d < 0).length
                    const even = diffs.filter(d => d === 0).length

                    // Group by rating cohorts (100-point ranges)
                    const cohorts = {}
                    match.boardsData.forEach(board => {
                        if (board.ourRating && board.oppRating) {
                            const avgRating = Math.floor((board.ourRating + board.oppRating) / 2)
                            const cohort = Math.floor(avgRating / 100) * 100
                            if (!cohorts[cohort]) cohorts[cohort] = []
                            cohorts[cohort].push(board.ratingDiff)
                        }
                    })

                    const cohortStats = Object.entries(cohorts)
                        .sort(([a], [b]) => parseInt(a) - parseInt(b))
                        .map(([cohort, diffs]) => ({
                            range: `${cohort}-${parseInt(cohort) + 100}`,
                            avg: (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(0),
                            count: diffs.length
                        }))

                    return (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                            <div className="mb-3">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-semibold text-gray-700">Overall:</span>
                                    <span className={`text-sm font-bold ${avgDiff > 0 ? 'text-green-600' : avgDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                        Avg: {avgDiff > 0 ? '+' : ''}{avgDiff}
                                    </span>
                                </div>
                                <div className="flex gap-4 text-xs">
                                    <span className="text-green-600">⬆ Ahead: {ahead}</span>
                                    <span className="text-gray-600">= Even: {even}</span>
                                    <span className="text-red-600">⬇ Behind: {behind}</span>
                                </div>
                            </div>

                            {cohortStats.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold text-gray-700 mb-2">By Rating Range:</div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                                        {cohortStats.map((stat, idx) => (
                                            <div key={idx} className="flex justify-between items-center bg-white p-1.5 rounded border border-gray-200">
                                                <span className="text-gray-600">{stat.range}:</span>
                                                <span className={`font-semibold ${stat.avg > 0 ? 'text-green-600' : stat.avg < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                                    {stat.avg > 0 ? '+' : ''}{stat.avg}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-3">
                                <div className="text-xs font-semibold text-gray-700 mb-2">Board Differentials:</div>
                                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 text-xs">
                                    {match.boardsData.map((board, idx) => (
                                        <div key={idx} className="flex justify-between items-center bg-white p-1 rounded border border-gray-100">
                                            <span className="text-gray-500 text-[10px]">B{board.boardNumber}:</span>
                                            {board.ratingDiff !== null ? (
                                                <span className={`font-semibold text-[10px] ${board.ratingDiff > 0 ? 'text-green-600' : board.ratingDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                                    {board.ratingDiff > 0 ? '+' : ''}{board.ratingDiff}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-[10px]">—</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )
                })()}

                {match.registrationData && match.registrationData.type === 'roster' && (() => {
                    const ourRatings = match.registrationData.ourRoster?.map(p => p.rating).filter(r => r) || []
                    const oppRatings = match.registrationData.oppRoster?.map(p => p.rating).filter(r => r) || []
                    const ourAvg = ourRatings.length > 0 ? (ourRatings.reduce((a, b) => a + b, 0) / ourRatings.length).toFixed(0) : 0
                    const oppAvg = oppRatings.length > 0 ? (oppRatings.reduce((a, b) => a + b, 0) / oppRatings.length).toFixed(0) : 0
                    const avgDiff = ourAvg - oppAvg

                    // Distribution by rating cohorts (100-point ranges)
                    const ourCohorts = {}
                    const oppCohorts = {}

                    ourRatings.forEach(rating => {
                        const cohort = Math.floor(rating / 100) * 100
                        ourCohorts[cohort] = (ourCohorts[cohort] || 0) + 1
                    })

                    oppRatings.forEach(rating => {
                        const cohort = Math.floor(rating / 100) * 100
                        oppCohorts[cohort] = (oppCohorts[cohort] || 0) + 1
                    })

                    const allCohorts = new Set([...Object.keys(ourCohorts), ...Object.keys(oppCohorts)])
                    const cohortComparison = Array.from(allCohorts)
                        .sort((a, b) => parseInt(a) - parseInt(b))
                        .map(cohort => ({
                            range: `${cohort}-${parseInt(cohort) + 100}`,
                            our: ourCohorts[cohort] || 0,
                            opp: oppCohorts[cohort] || 0,
                            diff: (ourCohorts[cohort] || 0) - (oppCohorts[cohort] || 0)
                        }))

                    return (
                        <div className="mt-3 pt-3 border-t-2 border-gray-200">
                            {/* Key Stats Card */}
                            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg mb-4 border border-blue-200">
                                <div className="grid grid-cols-3 gap-4 text-center">
                                    <div>
                                        <div className="text-xs text-gray-600 mb-1">Our Team</div>
                                        <div className="text-2xl font-bold text-chess-dark">{match.registeredPlayers?.our || 0}</div>
                                        <div className="text-xs text-gray-600 mt-1">Avg: {ourAvg}</div>
                                    </div>
                                    <div className="flex items-center justify-center">
                                        <div className={`text-3xl font-bold ${avgDiff > 20 ? 'text-green-600' :
                                            avgDiff < -20 ? 'text-red-600' :
                                                avgDiff > 0 ? 'text-green-500' :
                                                    avgDiff < 0 ? 'text-red-500' :
                                                        'text-gray-600'
                                            }`}>
                                            {avgDiff > 0 ? '+' : ''}{avgDiff}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-600 mb-1">Opponent</div>
                                        <div className="text-2xl font-bold text-gray-900">{match.registeredPlayers?.opponent || 0}</div>
                                        <div className="text-xs text-gray-600 mt-1">Avg: {oppAvg}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Cohort Analysis */}
                            {cohortComparison.length > 0 && (
                                <div className="mb-4">
                                    <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                        <span>📊</span>
                                        <span>Strength Distribution by Rating</span>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                                        {cohortComparison.map((cohort, idx) => {
                                            const hasProblem = cohort.diff < -1
                                            return (
                                                <div key={idx} className={`p-2.5 rounded-lg border-2 ${hasProblem ? 'bg-red-50 border-red-300' :
                                                    cohort.diff > 1 ? 'bg-green-50 border-green-300' :
                                                        'bg-gray-50 border-gray-200'
                                                    }`}>
                                                    <div className="text-xs font-semibold text-gray-700 mb-1.5">{cohort.range}</div>
                                                    <div className="flex justify-between items-center text-xs mb-1">
                                                        <span className="font-medium text-chess-dark">{cohort.our}</span>
                                                        <span className="text-gray-400">vs</span>
                                                        <span className="font-medium text-gray-700">{cohort.opp}</span>
                                                    </div>
                                                    <div className={`text-center text-sm font-bold ${cohort.diff > 0 ? 'text-green-600' :
                                                        cohort.diff < 0 ? 'text-red-600' :
                                                            'text-gray-500'
                                                        }`}>
                                                        {cohort.diff > 0 ? '+' : ''}{cohort.diff}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })()}

                <div className="mt-3 pt-3 border-t border-gray-200">
                    <a
                        href={match.matchWebUrl || match.matchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-chess-green hover:text-green-700 font-medium"
                    >
                        View on chess.com →
                    </a>
                </div>
            </div>
        )
    }

    const renderMatches = (matches, emptyMessage) => {
        if (matches.length === 0) {
            return (
                <div className="card text-center py-12 text-gray-500">
                    {emptyMessage}
                </div>
            )
        }

        // Group by league
        const byLeague = {}
        matches.forEach(match => {
            if (!byLeague[match.leagueName]) {
                byLeague[match.leagueName] = []
            }
            byLeague[match.leagueName].push(match)
        })

        return (
            <div className="space-y-6">
                {Object.entries(byLeague).map(([leagueName, leagueMatches]) => (
                    <div key={leagueName}>
                        <h3 className="text-xl font-bold text-chess-dark mb-3">
                            {leagueName} ({leagueMatches.length})
                        </h3>
                        {leagueMatches.map((match, idx) => (
                            <MatchRow key={`${match.matchId}-${idx}`} match={match} />
                        ))}
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="page-container">
            {/* Header */}
            <div className="mb-8">
                <h2 className="text-4xl font-bold text-chess-dark mb-2">All Matches</h2>
                <p className="text-gray-600">
                    View all matches across leagues
                </p>
                {data?.lastUpdated && (
                    <p className="text-gray-600">
                        Last updated: {new Date(data.lastUpdated).toLocaleString()}
                    </p>
                )}
            </div>

            {/* Tabs */}
            <div className="mb-6">
                <div className="border-b border-gray-200">
                    <nav className="-mb-px flex space-x-8">
                        <button
                            onClick={() => setActiveTab('open')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'open'
                                ? 'border-chess-green text-chess-green'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            Open for Registration ({allMatches.open.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('in_progress')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'in_progress'
                                ? 'border-chess-green text-chess-green'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            In Progress ({allMatches.in_progress.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('finished')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'finished'
                                ? 'border-chess-green text-chess-green'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            Finished ({allMatches.finished.length})
                        </button>
                    </nav>
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'open' && renderMatches(allMatches.open, 'No matches open for registration')}
            {activeTab === 'in_progress' && renderMatches(allMatches.in_progress, 'No matches in progress')}
            {activeTab === 'finished' && renderMatches(allMatches.finished, 'No finished matches')}

            {/* Timeout Modal */}
            <TimeoutModal
                isOpen={showTimeoutModal}
                onClose={() => setShowTimeoutModal(false)}
                title={modalTitle}
                players={modalPlayers}
            />
        </div>
    )
}

export default AllMatches
