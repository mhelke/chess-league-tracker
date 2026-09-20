import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { findRecruitmentSolutions } from '../utils/recruitmentSolutions'
import { BALANCE_THRESHOLD, collectActionItems, normalizeMatchId, numericRating } from '../utils/actionItemUtils'
import SuggestedRecruitsModal from '../components/SuggestedRecruitsModal'

export { analyzeTimeoutRemoval, getMatchStatusLevel, getSurgeRecruitmentStatus } from '../utils/actionItemUtils'

function groupOpponentAdditionsByRating(additions = []) {
    const groups = new Map()
    additions.forEach(player => {
        const rating = numericRating(player?.rating)
        const key = rating === null
            ? 'Rating unavailable'
            : `${Math.floor(rating / 100) * 100}-${Math.floor(rating / 100) * 100 + 99}`
        groups.set(key, (groups.get(key) || 0) + 1)
    })
    return Array.from(groups, ([range, count]) => ({ range, count }))
        .sort((left, right) => {
            if (left.range === 'Rating unavailable') return 1
            if (right.range === 'Rating unavailable') return -1
            return Number(right.range.split('-')[0]) - Number(left.range.split('-')[0])
        })
}

function getBoundValue(source, names, boardIndex = null) {
    for (const name of names) {
        const value = source?.[name]
        if (boardIndex !== null && (Array.isArray(value) || (value && typeof value === 'object'))) {
            const indexedValue = Array.isArray(value)
                ? value[boardIndex]
                : value[boardIndex] ?? value[boardIndex + 1]
            const numeric = numericRating(indexedValue)
            if (numeric !== null) return numeric
        }
        const numeric = numericRating(value)
        if (numeric !== null) return numeric
    }
    return null
}

function getRatingBounds(sources) {
    let min = -Infinity
    let max = Infinity
    let hasCap = false

    sources.forEach(source => {
        const range = source?.ratingRange ?? source?.ratingBounds ?? source?.ratingLimits
        const sourceMin = getBoundValue(source, ['minAllowedRating', 'minRating', 'ratingMin']) ?? numericRating(range?.[0])
        const sourceMax = getBoundValue(source, ['maxAllowedRating', 'maxRating', 'ratingMax']) ?? numericRating(range?.[1])
        if (sourceMin !== null) min = Math.max(min, sourceMin)
        if (sourceMax !== null) {
            max = Math.min(max, sourceMax)
            hasCap = true
        }
    })

    // The feed's section names are often the only place an under-rating cap is supplied.
    sources.forEach(source => {
        const label = typeof source === 'string' ? source : source?.name
        const underCap = String(label || '').match(/\bU\s*(\d{3,4})\b/i)
        const minimum = String(label || '').match(/\b(\d{3,4})\s*\+/)
        if (underCap) {
            max = Math.min(max, Number(underCap[1]) - 1)
            hasCap = true
        }
        if (minimum) min = Math.max(min, Number(minimum[1]))
    })

    return { min, max, hasCap }
}

function getBoardBounds(round, boardIndex, sectionBounds) {
    const boardRange = round.boardRanges?.[boardIndex] ?? round.boardRatingRanges?.[boardIndex]
    const min = Math.max(
        sectionBounds.min,
        getBoundValue(round, ['boardMin', 'boardMins', 'boardMinRating', 'boardMinRatings'], boardIndex)
        ?? numericRating(boardRange?.min) ?? numericRating(boardRange?.[0]) ?? -Infinity
    )
    const max = Math.min(
        sectionBounds.max,
        getBoundValue(round, ['boardMax', 'boardMaxs', 'boardMaxRating', 'boardMaxRatings'], boardIndex)
        ?? numericRating(boardRange?.max) ?? numericRating(boardRange?.[1]) ?? Infinity
    )
    return { min, max }
}

function groupRecruitCohorts(cohorts) {
    const counts = new Map()
    cohorts.forEach(cohort => counts.set(cohort, (counts.get(cohort) || 0) + 1))
    return Array.from(counts, ([cohort, count]) => ({ cohort, count }))
}

function groupCurrentBoardGaps(gaps = []) {
    const groups = new Map()
    gaps.forEach(gap => {
        const numericGap = Number(gap.gap)
        const label = Number.isFinite(numericGap)
            ? numericGap >= 100 ? '100+ points' : '50–99 points'
            : 'No player'
        groups.set(label, (groups.get(label) || 0) + 1)
    })
    return ['50–99 points', '100+ points', 'No player']
        .filter(label => groups.has(label))
        .map(label => ({ label, count: groups.get(label) }))
}

