import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'
import AuditLogModal from '../components/AuditLogModal'
import { collectActionItems, normalizeMatchId } from '../utils/actionItemUtils'
import { buildEarlyResignationHistory, getRecentEarlyResignations } from '../utils/earlyResignUtils'
import { buildTimeoutHistory, getRecentDetectedTimeoutPlayers } from '../utils/timeoutHistoryUtils'

const UPCOMING_MATCH_LIMIT = 5
const RECENT_ACTIVITY_LIMIT = 3
const RECENT_ACTIVITY_DAYS = 7
const OPPONENT_REMOVAL_WINDOW_DAYS = 7
const DASHBOARD_STORAGE_KEY = `dashboard-layout:${__SITE_KEY__}`
const DEFAULT_DASHBOARD_ORDER = [
    'actionItems',
    'upcomingMatches',
    'earlyResignations',
    'recentTimeouts',
    'opponentRemovals',
    'recentFinished',
    'allLeagues',
    'quickStats',
]
const DASHBOARD_TILES = [
    { id: 'actionItems', label: 'Action Items' },
    { id: 'upcomingMatches', label: 'Upcoming Matches' },
    { id: 'earlyResignations', label: 'Early Resignations' },
    { id: 'recentTimeouts', label: 'Recent Timeout History' },
    { id: 'opponentRemovals', label: 'Opponent Roster Removals' },
    { id: 'recentFinished', label: 'Recently Finished Matches' },
    { id: 'allLeagues', label: 'All Leagues' },
    { id: 'quickStats', label: 'Quick Stats' },
]

function getDefaultDashboardPreferences() {
    return { order: [...DEFAULT_DASHBOARD_ORDER], hidden: [] }
}

function loadDashboardPreferences() {
    const fallback = getDefaultDashboardPreferences()
    try {
        const saved = JSON.parse(window.localStorage.getItem(DASHBOARD_STORAGE_KEY) || 'null')
        if (!saved) return fallback

        const savedOrder = Array.isArray(saved.order) ? saved.order : []
        const order = [
            ...savedOrder.filter(id => DEFAULT_DASHBOARD_ORDER.includes(id)),
            ...DEFAULT_DASHBOARD_ORDER.filter(id => !savedOrder.includes(id)),
        ].filter((id, index, values) => values.indexOf(id) === index)
        const hidden = Array.isArray(saved.hidden)
            ? saved.hidden.filter(id => DEFAULT_DASHBOARD_ORDER.includes(id))
            : []

        return { order, hidden: [...new Set(hidden)] }
    } catch {
        return fallback
    }
}

function toTimestamp(value) {
    if (value === null || value === undefined || value === '') return null

    const numericValue = Number(value)
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue > 100000000000 ? numericValue / 1000 : numericValue
    }

    const parsedValue = Date.parse(value)
    return Number.isFinite(parsedValue) ? parsedValue / 1000 : null
}

function getLeagueStats(leagueData) {
    let totalRounds = 0
    const statusCounts = { open: 0, in_progress: 0, finished: 0 }
    const totalPlayers = new Set()

    Object.values(leagueData.subLeagues || {}).forEach(subLeague => {
        totalRounds += (subLeague.rounds || []).length
            ; (subLeague.rounds || []).forEach(round => {
                if (statusCounts[round.status] !== undefined) statusCounts[round.status]++
            })
            ; (subLeague.leaderboard || []).forEach(player => totalPlayers.add(player.username))
    })

    return { totalRounds, statusCounts, totalPlayers: totalPlayers.size }
}

