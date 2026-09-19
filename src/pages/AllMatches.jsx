import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'
import TimeoutModal from '../components/TimeoutModal'
import EarlyResignModal from '../components/EarlyResignModal'
import AuditLogModal from '../components/AuditLogModal'
import { buildEarlyResignIndex, getModalPlayersForMatch } from '../utils/earlyResignUtils'
import { computeMatchupRatings } from '../utils/ratingUtils'
import { collectActionItems, getTimeoutRiskPlayers, normalizeMatchId } from '../utils/actionItemUtils'

function AllMatches() {
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [earlyResignData, setEarlyResignData] = useState(null)
    const [clubIcons, setClubIcons] = useState({})
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState('open')
    const [showTimeoutModal, setShowTimeoutModal] = useState(false)
    const [modalTitle, setModalTitle] = useState('')
    const [modalPlayers, setModalPlayers] = useState([])
    const [showEarlyResignModal, setShowEarlyResignModal] = useState(false)
    const [earlyResignModalPlayers, setEarlyResignModalPlayers] = useState([])
    const [showHistoryModal, setShowHistoryModal] = useState(false)
    const [historyModalMatch, setHistoryModalMatch] = useState(null)
    const [collapsedLeagues, setCollapsedLeagues] = useState({})
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedLeague, setSelectedLeague] = useState('')
    const [openViewMode, setOpenViewMode] = useState('calendar')
    const [finishedVisibleCounts, setFinishedVisibleCounts] = useState({})
    const [highlightedMatchKey, setHighlightedMatchKey] = useState(null)
    const [searchParams] = useSearchParams()
    const targetMatchId = normalizeMatchId(searchParams.get('matchId'))
    const requestedStatus = searchParams.get('status')
    const shouldOpenAudit = searchParams.get('audit') === '1'

    const SITE_NAMES = {
        '1dpmc': '1 Day Per Move Club',
        'teamusa': 'Team USA',
        'mn': 'Team Minnesota'
    }
    const ourSiteName = SITE_NAMES[__SITE_KEY__] || 'Our Team'

    // Build early resignation index — must be before any early return (Rules of Hooks)
    const earlyResignIndex = useMemo(() => buildEarlyResignIndex(earlyResignData, data), [earlyResignData, data])

    const actionItemsByMatchId = useMemo(() => {
        const index = new Map()
        collectActionItems(data, timeoutData).forEach(match => {
            const matchId = normalizeMatchId(match.matchId)
            if (matchId) index.set(matchId, match)
        })
        return index
    }, [data, timeoutData])

    // List of available top-level leagues for quick filtering
    const leagueOptions = useMemo(() => {
        if (!data?.leagues) return []
        return Object.keys(data.leagues).sort()
    }, [data])

    // Per-league counts for each section (open, in_progress, finished)
    const leagueCounts = useMemo(() => {
        const out = {}
        if (!data?.leagues) return out
        Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
            const counts = { open: 0, in_progress: 0, finished: 0 }
            Object.values(leagueData.subLeagues || {}).forEach(sub => {
                (sub.rounds || []).forEach(r => {
                    if (r.status === 'open') counts.open++
                    else if (r.status === 'in_progress') counts.in_progress++
                    else if (r.status === 'finished') counts.finished++
                })
            })
            out[leagueName] = counts
        })
        return out
    }, [data])

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(r => r.json()),
            fetch('/data/timeoutData.json').then(r => r.json()).catch(() => null),
            fetch('/data/earlyResignations.json').then(r => r.json()).catch(() => null),
            fetch('/data/clubIcons.json').then(r => r.json()).catch(() => ({})),
        ])
            .then(([leagueJson, timeoutJson, earlyResignJson, clubIconsJson]) => {
                setData(leagueJson)
                setTimeoutData(timeoutJson)
                setEarlyResignData(earlyResignJson)
                setClubIcons(clubIconsJson || {})
                setLoading(false)
            })
            .catch(err => {
                console.error('Error loading data:', err)
                setLoading(false)
            })
    }, [])

    useEffect(() => {
        if (!data || !targetMatchId) return

        let targetMatch = null
        Object.entries(data.leagues || {}).forEach(([leagueName, leagueData]) => {
            Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
                ; (subLeagueData.rounds || []).forEach(round => {
                    if (normalizeMatchId(round.matchId) === targetMatchId) {
                        targetMatch = { ...round, leagueName, subLeagueName }
                    }
                })
            })
        })

        if (targetMatch) {
            setActiveTab(targetMatch.status)
            if (targetMatch.status === 'open') setOpenViewMode('calendar')
            setSearchQuery('')
            setSelectedLeague('')
            if (targetMatch.status === 'finished') {
                setFinishedVisibleCounts(prev => ({ ...prev, [targetMatch.leagueName]: Number.MAX_SAFE_INTEGER }))
                setCollapsedLeagues(prev => ({ ...prev, [targetMatch.leagueName]: false }))
            }
            if (shouldOpenAudit && (targetMatch.registrationHistory || []).length > 0) {
                setHistoryModalMatch(targetMatch)
                setShowHistoryModal(true)
            }
        }
    }, [data, shouldOpenAudit, targetMatchId])

    useEffect(() => {
        if (!data || targetMatchId) return
        if (requestedStatus === 'open' || requestedStatus === 'in_progress' || requestedStatus === 'finished') {
            setActiveTab(requestedStatus)
        }
    }, [data, requestedStatus, targetMatchId])

    useEffect(() => {
        if (!data || !targetMatchId) return undefined

        let highlightTimer
        const scrollTimer = window.setTimeout(() => {
            const targetElement = document.getElementById(`all-match-${encodeURIComponent(targetMatchId)}`)
            if (!targetElement) return

            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setHighlightedMatchKey(targetMatchId)
            highlightTimer = window.setTimeout(() => setHighlightedMatchKey(null), 3500)
        }, 50)

        return () => {
            window.clearTimeout(scrollTimer)
            if (highlightTimer) window.clearTimeout(highlightTimer)
        }
    }, [activeTab, collapsedLeagues, data, finishedVisibleCounts, openViewMode, targetMatchId])

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

    const compareMatchNames = (a, b) => (
        `${a.leagueName || ''}|${a.subLeagueName || ''}|${a.name || ''}`
            .localeCompare(`${b.leagueName || ''}|${b.subLeagueName || ''}|${b.name || ''}`)
    )
    const compareUpcomingMatches = (a, b) => {
        const timeDifference = (a.startTime || 0) - (b.startTime || 0)
        return timeDifference || compareMatchNames(a, b)
    }
    const compareFinishedMatches = (a, b) => {
        const completedTimeDifference = (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0)
        const startTimeDifference = (b.startTime || 0) - (a.startTime || 0)
        return completedTimeDifference || startTimeDifference || compareMatchNames(a, b)
    }

    // Sort: open/in_progress ascending by startTime (next starting first); finished descending (most recent first)
    allMatches.open.sort(compareUpcomingMatches)
    allMatches.in_progress.sort(compareUpcomingMatches)
    allMatches.finished.sort(compareFinishedMatches)

    const formatDate = (timestamp) => {
        if (!timestamp) return 'Not started'
        return new Date(timestamp * 1000).toLocaleDateString()
    }

    const MatchRow = ({ match }) => {
        const matchKey = normalizeMatchId(match.matchId) || `${match.leagueName}-${match.subLeagueName}-${match.name || match.round}`
        // Calculate timeout info for this match
        const matchTimeouts = useMemo(() => {
            if (match.status === 'open') {
                const alertPlayers = getTimeoutRiskPlayers({
                    round: match,
                    timeoutData,
                    leagueName: match.leagueName,
                    subLeagueName: match.subLeagueName,
                })
                const highRiskPlayers = alertPlayers.filter(player => player.riskLevel === 'HIGH')
                return {
                    totalTimeouts: 0,
                    hasHighTimeout: highRiskPlayers.length > 0,
                    hasMonitoringRisk: alertPlayers.length > 0,
                    playersWithHighTimeout: highRiskPlayers.length,
                    alertPlayers,
                }
            }

            let totalTimeouts = 0
            const alertPlayers = []

            if (match.playerStats) {
                // In-progress / finished: count timeouts from playerStats
                Object.values(match.playerStats).forEach(stats => {
                    if (stats.timeouts) totalTimeouts += stats.timeouts
                })
            }

            return {
                totalTimeouts,
                hasHighTimeout: false,
                hasMonitoringRisk: alertPlayers.length > 0,
                playersWithHighTimeout: 0,
                alertPlayers,
            }
        }, [match, timeoutData])

        // Calculate warning conditions for registration matches
        const minRequired = match.minTeamPlayers || 0
        const ourCount = match.registeredPlayers?.our || 0

        const actionItem = actionItemsByMatchId.get(normalizeMatchId(match.matchId))
        const actionWarnings = actionItem?.warnings
        const hasActionItem = !!actionItem
        const hasWarning = hasActionItem
        const hasTimeoutWarning = match.status === 'open' && matchTimeouts.hasHighTimeout
        const hasAlert = hasWarning || hasTimeoutWarning
        const actionReasonLabels = actionWarnings ? [
            (actionWarnings.minNotMet || actionWarnings.playerDeficit) && 'Roster gap',
            actionWarnings.ratingDisadvantage && (actionWarnings.mismatchedBoardCount > 0 ? 'Board mismatch' : 'Rating disadvantage'),
            actionWarnings.surgeRecruitment && 'Registration surge',
            actionWarnings.hasTimeoutWarning && 'High timeout risk',
        ].filter(Boolean) : []

        // Early resignation banner — in-progress and finished matches only
        const earlyResignPlayers = (match.status === 'in_progress' || match.status === 'finished')
            ? getModalPlayersForMatch(earlyResignIndex, match.matchUrl || match.matchId)
            : []

        // Audit log
        const hasHistory = (match.registrationHistory ?? []).length > 0
        const hasOppRemovals = (match.registrationHistory ?? []).some(
            entry => entry.opp?.removed?.length > 0
        )

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
            <div
                id={`all-match-${encodeURIComponent(matchKey)}`}
                className={`card mb-3 overflow-hidden scroll-mt-[16vh] sm:scroll-mt-[22vh] transition-shadow ${cardBorder} ${highlightedMatchKey === matchKey ? 'ring-2 ring-chess-green ring-offset-2' : ''}`}
            >
                {/* Warning Banner */}
                {hasWarning && match.status === 'open' && (
                    <div className="bg-red-50 border-b-2 border-red-200 -mx-6 -mt-6 mb-2 p-3">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-red-700">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">⚠️</span>
                                    <span>Action Required <span className="font-normal text-red-600">· {actionReasonLabels.length} issue{actionReasonLabels.length !== 1 ? 's' : ''}</span></span>
                                </div>
                                {actionReasonLabels.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {actionReasonLabels.map(label => (
                                            <span key={label} className="rounded-full border border-red-200 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                                {label}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Link
                                to={`/action-items?matchId=${encodeURIComponent(normalizeMatchId(match.matchId))}`}
                                className="shrink-0 text-xs font-semibold text-red-700 hover:text-red-900 hover:underline whitespace-nowrap"
                            >
                                View Action Items →
                            </Link>
                        </div>
                    </div>
                )}

                {/* Timeout alerts for open matches */}
                {hasTimeoutWarning && (
                    <button
                        onClick={() => {
                            setModalTitle('Timeout Risk Details')
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
                                    <div className="text-xs text-amber-800 mt-0.5">{matchTimeouts.alertPlayers.length} player{matchTimeouts.alertPlayers.length !== 1 ? 's' : ''} to review</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-xs font-bold text-amber-700">
                                <span>View Details</span>
                                <span>→</span>
                            </div>
                        </div>
                    </button>
                )}

                {match.status === 'open' && matchTimeouts.hasMonitoringRisk && !hasTimeoutWarning && (
                    <button
                        onClick={() => {
                            setModalTitle('Timeout Risk Details')
                            setModalPlayers(matchTimeouts.alertPlayers)
                            setShowTimeoutModal(true)
                        }}
                        className={`w-[calc(100%+3.05rem)] bg-blue-50 border-b border-blue-200 -mx-6 p-3 mb-4 hover:bg-blue-100 transition-colors text-left ${!hasActionItem ? '-mt-6' : ''}`}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">⏱️</span>
                                <div>
                                    <div className="text-sm font-semibold text-blue-900">Timeout Monitoring</div>
                                    <div className="text-xs text-blue-800">{matchTimeouts.alertPlayers.length} at-risk player{matchTimeouts.alertPlayers.length !== 1 ? 's' : ''}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-xs font-bold text-blue-700">
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

                {/* Early resignation banner — finished / in-progress matches */}
                {(match.status === 'finished' || match.status === 'in_progress') && earlyResignPlayers.length > 0 && (
                    <button
                        onClick={() => {
                            setEarlyResignModalPlayers(earlyResignPlayers)
                            setShowEarlyResignModal(true)
                        }}
                        className={`w-[calc(100%+2rem)] text-left bg-rose-50 border-b border-rose-200 -mx-4 ${matchTimeouts.totalTimeouts > 0 ? 'mt-0' : '-mt-4'} mb-3 p-2 hover:bg-rose-100 transition-colors`}
                    >
                        <div className="flex items-center justify-between gap-2 text-xs font-medium text-rose-800">
                            <div className="flex items-center gap-2">
                                <span>🏳️</span>
                                <span>{earlyResignPlayers.length} early resignation{earlyResignPlayers.length !== 1 ? 's' : ''} in this match</span>
                            </div>
                            <span className="font-bold text-rose-700">View →</span>
                        </div>
                    </button>
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
                        {match.opponentClubId && clubIcons[match.opponentClubId] && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                                {clubIcons[match.opponentClubId].icon && (
                                    <img
                                        src={clubIcons[match.opponentClubId].icon}
                                        alt=""
                                        className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                                    />
                                )}
                                <span className="text-xs text-gray-500">{clubIcons[match.opponentClubId].name}</span>
                            </div>
                        )}
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
                    const cap = match.maxTeamPlayers || 0
                    const { ourRatings, oppRatings, ourAvg: ourAvgNum, oppAvg: oppAvgNum } = computeMatchupRatings(match.registrationData.ourRoster, match.registrationData.oppRoster, cap)
                    const ourAvg = ourAvgNum.toFixed(0)
                    const oppAvg = oppAvgNum.toFixed(0)
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
                    {(match.status === 'open' || match.status === 'in_progress') && hasHistory && (
                        <button
                            onClick={() => { setHistoryModalMatch(match); setShowHistoryModal(true) }}
                            className="ml-4 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                        >
                            <span>📋</span>
                            <span>Audit Log</span>
                            {hasOppRemovals && (
                                <span title="Opponent player(s) have left this match">⚠️</span>
                            )}
                        </button>
                    )}
                </div>
            </div>
        )
    }

    const renderMatches = (matches, emptyMessage, options = {}) => {
        const { calendar = false, paginateFinished = false } = options
        const q = searchQuery.trim().toLowerCase()
        const matchesQuery = match => {
            if (!q) return true
            const nameMatch = match.name?.toLowerCase().includes(q)
            const clubName = clubIcons[match.opponentClubId]?.name?.toLowerCase() || ''
            const clubIdMatch = match.opponentClubId?.toLowerCase().includes(q)
            return nameMatch || clubName.includes(q) || clubIdMatch
        }
        const filtered = matches.filter(matchesQuery)

        if (matches.length === 0) {
            return (
                <div className="card text-center py-12 text-gray-500">
                    {emptyMessage}
                </div>
            )
        }

        if (filtered.length === 0) {
            return (
                <div className="card text-center py-12 text-gray-500">
                    No matches found for &ldquo;{searchQuery.trim()}&rdquo;
                </div>
            )
        }

        if (calendar) {
            const byDate = {}
            filtered.forEach(match => {
                const dateKey = match.startTime
                    ? new Date(match.startTime * 1000).toLocaleDateString()
                    : 'No Date'
                if (!byDate[dateKey]) byDate[dateKey] = []
                byDate[dateKey].push(match)
            })

            const dateGroups = Object.entries(byDate).sort(([dateA, matchesA], [dateB, matchesB]) => {
                if (dateA === 'No Date') return 1
                if (dateB === 'No Date') return -1
                return (matchesA[0].startTime || 0) - (matchesB[0].startTime || 0)
            })

            return (
                <div className="space-y-6">
                    {dateGroups.map(([dateKey, dateMatches]) => (
                        <div key={dateKey}>
                            <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                                <span aria-hidden="true">📅</span>
                                {dateKey}
                            </h3>
                            <div className="space-y-2">
                                {dateMatches.map((match, idx) => (
                                    <MatchRow key={`${match.matchId}-${idx}`} match={match} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )
        }

        const byLeague = {}
        filtered.forEach(match => {
            if (!byLeague[match.leagueName]) byLeague[match.leagueName] = []
            byLeague[match.leagueName].push(match)
        })

        return (
            <div className="space-y-6">
                {Object.entries(byLeague).map(([leagueName, leagueMatches]) => {
                    const isCollapsed = !!collapsedLeagues[leagueName]
                    const visibleCount = paginateFinished
                        ? Math.min(finishedVisibleCounts[leagueName] || 5, leagueMatches.length)
                        : leagueMatches.length
                    const renderedMatches = paginateFinished
                        ? leagueMatches.slice(0, visibleCount)
                        : leagueMatches
                    const hasMore = paginateFinished && visibleCount < leagueMatches.length

                    return (
                        <div key={leagueName} className="border border-gray-200 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setCollapsedLeagues(prev => ({ ...prev, [leagueName]: !prev[leagueName] }))}
                                aria-expanded={!isCollapsed}
                                aria-controls={`matches-${leagueName}`}
                                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                            >
                                <h3 className="text-xl font-bold text-chess-dark">
                                    {leagueName} <span className="text-base font-normal text-gray-500">({leagueMatches.length})</span>
                                </h3>
                                <svg
                                    className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {!isCollapsed && (
                                <div id={`matches-${leagueName}`} className="p-3 space-y-2">
                                    {renderedMatches.map((match, idx) => (
                                        <MatchRow key={`${match.matchId}-${idx}`} match={match} />
                                    ))}
                                    {paginateFinished && (
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 mt-3">
                                            <span className="text-xs text-gray-500">
                                                Showing {renderedMatches.length} of {leagueMatches.length}
                                            </span>
                                            <div className="flex items-center gap-3">
                                                {hasMore && (
                                                    <button
                                                        onClick={() => setFinishedVisibleCounts(prev => ({
                                                            ...prev,
                                                            [leagueName]: visibleCount + 5
                                                        }))}
                                                        aria-expanded={false}
                                                        className="text-sm font-medium text-chess-green hover:text-green-700 hover:underline"
                                                    >
                                                        Show 5 more
                                                    </button>
                                                )}
                                                {visibleCount > 5 && (
                                                    <button
                                                        onClick={() => setFinishedVisibleCounts(prev => ({
                                                            ...prev,
                                                            [leagueName]: 5
                                                        }))}
                                                        aria-expanded={true}
                                                        className="text-sm font-medium text-gray-600 hover:text-gray-800 hover:underline"
                                                    >
                                                        Show less
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
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

            {/* Search */}
            <div className="mb-6">
                <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search by match name or opponent club…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-chess-green focus:border-transparent"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            aria-label="Clear search"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* Quick league filters */}
            <div className="mb-4">
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={() => setSelectedLeague('')}
                        className={`px-3 py-1 rounded text-sm font-medium ${selectedLeague === '' ? 'bg-chess-green text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                        All
                    </button>
                    {leagueOptions.map(league => (
                        <button
                            key={league}
                            onClick={() => setSelectedLeague(league)}
                            className={`px-3 py-1 rounded text-sm font-medium inline-flex items-center gap-2 ${selectedLeague === league ? 'bg-chess-green text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                        >
                            <span>{league}</span>
                            <span className="inline-flex items-center gap-1">
                                <span className="text-[10px] bg-blue-100 text-blue-800 px-1 rounded-full">{leagueCounts[league]?.open || 0}</span>
                                <span className="text-[10px] bg-yellow-100 text-yellow-800 px-1 rounded-full">{leagueCounts[league]?.in_progress || 0}</span>
                                <span className="text-[10px] bg-gray-100 text-gray-800 px-1 rounded-full">{leagueCounts[league]?.finished || 0}</span>
                            </span>
                        </button>
                    ))}
                </div>
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

            {activeTab === 'open' && (
                <div className="mb-6 flex justify-end">
                    <div
                        role="group"
                        aria-label="Open match layout"
                        className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1"
                    >
                        <button
                            type="button"
                            onClick={() => setOpenViewMode('calendar')}
                            aria-pressed={openViewMode === 'calendar'}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${openViewMode === 'calendar'
                                ? 'bg-white text-chess-green shadow-sm'
                                : 'text-gray-600 hover:text-gray-800'
                                }`}
                        >
                            Calendar
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpenViewMode('league')}
                            aria-pressed={openViewMode === 'league'}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${openViewMode === 'league'
                                ? 'bg-white text-chess-green shadow-sm'
                                : 'text-gray-600 hover:text-gray-800'
                                }`}
                        >
                            By league
                        </button>
                    </div>
                </div>
            )}

            {/* Tab Content */}
            {activeTab === 'open' && renderMatches(
                selectedLeague ? allMatches.open.filter(m => m.leagueName === selectedLeague) : allMatches.open,
                'No matches open for registration',
                { calendar: openViewMode === 'calendar' })}
            {activeTab === 'in_progress' && renderMatches(
                selectedLeague ? allMatches.in_progress.filter(m => m.leagueName === selectedLeague) : allMatches.in_progress,
                'No matches in progress')}
            {activeTab === 'finished' && renderMatches(
                selectedLeague ? allMatches.finished.filter(m => m.leagueName === selectedLeague) : allMatches.finished,
                'No finished matches',
                { paginateFinished: true })}

            {/* Timeout Modal */}
            <TimeoutModal
                isOpen={showTimeoutModal}
                onClose={() => setShowTimeoutModal(false)}
                title={modalTitle}
                players={modalPlayers}
                threshold={timeoutData?.riskThresholdPercent ?? 25}
                highPct={timeoutData?.riskConfig?.highTimeoutPct ?? 50}
            />

            {/* Early Resign Modal */}
            <EarlyResignModal
                isOpen={showEarlyResignModal}
                onClose={() => setShowEarlyResignModal(false)}
                title="Early Resignation History"
                players={earlyResignModalPlayers}
            />

            {/* Audit Log Modal */}
            <AuditLogModal
                isOpen={showHistoryModal}
                onClose={() => { setShowHistoryModal(false); setHistoryModalMatch(null) }}
                matchName={historyModalMatch?.name || historyModalMatch?.round || 'Match'}
                history={historyModalMatch?.registrationHistory ?? []}
                ourTeamName={ourSiteName}
                oppTeamName={clubIcons?.[historyModalMatch?.opponentClubId]?.name || 'Opponent'}
                ourRoster={historyModalMatch?.registrationData?.ourRoster ?? []}
                oppRoster={historyModalMatch?.registrationData?.oppRoster ?? []}
            />
        </div>
    )
}

export default AllMatches