function getMetricBadges(warnings) {
    const playerNeed = Math.max(
        warnings.minNotMet ? warnings.needPlayers : 0,
        warnings.playerDeficit ? warnings.playerDeficitCount : 0,
    )
    const mismatchIsCritical = warnings.activeBoardCount > 0
        && warnings.mismatchedBoardCount / warnings.activeBoardCount > 0.5
    return [
        playerNeed > 0 && {
            label: `👥 +${playerNeed} Players Needed`,
            className: 'bg-red-100 text-red-800 border-red-200',
        },
        warnings.surgeRecruitment && {
            label: `⚡ Opponent Surging (+${warnings.opponentPlayersAdded24h})`,
            className: 'bg-amber-100 text-amber-800 border-amber-200',
        },
        warnings.mismatchedBoardCount > 0 && {
            label: `♟️ ${warnings.mismatchedBoardCount} Boards Mismatched`,
            className: mismatchIsCritical
                ? 'bg-red-100 text-red-800 border-red-200'
                : 'bg-amber-100 text-amber-800 border-amber-200',
        },
        warnings.playersWithHighTimeout > 0 && {
            label: `⏱️ ${warnings.playersWithHighTimeout} High Timeout Risk`,
            className: 'bg-orange-100 text-orange-800 border-orange-200',
        },
    ].filter(Boolean)
}

function recruitmentSummary(suggestions) {
    const primary = suggestions?.find(suggestion => suggestion.needed > 0)
    if (!primary) return null
    const tierCount = groupRecruitCohorts(primary.cohorts).length
    return `Recruit ${primary.needed} player${primary.needed !== 1 ? 's' : ''} across ${tierCount} rating tier${tierCount !== 1 ? 's' : ''} to fix ${primary.repairedBoards}/${primary.totalBoards} boards`
}

function recruitThresholdLabel(minimumRating) {
    return `${Math.ceil(minimumRating / 25) * 25}+`
}

/**
 * Produce recruits that are legal at the board they occupy after rating sort.
 * Exposed for focused tests; ActionItems supplies the round and section context.
 */
export function buildRecruitmentSuggestions(ourTeam, opponentTeam, maxBoards, round = {}, sectionSources = []) {
    const ourRatings = ourTeam.map(player => numericRating(player?.rating)).filter(rating => rating !== null).sort((a, b) => b - a)
    const oppRatings = opponentTeam.map(player => numericRating(player?.rating)).filter(rating => rating !== null).sort((a, b) => b - a)
    const parsedMaxBoards = numericRating(maxBoards)
    const boardLimit = parsedMaxBoards !== null ? Math.max(0, parsedMaxBoards) : Infinity
    const N = Math.min(ourRatings.length, oppRatings.length, boardLimit)
    const A = ourRatings.slice(0, N)
    const O = oppRatings.slice(0, N)
    if (!N) return []

    const sectionBounds = getRatingBounds([...sectionSources, round])
    if (sectionBounds.min > sectionBounds.max) return []
    const activeBoards = Math.min(boardLimit, Math.max(ourRatings.length, oppRatings.length))
    if (!activeBoards) return []
    const currentBoardGaps = Array.from({ length: activeBoards }, (_, index) => {
        const opponentRating = oppRatings[index]
        const ourRating = ourRatings[index]
        if (opponentRating === undefined) return null
        if (ourRating !== undefined && opponentRating - ourRating <= BALANCE_THRESHOLD) return null
        return {
            board: index + 1,
            ourRating: ourRating ?? null,
            opponentRating,
            gap: ourRating === undefined ? null : opponentRating - ourRating,
        }
    }).filter(Boolean)
    const configuredCeilings = [...sectionSources, round]
        .map(source => getBoundValue(source, ['availabilityCeiling', 'recruitmentAvailabilityCeiling', 'maxRecruitRating']))
        .filter(value => value !== null)
    // Section cap is the default; an uncapped section uses the top opponent
    // rating so the engine always has a finite cohort search space.
    const availabilityCeiling = configuredCeilings.length
        ? Math.min(...configuredCeilings)
        : (Number.isFinite(sectionBounds.max) ? sectionBounds.max : (oppRatings[0] || 0))
    const boardBounds = Array.from({ length: activeBoards }, (_, index) => getBoardBounds(round, index, sectionBounds))
    const { solution1, solution2 } = findRecruitmentSolutions(ourTeam, opponentTeam, {
        boardCap: boardLimit,
        balanceThreshold: BALANCE_THRESHOLD,
        availabilityCeiling,
        minAllowedRating: Number.isFinite(sectionBounds.min) ? sectionBounds.min : undefined,
        maxAllowedRating: Number.isFinite(sectionBounds.max) ? sectionBounds.max : undefined,
        boardMins: boardBounds.map(bounds => Number.isFinite(bounds.min) ? bounds.min : undefined),
        boardMaxs: boardBounds.map(bounds => Number.isFinite(bounds.max) ? bounds.max : undefined),
    })

    return [solution1, solution2].filter(Boolean).map(solution => {
        const cohorts = solution.recruits.map(recruit => recruitThresholdLabel(recruit.exactMinRequiredRating))
        // Coverage is reported against every active board so each option can be
        // compared directly in the expanded action-item details.
        const totalBoards = solution.totalTargetBoards + solution.concededBoards.length
        return {
            kind: solution.strategy,
            title: solution.strategy === 'top-down' ? 'Cover all board gaps' : 'Use lower-rated recruits',
            needed: solution.recruits.length,
            cohorts,
            ratingLabel: cohorts.join(' and '),
            repairedBoards: solution.repairedBoards,
            repairedBoardNumbers: solution.repairedBoardNumbers,
            currentBoardGaps,
            totalBoards,
        }
    })

}