function formatMatchStart(startTime, includeWeekday = true) {
    const timestamp = Number(startTime)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Start date unavailable'

    return new Date(timestamp * 1000).toLocaleString(undefined, {
        weekday: includeWeekday ? 'short' : undefined,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

function formatMatchScore(matchResult) {
    const ourScore = Number(matchResult?.ourScore)
    const opponentScore = Number(matchResult?.opponentScore)
    if (!Number.isFinite(ourScore) || !Number.isFinite(opponentScore)) return 'Score unavailable'
    return `${ourScore}–${opponentScore}`
}

function getMatchResultLabel(result) {
    const normalizedResult = String(result || '').toLowerCase()
    if (normalizedResult.includes('win')) return 'Win'
    if (normalizedResult.includes('draw')) return 'Draw'
    if (normalizedResult) return 'Loss'
    return 'Result unavailable'
}

function getMatchResultClass(result) {
    const label = getMatchResultLabel(result)
    if (label === 'Win') return 'text-green-700'
    if (label === 'Loss') return 'text-red-700'
    return 'text-gray-600'
}

function actionItemSummary(warnings) {
    const reasons = []
    if (warnings.minNotMet) reasons.push('Minimum roster')
    if (warnings.playerDeficit) reasons.push('Player deficit')
    if (warnings.mismatchedBoardCount > 0) {
        reasons.push(`${warnings.mismatchedBoardCount} board${warnings.mismatchedBoardCount === 1 ? '' : 's'} mismatched`)
    }
    if (warnings.surgeRecruitment) reasons.push('Opponent surge')
    if (warnings.hasTimeoutWarning) reasons.push('High timeout risk')
    return reasons.join(' · ') || 'Review match details'
}

function getRecentOpponentRosterRemovals(data, days = OPPONENT_REMOVAL_WINDOW_DAYS) {
    if (!data?.leagues) return []

    const cutoff = (Date.now() / 1000) - (days * 24 * 60 * 60)
    const removals = []

    Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
        Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
            ; (subLeagueData.rounds || []).forEach(round => {
                ; (round.registrationHistory || []).forEach(entry => {
                    const timestamp = toTimestamp(entry.ts)
                    if (timestamp === null || timestamp < cutoff) return

                    const removedCount = (entry.opp?.removed || []).length
                    if (removedCount === 0) return

                    removals.push({
                        timestamp,
                        leagueName,
                        subLeagueName,
                        matchId: round.matchId,
                        matchName: round.name || round.round,
                        history: round.registrationHistory || [],
                        ourRoster: round.registrationData?.ourRoster || [],
                        oppRoster: round.registrationData?.oppRoster || [],
                        removedCount,
                    })
                })
            })
        })
    })

    return removals.sort((left, right) => right.timestamp - left.timestamp)
}

function leaguePath(leagueName) {
    return `/league/${encodeURIComponent(leagueName)}`
}

function subLeaguePath(leagueName, subLeagueName) {
    return `/league/${encodeURIComponent(leagueName)}/${encodeURIComponent(subLeagueName)}`
}

function matchCalendarPath(match) {
    const matchId = normalizeMatchId(match.matchId)
    return matchId
        ? `/matches?matchId=${encodeURIComponent(matchId)}`
        : subLeaguePath(match.leagueName, match.subLeagueName)
}

function Home() {
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [timeoutHistoryData, setTimeoutHistoryData] = useState(null)
    const [earlyResignData, setEarlyResignData] = useState(null)
    const [auditLogMatch, setAuditLogMatch] = useState(null)
    const [dashboardPreferences, setDashboardPreferences] = useState(loadDashboardPreferences)
    const [showDashboardSettings, setShowDashboardSettings] = useState(false)
    const [draggedDashboardTile, setDraggedDashboardTile] = useState(null)
    const [dragOverDashboardTile, setDragOverDashboardTile] = useState(null)
    const dashboardPointerDrag = useRef(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        try {
            window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(dashboardPreferences))
        } catch {
            // Preferences still work for the current session when storage is unavailable.
        }
    }, [dashboardPreferences])

    const hiddenDashboardTiles = useMemo(() => new Set(dashboardPreferences.hidden), [dashboardPreferences.hidden])
    const dashboardTileStyle = tileId => ({ order: dashboardPreferences.order.indexOf(tileId) })
    const dashboardTileClass = (tileId, className = '') => (
        `${className} h-full ${tileId === 'quickStats' ? '' : 'min-h-[22rem]'} flex flex-col ${hiddenDashboardTiles.has(tileId) ? 'hidden' : ''}`.trim()
    )

    const reorderDashboardTile = (sourceId, targetId, placeAfter = false) => {
        setDashboardPreferences(previous => {
            const order = [...previous.order]
            const sourceIndex = order.indexOf(sourceId)
            if (sourceIndex < 0) return previous

            const [movedTile] = order.splice(sourceIndex, 1)
            if (!targetId) {
                order.push(movedTile)
            } else {
                const targetIndex = order.indexOf(targetId)
                if (targetIndex < 0) return previous
                order.splice(targetIndex + (placeAfter ? 1 : 0), 0, movedTile)
            }

            return { ...previous, order }
        })
    }

    const getDashboardSettingsRowAtPoint = (clientX, clientY) => {
        const target = document.elementFromPoint(clientX, clientY)?.closest('[data-dashboard-settings-tile-id]')
        return target || null
    }

    const handleDashboardSettingsPointerDown = (event, tileId) => {
        if (event.button !== 0 || event.target.closest('input, button')) return

        event.preventDefault()

        const drag = {
            tileId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            isDragging: false,
        }
        const clearDrag = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', clearDrag)
            dashboardPointerDrag.current = null
            setDraggedDashboardTile(null)
            setDragOverDashboardTile(null)
        }

        const handlePointerMove = moveEvent => {
            if (moveEvent.pointerId !== drag.pointerId) return

            const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY)
            if (!drag.isDragging && distance < 8) return

            if (!drag.isDragging) {
                drag.isDragging = true
                setDraggedDashboardTile(drag.tileId)
            }

            moveEvent.preventDefault()
            const target = getDashboardSettingsRowAtPoint(moveEvent.clientX, moveEvent.clientY)
            const targetId = target?.dataset.dashboardSettingsTileId || null
            drag.targetId = targetId
            setDragOverDashboardTile(previous => previous === targetId ? previous : targetId)
        }

        const handlePointerUp = upEvent => {
            if (upEvent.pointerId !== drag.pointerId) return

            if (drag.isDragging) {
                upEvent.preventDefault()
                const target = getDashboardSettingsRowAtPoint(upEvent.clientX, upEvent.clientY)
                const targetId = target?.dataset.dashboardSettingsTileId || drag.targetId
                if (targetId && targetId !== drag.tileId) {
                    const targetBounds = target?.getBoundingClientRect()
                    const placeAfter = targetBounds ? upEvent.clientY > targetBounds.top + (targetBounds.height / 2) : false
                    reorderDashboardTile(drag.tileId, targetId, placeAfter)
                }
            }

            clearDrag()
        }

        dashboardPointerDrag.current = drag
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', clearDrag)
    }

    const dashboardSettingsRowPointerProps = tileId => ({
        'data-dashboard-settings-tile-id': tileId,
        onPointerDown: event => handleDashboardSettingsPointerDown(event, tileId),
    })

    const toggleDashboardTile = tileId => {
        setDashboardPreferences(previous => ({
            ...previous,
            hidden: previous.hidden.includes(tileId)
                ? previous.hidden.filter(id => id !== tileId)
                : [...previous.hidden, tileId],
        }))
    }
    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(response => {
                if (!response.ok) throw new Error('Failed to load league data')
                return response.json()
            }),
            fetch('/data/timeoutData.json').then(response => response.json()).catch(() => null),
            fetch('/data/timeout_history.json').then(response => response.json()).catch(() => null),
            fetch('/data/earlyResignations.json').then(response => response.json()).catch(() => null),
        ])
            .then(([leagueData, timeoutJson, timeoutHistoryJson, earlyResignJson]) => {
                setData(leagueData)
                setTimeoutData(timeoutJson)
                setTimeoutHistoryData(timeoutHistoryJson)
                setEarlyResignData(earlyResignJson)
                setLoading(false)
            })
            .catch(err => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    const actionItems = useMemo(() => collectActionItems(data, timeoutData), [data, timeoutData])
    const pressingActionItems = useMemo(() => {
        const now = Date.now() / 1000
        const nextWeek = now + (7 * 24 * 60 * 60)

        return actionItems.filter(match => {
            const startTime = Number(match.startTime)
            return Number.isFinite(startTime) && startTime >= now && startTime <= nextWeek
        })
    }, [actionItems])
    const earlyResignationHistory = useMemo(
        () => buildEarlyResignationHistory(earlyResignData, data),
        [earlyResignData, data]
    )
    const recentEarlyResignations = useMemo(
        () => getRecentEarlyResignations(earlyResignationHistory),
        [earlyResignationHistory]
    )
    const timeoutHistory = useMemo(() => buildTimeoutHistory(data), [data])
    const recentTimeoutPlayers = useMemo(
        () => getRecentDetectedTimeoutPlayers(timeoutHistory, timeoutHistoryData, 7),
        [timeoutHistory, timeoutHistoryData]
    )
    const recentTimeoutCount = recentTimeoutPlayers.reduce((sum, player) => sum + player.totalTimeouts, 0)
    const leagueEntries = data ? Object.entries(data.leagues || {}) : []

    const upcomingMatches = useMemo(() => {
        if (!data?.leagues) return []

        const now = Date.now() / 1000
        const matches = []
        Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
            Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
                ; (subLeagueData.rounds || []).forEach(round => {
                    const startTime = Number(round.startTime)
                    if (round.status !== 'open') return
                    if (Number.isFinite(startTime) && startTime > 0 && startTime < now) return
                    matches.push({ ...round, leagueName, subLeagueName })
                })
            })
        })

        return matches
            .sort((left, right) => {
                const leftTime = Number.isFinite(Number(left.startTime)) && Number(left.startTime) > 0
                    ? Number(left.startTime)
                    : Infinity
                const rightTime = Number.isFinite(Number(right.startTime)) && Number(right.startTime) > 0
                    ? Number(right.startTime)
                    : Infinity
                return leftTime - rightTime
                    || `${left.leagueName}|${left.subLeagueName}|${left.name || ''}`
                        .localeCompare(`${right.leagueName}|${right.subLeagueName}|${right.name || ''}`)
            })
    }, [data])

    const recentFinishedMatches = useMemo(() => {
        if (!data?.leagues) return []

        const cutoff = (Date.now() / 1000) - (RECENT_ACTIVITY_DAYS * 24 * 60 * 60)
        const matches = []

        Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
            Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
                ; (subLeagueData.rounds || []).forEach(round => {
                    const endTime = toTimestamp(round.endTime)
                    if (round.status !== 'finished' || endTime === null || endTime < cutoff) return
                    matches.push({ ...round, leagueName, subLeagueName, endTime })
                })
            })
        })

        return matches.sort((left, right) => right.endTime - left.endTime)
    }, [data])

    const recentOpponentRosterRemovals = useMemo(
        () => getRecentOpponentRosterRemovals(data),
        [data]
    )

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

    return (
        <div className="page-container">
            <div className="mb-8">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h2>
                        <p className="mt-1 text-sm text-gray-500">
                            Last updated: {new Date(data.lastUpdated).toLocaleString()}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowDashboardSettings(previous => !previous)}
                        aria-expanded={showDashboardSettings}
                        className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-chess-green hover:text-chess-green"
                    >
                        Customize
                    </button>
                </div>
            </div>

            {showDashboardSettings && (
                <section className="mb-8 card border border-gray-200" aria-label="Customize dashboard">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">Customize dashboard</h3>
                            <p className="mt-1 text-sm text-gray-600">
                                Choose which tiles appear, then drag these rows to arrange the dashboard.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setDashboardPreferences(getDefaultDashboardPreferences())}
                            className="text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline"
                        >
                            Reset layout
                        </button>
                    </div>
                    <p className="mt-4 text-sm text-gray-500">Drag a row to its new position. Your layout saves automatically.</p>
                    <div className="mt-3 grid gap-2 [&>div>span]:hidden" role="list" aria-label="Dashboard tile visibility">
                        {dashboardPreferences.order.map((tileId, index) => {
                            const tile = DASHBOARD_TILES.find(item => item.id === tileId)
                            const isVisible = !hiddenDashboardTiles.has(tileId)
                            return (
                                <div
                                    key={tileId}
                                    role="listitem"
                                    aria-label={`Drag ${tile?.label || tileId} to reorder`}
                                    {...dashboardSettingsRowPointerProps(tileId)}
                                    className={`flex cursor-grab touch-none select-none items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors active:cursor-grabbing ${draggedDashboardTile === tileId
                                        ? 'border-chess-green bg-green-50 opacity-60'
                                        : dragOverDashboardTile === tileId
                                            ? 'border-chess-green bg-green-50'
                                            : 'border-gray-200 bg-white'
                                        }`}
                                >
                                    <label className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={isVisible}
                                            onChange={() => toggleDashboardTile(tileId)}
                                            className="h-4 w-4 rounded border-gray-300 text-chess-green focus:ring-chess-green"
                                        />
                                        <span className="truncate">{tile?.label || tileId}</span>
                                    </label>
                                    <button
                                        type="button"
                                        aria-hidden="true"
                                        tabIndex={-1}
                                        className="hidden"
                                    >
                                        Drag
                                    </button>
                                    <span className="shrink-0 text-lg leading-none text-gray-400" aria-hidden="true">☷</span>
                                    <div className="hidden">
                                        <button
                                            type="button"
                                            onClick={() => {}}
                                            disabled={index === 0}
                                            aria-label={`Move ${tile?.label || tileId} up`}
                                            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            ↑
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {}}
                                            disabled={index === dashboardPreferences.order.length - 1}
                                            aria-label={`Move ${tile?.label || tileId} down`}
                                            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            ↓
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>
            )}

            <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="contents">
                <section
                    className={dashboardTileClass('actionItems', 'card')}
                    style={dashboardTileStyle('actionItems')}
                >
                    <div className="mb-4">
                        <div>
                            <h3 className="text-2xl font-bold text-gray-900">Action Items</h3>
                            <p className="mt-1 text-sm text-gray-600">
                                {actionItems.length > 0
                                    ? `${actionItems.length} match${actionItems.length === 1 ? '' : 'es'} need review`
                                    : 'No open matches currently need attention'}
                            </p>
                        </div>
                    </div>

                    {actionItems.length === 0 ? (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                            All open matches are currently set up without a flagged issue.
                        </div>
                    ) : pressingActionItems.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                            No action items are due in the next 7 days.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {pressingActionItems.slice(0, 4).map(match => {
                                const matchId = normalizeMatchId(match.matchId)
                                const actionItemHref = matchId
                                    ? `/action-items?matchId=${encodeURIComponent(matchId)}`
                                    : '/action-items'
                                return (
                                    <Link
                                        key={matchId || `${match.leagueName}-${match.subLeagueName}-${match.name}`}
                                        to={actionItemHref}
                                        className="block rounded-lg border border-gray-200 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold text-chess-dark">{match.subLeagueName}</div>
                                                <div className="mt-1 truncate text-xs text-gray-600">{match.name || match.round}</div>
                                                <div className="mt-2 text-xs font-medium text-red-700">{actionItemSummary(match.warnings)}</div>
                                            </div>
                                            <span className="shrink-0 text-xs text-gray-500">
                                                {formatMatchStart(match.startTime, false)}
                                            </span>
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    )}
                    {actionItems.length > 0 && (
                        <div className="mt-4 border-t border-gray-200 pt-3 text-right">
                            <Link to="/action-items" className="text-sm font-medium text-chess-green hover:underline">
                                View all {actionItems.length}
                            </Link>
                        </div>
                    )}
                </section>

                <section
                    className={dashboardTileClass('upcomingMatches', 'card')}
                    style={dashboardTileStyle('upcomingMatches')}
                >
                    <div className="mb-4">
                        <div>
                            <h3 className="text-2xl font-bold text-gray-900">Upcoming Matches</h3>
                            <p className="mt-1 text-sm text-gray-600">The next open matches by local start time</p>
                        </div>
                    </div>

                    {upcomingMatches.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                            No upcoming open matches found.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {upcomingMatches.slice(0, UPCOMING_MATCH_LIMIT).map(match => (
                                <Link
                                    key={match.matchId || `${match.leagueName}-${match.subLeagueName}-${match.name}`}
                                    to={matchCalendarPath(match)}
                                    className="block rounded-lg border border-gray-200 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-chess-dark">{match.subLeagueName}</div>
                                            <div className="mt-1 truncate text-xs text-gray-600">{match.name || match.round}</div>
                                            <div className="mt-2 text-xs text-gray-500">{match.leagueName}</div>
                                        </div>
                                        <span className="shrink-0 text-right text-xs font-medium text-chess-green">
                                            {formatMatchStart(match.startTime)}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                    {upcomingMatches.length > 0 && (
                        <div className="mt-4 border-t border-gray-200 pt-3 text-right">
                            <Link to="/matches" className="text-sm font-medium text-chess-green hover:underline">
                                Browse all {upcomingMatches.length}
                            </Link>
                        </div>
                    )}
                </section>
            </div>

            <div className="contents">
            <section
                className={dashboardTileClass('earlyResignations', 'card')}
                style={dashboardTileStyle('earlyResignations')}
            >
                    <div className="mb-4">
                        <h3 className="text-2xl font-bold text-gray-900">Early Resignations</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {recentEarlyResignations.length > 0
                                ? `${recentEarlyResignations.reduce((sum, record) => sum + record.totalGames, 0)} early resignation${recentEarlyResignations.reduce((sum, record) => sum + record.totalGames, 0) === 1 ? '' : 's'} across ${recentEarlyResignations.length} match${recentEarlyResignations.length === 1 ? '' : 'es'} in the past 7 days`
                                : 'No early resignations recorded in the past 7 days'}
                        </p>
                    </div>

                    {recentEarlyResignations.length > 0 && (
                        <div className="space-y-3">
                            {recentEarlyResignations.slice(0, 4).map(record => (
                                <Link
                                    key={record.matchUrl}
                                    to="/early-resignations"
                                    className="block rounded-lg border border-gray-200 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-chess-dark">{record.subLeagueName}</div>
                                            <div className="mt-1 truncate text-xs text-gray-600">{record.name}</div>
                                            <div className="mt-2 text-xs text-gray-500">
                                                {record.totalGames} early resignation{record.totalGames !== 1 ? 's' : ''} · {record.players.map(player => player.username).join(', ')}
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-right text-xs text-gray-500">
                                            {record.activityTime
                                                ? new Date(record.activityTime * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                                : 'Date unavailable'}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}

                    {earlyResignationHistory.length > 0 && (
                        <div className="mt-4 border-t border-gray-200 pt-3 text-right">
                            <Link to="/early-resignations" className="text-sm font-medium text-chess-green hover:underline">
                                View full history ({earlyResignationHistory.length} matches)
                            </Link>
                        </div>
                    )}
                </section>

                <section
                    className={dashboardTileClass('recentTimeouts', 'card')}
                    style={dashboardTileStyle('recentTimeouts')}
                >
                    <div className="mb-4">
                        <h3 className="text-2xl font-bold text-gray-900">Recent Timeout History</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {recentTimeoutPlayers.length > 0
                                ? `${recentTimeoutCount} timeout${recentTimeoutCount === 1 ? '' : 's'} detected for ${recentTimeoutPlayers.length} player${recentTimeoutPlayers.length === 1 ? '' : 's'} in the past 7 days`
                                : 'No timeouts detected in the past 7 days'}
                        </p>
                    </div>

                    {recentTimeoutPlayers.length > 0 && (
                        <div className="space-y-3">
                            {recentTimeoutPlayers.slice(0, 4).map(player => (
                                <Link
                                    key={player.username}
                                    to={`/timeouts?player=${encodeURIComponent(player.username)}`}
                                    className="block rounded-lg border border-gray-200 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-chess-dark">{player.username}</div>
                                            <div className="mt-1 text-xs text-gray-600">
                                                {player.totalTimeouts} timeout{player.totalTimeouts !== 1 ? 's' : ''} across {player.matches.length} match{player.matches.length !== 1 ? 'es' : ''}
                                            </div>
                                            <div className="mt-2 truncate text-xs text-gray-500">Most recent: {player.matches[0].name}</div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}

                    {timeoutHistory.players.length > 0 && (
                        <div className="mt-4 border-t border-gray-200 pt-3 text-right">
                            <Link to="/timeouts" className="text-sm font-medium text-chess-green hover:underline">
                                View full timeout history ({timeoutHistory.players.length} players)
                            </Link>
                        </div>
                    )}
                </section>
            </div>

            <div className="contents">
                <section
                    className={dashboardTileClass('opponentRemovals', 'card')}
                    style={dashboardTileStyle('opponentRemovals')}
                >
                    <div className="mb-4">
                        <h3 className="text-xl font-bold text-gray-900">Opponent Roster Removals</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {recentOpponentRosterRemovals.length > 0
                                ? `${recentOpponentRosterRemovals.length} removal${recentOpponentRosterRemovals.length === 1 ? '' : 's'} in the past 7 days`
                                : 'No opponent roster removals in the past 7 days'}
                        </p>
                    </div>

                    {recentOpponentRosterRemovals.length > 0 ? (
                        <div className="space-y-3">
                            {recentOpponentRosterRemovals.slice(0, RECENT_ACTIVITY_LIMIT).map((removal, index) => (
                                <button
                                    type="button"
                                    key={`${removal.leagueName}-${removal.subLeagueName}-${removal.matchId || removal.matchName}-${removal.timestamp}-${index}`}
                                    onClick={() => setAuditLogMatch(removal)}
                                    className="block w-full rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-chess-green hover:bg-green-50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-chess-dark">{removal.matchName}</div>
                                            <div className="mt-1 truncate text-xs text-gray-500">
                                                {removal.subLeagueName} / {removal.leagueName}
                                            </div>
                                            <div className="mt-1 text-xs text-gray-600">
                                                {removal.removedCount} opponent player{removal.removedCount === 1 ? '' : 's'} removed
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-right text-xs text-gray-500">
                                            {new Date(removal.timestamp * 1000).toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                            Opponent-side roster removals will appear here when recorded.
                        </div>
                    )}
                </section>

                <section
                    className={dashboardTileClass('recentFinished', 'card')}
                    style={dashboardTileStyle('recentFinished')}
                >
                    <div className="mb-4">
                        <h3 className="text-xl font-bold text-gray-900">Recently Finished Matches</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {recentFinishedMatches.length > 0
                                ? `${recentFinishedMatches.length} finished in the past 7 days`
                                : 'No matches finished in the past 7 days'}
                        </p>
                    </div>

                    {recentFinishedMatches.length > 0 ? (
                        <div className="space-y-3">
                            {recentFinishedMatches.slice(0, RECENT_ACTIVITY_LIMIT).map(match => (
                                <Link
                                    key={normalizeMatchId(match.matchId) || `${match.leagueName}-${match.subLeagueName}-${match.name}`}
                                    to={normalizeMatchId(match.matchId)
                                        ? `/matches?status=finished&matchId=${encodeURIComponent(normalizeMatchId(match.matchId))}`
                                        : subLeaguePath(match.leagueName, match.subLeagueName)}
                                    className="block rounded-lg border border-gray-200 p-3 transition-colors hover:border-chess-green hover:bg-green-50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-chess-dark">{match.name || match.round}</div>
                                            <div className="mt-1 truncate text-xs text-gray-600">{match.subLeagueName}</div>
                                            <div className="mt-1 truncate text-xs text-gray-500">{match.leagueName}</div>
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                                <span className="font-semibold text-gray-800">
                                                    {formatMatchScore(match.matchResult)}
                                                </span>
                                                <span className={`font-semibold ${getMatchResultClass(match.matchResult?.result)}`}>
                                                    {getMatchResultLabel(match.matchResult?.result)}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-right text-xs text-gray-500">
                                            {new Date(match.endTime * 1000).toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                            Finished matches from the past week will appear here.
                        </div>
                    )}

                </section>
            </div>

            <section
                className={dashboardTileClass('allLeagues', 'card lg:col-span-2')}
                style={dashboardTileStyle('allLeagues')}
            >
                <div className="mb-4">
                    <h3 className="text-2xl font-bold text-gray-900">All Leagues</h3>
                    <p className="mt-1 text-sm text-gray-600">Browse every tracked league and view its current activity.</p>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {leagueEntries.map(([leagueName, leagueData]) => {
                        const stats = getLeagueStats(leagueData)
                        return (
                            <div key={leagueName} className="card-hover">
                                <div className="mb-4">
                                    <Link to={leaguePath(leagueName)} className="text-2xl font-bold text-chess-dark hover:text-chess-green">
                                        {leagueName}
                                    </Link>
                                </div>

                                <Link to={leaguePath(leagueName)} className="block">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-600">Sub-leagues:</span>
                                            <span className="text-lg font-semibold">{Object.keys(leagueData.subLeagues || {}).length}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-600">Total rounds:</span>
                                            <span className="text-lg font-semibold">{stats.totalRounds}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-600">Players:</span>
                                            <span className="text-lg font-semibold">{stats.totalPlayers}</span>
                                        </div>
                                        <div className="border-t border-gray-200 pt-3">
                                            <div className="flex flex-wrap gap-2">
                                                {stats.statusCounts.open > 0 && <StatusBadge status="open" count={stats.statusCounts.open} />}
                                                {stats.statusCounts.in_progress > 0 && <StatusBadge status="in_progress" count={stats.statusCounts.in_progress} />}
                                                {stats.statusCounts.finished > 0 && <StatusBadge status="finished" count={stats.statusCounts.finished} />}
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            </div>
                        )
                    })}
                </div>
            </section>

            <div
                className={dashboardTileClass('quickStats', 'card bg-gradient-to-r from-chess-dark to-gray-700 text-white lg:col-span-2')}
                style={dashboardTileStyle('quickStats')}
            >
                <h3 className="mb-4 text-xl font-bold">Quick Stats</h3>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div className="text-center">
                        <div className="text-3xl font-bold">{leagueEntries.length}</div>
                        <div className="text-sm text-gray-300">Leagues</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-bold">{data.globalLeaderboard?.length || 0}</div>
                        <div className="text-sm text-gray-300">Players</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-bold">
                            {leagueEntries.reduce((sum, [, league]) => sum + Object.keys(league.subLeagues || {}).length, 0)}
                        </div>
                        <div className="text-sm text-gray-300">Sub-leagues</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-bold">
                            {leagueEntries.reduce((sum, [, league]) => sum + Object.values(league.subLeagues || {}).reduce((subSum, subLeague) => subSum + (subLeague.rounds || []).length, 0), 0)}
                        </div>
                        <div className="text-sm text-gray-300">Rounds</div>
                    </div>
                </div>
            </div>

            </div>

            <AuditLogModal
                isOpen={!!auditLogMatch}
                onClose={() => setAuditLogMatch(null)}
                matchName={auditLogMatch?.matchName || 'Match'}
                history={auditLogMatch?.history || []}
                ourTeamName="Our Team"
                oppTeamName="Opponent"
                ourRoster={auditLogMatch?.ourRoster || []}
                oppRoster={auditLogMatch?.oppRoster || []}
            />
        </div>
    )
}

export default Home