function ActionItems() {
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [playerRatings, setPlayerRatings] = useState(null)
    const [clubIcons, setClubIcons] = useState({})
    const [loading, setLoading] = useState(true)
    const [recruitsModalMatch, setRecruitsModalMatch] = useState(null)
    const [expandedMatches, setExpandedMatches] = useState(() => new Set())
    const [highlightedMatchKey, setHighlightedMatchKey] = useState(null)
    const [searchParams] = useSearchParams()
    const targetMatchId = normalizeMatchId(searchParams.get('matchId'))
    const recruitmentEnabled = playerRatings?.recruitmentEnabled === true

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(r => r.json()),
            fetch('/data/timeoutData.json').then(r => r.json()).catch(() => null),
            fetch('/data/playerRatings.json').then(r => r.json()).catch(() => null),
            fetch('/data/clubIcons.json').then(r => r.json()).catch(() => ({})),
        ])
            .then(([leagueJson, timeoutJson, playerRatingsJson, clubIconsJson]) => {
                setData(leagueJson)
                setTimeoutData(timeoutJson)
                setPlayerRatings(playerRatingsJson)
                setClubIcons(clubIconsJson || {})
                setLoading(false)
            })
            .catch(err => {
                console.error('Error loading data:', err)
                setLoading(false)
            })
    }, [])

    // Collect all OPEN matches with warnings
    const matchesWithWarnings = useMemo(() => {
        return collectActionItems(data, timeoutData, {
            recruitmentEnabled,
            buildRecruitmentSuggestions,
        })

        // Sort by startTime ascending
        matches.sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
        return matches
    }, [data, timeoutData, recruitmentEnabled])

    // Group by date
    const matchesByDate = useMemo(() => {
        const groups = {}
        matchesWithWarnings.forEach(match => {
            const dateKey = match.startTime ? new Date(match.startTime * 1000).toLocaleDateString() : 'No Date'
            if (!groups[dateKey]) groups[dateKey] = []
            groups[dateKey].push(match)
        })
        return groups
    }, [matchesWithWarnings])

    useEffect(() => {
        if (!targetMatchId || matchesWithWarnings.length === 0) return undefined

        const targetMatch = matchesWithWarnings.find(match => normalizeMatchId(match.matchId) === targetMatchId)
        if (!targetMatch) return undefined

        const targetKey = normalizeMatchId(targetMatch.matchId)
        setExpandedMatches(previous => {
            if (previous.has(targetKey)) return previous
            const next = new Set(previous)
            next.add(targetKey)
            return next
        })

        let highlightTimer
        const scrollTimer = window.setTimeout(() => {
            const targetElement = document.getElementById(`action-match-${encodeURIComponent(targetKey)}`)
            if (!targetElement) return

            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setHighlightedMatchKey(targetKey)
            highlightTimer = window.setTimeout(() => setHighlightedMatchKey(null), 3500)
        }, 0)

        return () => {
            window.clearTimeout(scrollTimer)
            if (highlightTimer) window.clearTimeout(highlightTimer)
        }
    }, [matchesWithWarnings, targetMatchId])

    if (loading) {
        return (
            <div className="page-container">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-chess-green mx-auto"></div>
                </div>
            </div>
        )
    }

    return (
        <div className="page-container">
            <div className="mb-8">
                <h2 className="text-4xl font-bold text-chess-dark mb-2">Action Items</h2>
                <p className="text-gray-600">
                    Open matches requiring attention ({matchesWithWarnings.length})
                </p>
            </div>

            {matchesWithWarnings.length === 0 ? (
                <div className="card text-center py-12 text-gray-500">
                    <p className="text-lg">✓ No action items! All open matches are set.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(matchesByDate).map(([dateKey, dateMatches]) => (
                        <div key={dateKey}>
                            <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                                <span className="text-calendar">📅</span>
                                {dateKey}
                            </h3>
                            <div className="space-y-2">
                                {dateMatches.map((match, idx) => {
                                    const matchKey = normalizeMatchId(match.matchId) || `${match.leagueName}-${match.subLeagueName}-${match.name}-${idx}`
                                    const isExpanded = expandedMatches.has(matchKey)
                                    const metricBadges = getMetricBadges(match.warnings)
                                    const summary = recruitmentSummary(match.warnings.recruitmentSuggestions)
                                    const currentBoardGaps = match.warnings.recruitmentSuggestions[0]?.currentBoardGaps || []
                                    const currentBoardGapGroups = groupCurrentBoardGaps(currentBoardGaps)
                                    const hasRecruitment = recruitmentEnabled
                                        && match.warnings.showRecruitmentRecommendations
                                        && match.warnings.recruitmentSuggestions.length > 0

                                    return (
                                        <div
                                            id={`action-match-${encodeURIComponent(String(matchKey))}`}
                                            key={matchKey}
                                            className={`card p-0 border-l-4 overflow-hidden scroll-mt-[16vh] sm:scroll-mt-[22vh] transition-shadow ${match.warnings.status.level === 'urgent' ? 'border-red-400' : match.warnings.status.level === 'advisory' ? 'border-amber-400' : 'border-green-400'} ${highlightedMatchKey === String(matchKey) ? 'ring-2 ring-chess-green ring-offset-2' : ''}`}
                                        >
                                            <div className="px-4 py-3 border-b border-gray-100">
                                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                                            <span className="font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{match.leagueName}</span>
                                                            <span className="text-gray-500">{match.subLeagueName}</span>
                                                            {match.opponentClubId && clubIcons[match.opponentClubId] && (
                                                                <span className="flex items-center gap-1 text-gray-600">
                                                                    {clubIcons[match.opponentClubId].icon && <img src={clubIcons[match.opponentClubId].icon} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />}
                                                                    {clubIcons[match.opponentClubId].name}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="mt-1 text-sm font-semibold text-gray-900 leading-snug">{match.name}</p>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 text-[11px] lg:justify-end">
                                                        <span className="text-gray-600 whitespace-nowrap">{match.registeredPlayers?.our || 0} / {match.registeredPlayers?.opponent || 0} players</span>
                                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${match.warnings.status.className}`}>
                                                            {match.warnings.status.icon} {match.warnings.status.level.toUpperCase()}
                                                        </span>
                                                        {match.matchWebUrl && (
                                                            <a href={match.matchWebUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-chess-green hover:underline whitespace-nowrap">Chess.com →</a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="px-4 py-3">
                                                <div className={`rounded-lg border px-3 py-2 ${match.warnings.status.className}`}>
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                                                        <span>{match.warnings.status.icon} {match.warnings.status.label}</span>
                                                        {match.warnings.status.reasons.length > 0 && (
                                                            <span className={`font-normal text-[11px] ${match.warnings.status.reasonClassName}`}>{match.warnings.status.reasons.join(' · ')}</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {metricBadges.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {metricBadges.map(badge => (
                                                            <span key={badge.label} className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
                                                        ))}
                                                    </div>
                                                )}

                                                {summary && (
                                                    <p className="mt-2 text-xs text-gray-700 truncate" title={summary}>{summary}</p>
                                                )}

                                                <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`} aria-hidden={!isExpanded}>
                                                    <div className="space-y-3">
                                                        {match.warnings.opponentPlayersAdded24h > 0 && (
                                                            <div className="bg-gray-50 p-3 rounded-lg">
                                                                <div className="text-xs font-semibold text-gray-800 mb-1">Opponent registration activity</div>
                                                                <div className="text-[11px] text-gray-600">
                                                                    +{match.warnings.opponentPlayersAdded24h} player{match.warnings.opponentPlayersAdded24h === 1 ? '' : 's'} added in the last 24 hours
                                                                    {match.warnings.matchStartsInDays !== null && (
                                                                        <> · Match starts {match.warnings.matchStartsInDays === 0 ? 'today' : `in ${match.warnings.matchStartsInDays} day${match.warnings.matchStartsInDays === 1 ? '' : 's'}`}</>
                                                                    )}
                                                                </div>
                                                                {match.warnings.recentOpponentAdditions?.length > 0 ? (
                                                                    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                                                        {groupOpponentAdditionsByRating(match.warnings.recentOpponentAdditions).map(group => (
                                                                            <div key={group.range} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] text-gray-700">
                                                                                <span className="font-medium">Rating {group.range}</span>
                                                                                <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                                                                                    {group.count} player{group.count === 1 ? '' : 's'}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="mt-1 text-[11px] text-gray-500">Rating ranges were not included in the registration update.</div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {match.warnings.highRiskTimeoutPlayers?.length > 0 && (
                                                            <div className="bg-gray-50 p-3 rounded-lg">
                                                                <div className="text-xs font-semibold text-gray-800 mb-2">Timeout Removal Guidance</div>
                                                                <div className="space-y-2">
                                                                    {match.warnings.highRiskTimeoutPlayers.map(player => (
                                                                        <div key={player.username} className="text-xs text-gray-700">
                                                                            <div className="font-semibold">{player.safeRemoval ? '⚠️ Recommend Removal' : '🛡️ Recommend Keeping'}: {player.username} (High Timeout Risk)</div>
                                                                            <div className="mt-0.5 text-[11px] text-gray-600">{player.safeRemoval ? 'Removing player shifts roster up safely without creating critical board gaps.' : 'Removing player creates an uncompetitive board deficit or drops team below minimum player requirements.'}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                {hasRecruitment && (
                                                    <div className="bg-gray-50 p-3 rounded-lg">
                                                        <div className="text-xs font-semibold text-gray-800 mb-2">Recruitment options</div>
                                                        {currentBoardGapGroups.length > 0 && (
                                                            <div className="mb-2 rounded border border-gray-200 bg-white px-2.5 py-2 text-[11px] text-gray-700">
                                                                <div className="mb-1 font-semibold">Current board gaps · {currentBoardGaps.length} board{currentBoardGaps.length !== 1 ? 's' : ''}</div>
                                                                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                                                    {currentBoardGapGroups.map(group => (
                                                                        <div key={group.label} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                                                                            <span className="font-medium text-gray-600">{group.label}</span>
                                                                            <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                                                                                {group.count} board{group.count !== 1 ? 's' : ''}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                                <div className="space-y-2">
                                                                    {match.warnings.recruitmentSuggestions.map((sugg, suggestionIndex) => (
                                                                        <div key={suggestionIndex} className="rounded border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700">
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <span className="font-semibold">
                                                                                    {match.warnings.recruitmentSuggestions.length > 1 && `${suggestionIndex === 0 ? 'Primary' : 'Alternative'} · `}{sugg.title}
                                                                                </span>
                                                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${sugg.repairedBoards >= sugg.totalBoards ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{sugg.repairedBoards}/{sugg.totalBoards} fixed</span>
                                                                            </div>
                                                                            <div className="mt-2">
                                                                                <div className="mb-1 text-[11px] font-medium text-gray-600">Recruit players in these tiers</div>
                                                                                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                                                                    {groupRecruitCohorts(sugg.cohorts).map(group => (
                                                                                        <div key={group.cohort} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px]">
                                                                                            <span className="whitespace-nowrap font-semibold text-gray-800">{group.cohort}</span>
                                                                                            <span className="text-gray-600">{group.count} player{group.count !== 1 ? 's' : ''}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                                    {hasRecruitment && (
                                                        <button onClick={() => setRecruitsModalMatch(match)} className="text-xs font-semibold text-white bg-chess-green hover:bg-green-700 px-3 py-1.5 rounded">Suggested Recruits</button>
                                                    )}
                                                    <button
                                                        onClick={() => setExpandedMatches(previous => {
                                                            const next = new Set(previous)
                                                            if (next.has(matchKey)) next.delete(matchKey)
                                                            else next.add(matchKey)
                                                            return next
                                                        })}
                                                        className="text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded"
                                                        aria-expanded={isExpanded}
                                                    >
                                                        {isExpanded ? '[ ▴ Hide Details ]' : '[ ▾ View Details ]'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <SuggestedRecruitsModal
                isOpen={!!recruitsModalMatch}
                onClose={() => setRecruitsModalMatch(null)}
                data={data}
                playerRatings={playerRatings}
                leagueName={recruitsModalMatch?.leagueName}
                subLeagueName={recruitsModalMatch?.subLeagueName}
                round={recruitsModalMatch}
                tiers={recruitsModalMatch ? [...new Set(recruitsModalMatch.warnings.recruitmentSuggestions.flatMap(s => s.cohorts))] : []}
                existingUsernames={(recruitsModalMatch?.registrationData?.ourRoster || []).map(p => p.username).filter(Boolean)}
            />
        </div>
    )
}

export default ActionItems
