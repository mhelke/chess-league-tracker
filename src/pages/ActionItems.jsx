import { useState, useEffect, useMemo } from 'react'
import { computeMatchupRatings } from '../utils/ratingUtils'
import { findRecruitmentSolutions } from '../utils/recruitmentSolutions'
import SuggestedRecruitsModal from '../components/SuggestedRecruitsModal'

const BALANCE_THRESHOLD = 50
const DEFAULT_PLAYER_DEFICIT_THRESHOLD = 3
const DAY_SECONDS = 24 * 60 * 60
const SURGE_WINDOW_SECONDS = DAY_SECONDS
const SURGE_IMMINENCE_SECONDS = 5 * DAY_SECONDS

const MATCH_STATUS_META = {
    urgent: {
        icon: '🔴',
        label: 'URGENT: Action Required',
        className: 'border-red-300 bg-red-50 text-red-900',
        reasonClassName: 'text-red-800',
    },
    advisory: {
        icon: '🟡',
        label: 'ADVISORY: Match Monitoring',
        className: 'border-amber-300 bg-amber-50 text-amber-900',
        reasonClassName: 'text-amber-800',
    },
    secure: {
        icon: '🟢',
        label: 'SECURE: Match Ready',
        className: 'border-green-300 bg-green-50 text-green-900',
        reasonClassName: 'text-green-800',
    },
}

/**
 * Classifies a match independently from the individual warning alerts.
 * The returned metadata is ready for the status banner rendered by the card.
 */
export function getMatchStatusLevel({
    minNotMet = false,
    ourCount = 0,
    oppCount = 0,
    ratingDisadvantage = false,
    mismatchedBoardCount = 0,
    activeBoards = 0,
    playerDeficit = false,
    surgeRecruitment = false,
    avgDiff = 0,
    highRiskTimeoutPresent = false,
    highRiskRemovalDropsBelowMinimum = false,
    highRiskRemovalSafe = false,
} = {}) {
    const mismatchRatio = activeBoards > 0 ? mismatchedBoardCount / activeBoards : 0
    const urgentReasons = []

    if (minNotMet) urgentReasons.push('Minimum roster unmet')
    if (oppCount > ourCount && ratingDisadvantage) {
        urgentReasons.push('Player-count and rating deficit')
    }
    if (mismatchRatio > 0.5) {
        urgentReasons.push('More than half of boards mismatched')
    }
    if (surgeRecruitment && (playerDeficit || ratingDisadvantage)) {
        urgentReasons.push('Surge compounds a roster or rating deficit')
    }
    if (highRiskTimeoutPresent && highRiskRemovalDropsBelowMinimum) {
        urgentReasons.push('High-risk player cannot be removed safely')
    }

    if (urgentReasons.length > 0) {
        return { level: 'urgent', ...MATCH_STATUS_META.urgent, reasons: urgentReasons }
    }

    const advisoryReasons = []
    if (mismatchedBoardCount > 0 && mismatchRatio <= 0.5) {
        advisoryReasons.push(`${mismatchedBoardCount} board${mismatchedBoardCount === 1 ? '' : 's'} need monitoring`)
    }
    if (oppCount > ourCount && avgDiff >= 0) {
        advisoryReasons.push('Opponent leads in players; we lead in rating')
    }
    if (surgeRecruitment && ourCount >= oppCount && avgDiff >= 0) {
        advisoryReasons.push('Opponent surge is contained')
    }
    if (highRiskTimeoutPresent && highRiskRemovalSafe) {
        advisoryReasons.push('High-risk player can be removed safely')
    }

    if (advisoryReasons.length > 0) {
        return { level: 'advisory', ...MATCH_STATUS_META.advisory, reasons: advisoryReasons }
    }

    return { level: 'secure', ...MATCH_STATUS_META.secure, reasons: [] }
}

const numericRating = value => Number.isFinite(Number(value)) ? Number(value) : null

function sortedRosterRatings(roster = []) {
    return roster
        .map(player => numericRating(player?.rating))
        .filter(rating => rating !== null)
        .sort((a, b) => b - a)
}

function competitiveBoardCount(ourRoster, opponentRoster, boardCap) {
    const ourRatings = sortedRosterRatings(ourRoster)
    const opponentRatings = sortedRosterRatings(opponentRoster)
    const activeBoards = Math.min(ourRatings.length, opponentRatings.length, boardCap)
    const competitiveBoards = Array.from({ length: activeBoards }, (_, index) => index)
        .filter(index => opponentRatings[index] - ourRatings[index] <= BALANCE_THRESHOLD)
    return { activeBoards, competitiveBoards: competitiveBoards.length }
}

/**
 * Simulates removing one high-risk player, including the rating-sort cascade
 * that changes which players occupy each board.
 */
export function analyzeTimeoutRemoval(
    player,
    ourRoster = [],
    opponentRoster = [],
    boardCap = Infinity,
    ourCount = ourRoster.length,
    minTeamPlayers = 0,
) {
    const before = competitiveBoardCount(ourRoster, opponentRoster, boardCap)
    const username = player?.username
    const playerKey = typeof username === 'string' ? username.toLowerCase() : null
    const remaining = ourRoster.filter(candidate => {
        if (candidate === player) return false
        const candidateKey = typeof candidate?.username === 'string' ? candidate.username.toLowerCase() : null
        return candidateKey !== playerKey
    })
    const after = competitiveBoardCount(remaining, opponentRoster, boardCap)
    const netBoardChange = after.competitiveBoards - before.competitiveBoards
    const belowMinimum = ourCount - 1 < minTeamPlayers
    return {
        username,
        beforeCompetitiveBoards: before.competitiveBoards,
        afterCompetitiveBoards: after.competitiveBoards,
        netBoardChange,
        netBoardLoss: before.competitiveBoards - after.competitiveBoards,
        remainingPlayerCount: Math.max(0, ourCount - 1),
        belowMinimum,
        safeRemoval: netBoardChange >= 0 && !belowMinimum,
    }
}

function timestampToSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1e12 ? value / 1000 : value
    }
    if (typeof value !== 'string' || !value.trim()) return null
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric / 1000 : numeric
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed / 1000 : null
}

function historyTimestamp(entry) {
    return timestampToSeconds(
        entry?.ts ?? entry?.timestamp ?? entry?.time ?? entry?.date ?? entry?.recordedAt ?? entry?.createdAt
    )
}

function countDelta(value) {
    if (Array.isArray(value)) return value.length
    const numeric = numericRating(value)
    if (numeric !== null) return numeric
    if (value && typeof value === 'object') {
        return countDelta(value.count ?? value.total ?? value.players ?? value.usernames)
    }
    return 0
}

function opponentRegistrationDelta(entry) {
    const opponent = entry?.opp ?? entry?.opponent ?? entry
    if (!opponent || typeof opponent !== 'object') return 0
    const explicitNet = opponent.netIncrease ?? opponent.net ?? opponent.delta
    if (explicitNet !== undefined) return numericRating(explicitNet) ?? 0
    const added = opponent.added
        ?? opponent.joined
        ?? opponent.joins
        ?? opponent.playersAdded
        ?? opponent.opponentPlayersAdded
        ?? opponent.players
        // Daily-join feeds commonly expose the delta as `count`.
        ?? opponent.count
    const removed = opponent.removed ?? opponent.left ?? opponent.leaves ?? opponent.playersRemoved
    return countDelta(added) - countDelta(removed)
}

function registrationHistoryEntries(round) {
    const sources = [
        round?.opponentHistory,
        round?.opponentDailyJoins,
        round?.registrationData?.opponentDailyJoins,
        round?.registrationData?.opponentHistory,
        round?.registrationData?.registeredPlayers?.opponentHistory,
        round?.registeredPlayers?.opponentHistory,
        round?.registrationHistory,
        round?.registrationData?.registrationHistory,
    ]
    // These fields are alternative representations of the same feed. Use the
    // first populated one so a caller providing both does not double-count joins.
    const source = sources.find(value => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' && Object.keys(value).length > 0)
    if (!source) return []
    if (Array.isArray(source)) return source
    // Daily feeds are sometimes keyed by an ISO date/timestamp instead of
    // carrying the timestamp inside each value.
    if (historyTimestamp(source) !== null) return [source]
    return Object.entries(source).map(([timestamp, value]) => ({ ts: timestamp, added: value }))
}

export function getOpponentPlayersAdded24h(round, nowSeconds = Date.now() / 1000) {
    const explicitDelta = round?.opponentPlayersAdded24h ?? round?.registrationData?.opponentPlayersAdded24h
    if (explicitDelta !== undefined) return Math.max(0, numericRating(explicitDelta) ?? 0)
    return registrationHistoryEntries(round).reduce((total, entry) => {
        const timestamp = historyTimestamp(entry)
        if (timestamp === null) return total
        const age = nowSeconds - timestamp
        if (age < 0 || age > SURGE_WINDOW_SECONDS) return total
        return total + opponentRegistrationDelta(entry)
    }, 0)
}

export function getSurgeRecruitmentStatus(round, nowSeconds = Date.now() / 1000) {
    const matchTime = timestampToSeconds(round?.startTime)
    if (matchTime === null) return { surgeRecruitment: false, opponentPlayersAdded24h: 0, matchStartsInDays: null }
    const secondsUntilStart = matchTime - nowSeconds
    const matchImminent = secondsUntilStart >= 0 && secondsUntilStart <= SURGE_IMMINENCE_SECONDS
    const opponentPlayersAdded24h = getOpponentPlayersAdded24h(round, nowSeconds)
    return {
        surgeRecruitment: matchImminent && opponentPlayersAdded24h > 3,
        opponentPlayersAdded24h,
        matchStartsInDays: Math.max(0, Math.ceil(secondsUntilStart / DAY_SECONDS)),
    }
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

const withinThreshold = (ourRating, oppRating) => oppRating - ourRating <= BALANCE_THRESHOLD

function formatBoardNumbers(boards) {
    if (!boards.length) return 'none'
    const ranges = []
    let start = boards[0]
    let end = start
    boards.slice(1).forEach(board => {
        if (board === end + 1) {
            end = board
            return
        }
        ranges.push(start === end ? `${start}` : `${start}-${end}`)
        start = board
        end = board
    })
    ranges.push(start === end ? `${start}` : `${start}-${end}`)
    return ranges.join(', ')
}

function cohortLabel(min, max, preferred) {
    const cohortMin = Math.max(min, Math.floor(preferred / 100) * 100)
    const cohortMax = Math.min(max, Math.floor(preferred / 100) * 100 + 99)
    if (cohortMin <= cohortMax) return cohortMin === cohortMax ? `${cohortMin}` : `${cohortMin}–${cohortMax}`
    return `${min}–${max}`
}

function groupRecruitCohorts(cohorts) {
    const counts = new Map()
    cohorts.forEach(cohort => counts.set(cohort, (counts.get(cohort) || 0) + 1))
    return Array.from(counts, ([cohort, count]) => `${count} player${count !== 1 ? 's' : ''} ${cohort}`)
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
    const cohorts = [...new Set(primary.cohorts)]
    return `Recruit ${primary.needed} player${primary.needed !== 1 ? 's' : ''} (${cohorts.join(', ')}) to fix ${primary.repairedBoards}/${primary.totalBoards} boards`
}

// The fixed/total pill already conveys which boards are repaired, so drop that clause from the summary sentence.
function stripRedundantFixSummary(text) {
    if (!text) return ''
    return text
        .replace(/;\s*(currently\s+)?fixes boards [^.]+\.$/i, '.')
        .replace(/^(currently\s+)?fixes boards [^.]+\.$/i, '')
        .trim()
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
        // Coverage is reported against every active board, not just the post-concession target zone, so partial fallbacks read honestly.
        const totalBoards = solution.totalTargetBoards + solution.concededBoards.length
        return {
            kind: solution.strategy,
            title: solution.strategy === 'top-down' ? 'Top-Down' : 'Depth-First Fallback',
            needed: solution.recruits.length,
            cohorts,
            ratingLabel: cohorts.join(' and '),
            impact: stripRedundantFixSummary(solution.summaryLabel),
            repairedBoards: solution.repairedBoards,
            totalBoards,
            capNote: sectionBounds.hasCap ? `Capped at ${sectionBounds.max}` : '',
        }
    })

    /* Legacy implementation retained below temporarily for comparison. */
    const mismatches = A.map((rating, index) => ({ index, gap: O[index] - rating }))
        .filter(({ gap }) => gap > BALANCE_THRESHOLD)

    const describeImpact = ratings => {
        const fixed = ratings.reduce((boards, rating, index) => withinThreshold(rating, O[index]) ? boards.concat(index + 1) : boards, [])
        return fixed.length ? `Fixes boards ${formatBoardNumbers(fixed)} within 50pt threshold` : 'Does not bring a board within the 50pt threshold'
    }
    const options = []

    // One recruit: test every actual insertion point, including all cascade effects.
    for (let k = 0; k < N; k++) {
        const boardBounds = getBoardBounds(round, k, sectionBounds)
        const seatingMin = k < A.length ? A[k] : -Infinity
        const seatingMax = k > 0 ? A[k - 1] : Infinity
        const min = Math.max(boardBounds.min, seatingMin)
        const max = Math.min(boardBounds.max, seatingMax)
        if (min > max) continue

        const idealTarget = Math.max(O[k] - BALANCE_THRESHOLD, O[k])
        const target = Math.min(max, Math.max(min, idealTarget))
        const after = [...A.slice(0, k), target, ...A.slice(k)].slice(0, N)
        const downstreamLegal = after.slice(k + 1).every((rating, index) => withinThreshold(rating, O[k + index + 1]))
        const fixes = after.filter((rating, index) => withinThreshold(rating, O[index])).length
        const constrained = target !== idealTarget || target === sectionBounds.max || target === sectionBounds.min
        options.push({
            kind: 'top', needed: 1, index: k, target, min, max, after, fixes, downstreamLegal, constrained,
            partial: !withinThreshold(target, O[k]),
            impact: describeImpact(after),
        })
    }

    const bestTop = options
        .sort((a, b) => b.fixes - a.fixes || Number(b.downstreamLegal) - Number(a.downstreamLegal) || a.index - b.index)[0]
    if (bestTop) {
        options.length = 0
        options.push(bestTop)
    }

    // Depth option: the two largest current deficits each get a legal, ordered board range.
    const [first, second] = [...mismatches].sort((a, b) => b.gap - a.gap || a.index - b.index)
    if (first && second) {
        const [i, j] = [first.index, second.index].sort((a, b) => a - b)
        const firstBounds = getBoardBounds(round, i, sectionBounds)
        const secondBounds = getBoardBounds(round, j, sectionBounds)
        const firstRange = {
            min: Math.max(O[i] - BALANCE_THRESHOLD, firstBounds.min, i < A.length ? A[i] : -Infinity),
            max: Math.min(O[i] + BALANCE_THRESHOLD, firstBounds.max, i > 0 ? A[i - 1] : Infinity),
        }
        const firstTarget = Math.min(firstRange.max, Math.max(firstRange.min, O[i]))
        const secondFloorPlayer = A[j - 1] // The first recruit shifts this player down before the second insertion.
        const secondRange = {
            min: Math.max(O[j] - BALANCE_THRESHOLD, secondBounds.min, secondFloorPlayer ?? -Infinity),
            max: Math.min(
                O[j] + BALANCE_THRESHOLD,
                secondBounds.max,
                j === i + 1 ? firstTarget : (j > 1 ? A[j - 2] : Infinity)
            ),
        }
        const secondTarget = Math.min(secondRange.max, Math.max(secondRange.min, O[j]))
        if (firstRange.min <= firstRange.max && secondRange.min <= secondRange.max && firstTarget >= secondTarget) {
            const after = [...A]
            after.splice(i, 0, firstTarget)
            after.splice(j, 0, secondTarget)
            after.length = N
            options.push({
                kind: 'depth', needed: 2, targets: [firstTarget, secondTarget], ranges: [firstRange, secondRange], after,
                constrained: firstTarget !== O[i] || secondTarget !== O[j],
                partial: !withinThreshold(firstTarget, O[i]) || !withinThreshold(secondTarget, O[j]),
                impact: describeImpact(after),
            })
        }
    }

    return options.slice(0, 2).map(option => {
        const cohorts = option.needed === 1
            ? [cohortLabel(option.min, option.max, option.target)]
            : option.ranges.map((range, index) => cohortLabel(range.min, range.max, option.targets[index]))
        return {
            ...option,
            cohorts,
            ratingLabel: cohorts.join(' and '),
            capNote: option.constrained && sectionBounds.hasCap ? `Constrained by section cap (${sectionBounds.max})` : '',
            status: option.partial ? 'Partial Balance Solution' : 'Balanced Solution',
        }
    })
}

function ActionItems() {
    const [data, setData] = useState(null)
    const [timeoutData, setTimeoutData] = useState(null)
    const [clubIcons, setClubIcons] = useState({})
    const [loading, setLoading] = useState(true)
    const [recruitsModalMatch, setRecruitsModalMatch] = useState(null)
    const [expandedMatches, setExpandedMatches] = useState(() => new Set())

    useEffect(() => {
        Promise.all([
            fetch('/data/leagueData.json').then(r => r.json()),
            fetch('/data/timeoutData.json').then(r => r.json()).catch(() => null),
            fetch('/data/clubIcons.json').then(r => r.json()).catch(() => ({})),
        ])
            .then(([leagueJson, timeoutJson, clubIconsJson]) => {
                setData(leagueJson)
                setTimeoutData(timeoutJson)
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
        if (!data?.leagues) return []
        const matches = []

        Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
            Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
                (subLeagueData.rounds || []).forEach(round => {
                    if (round.status !== 'open') return

                    // Check for warnings
                    const minRequired = round.minTeamPlayers || 0
                    const ourCount = round.registeredPlayers?.our || 0
                    const oppCount = round.registeredPlayers?.opponent || 0
                    // Allow a league/round to override the default before treating a
                    // small registration difference as a depth warning.
                    const playerDeficitThreshold = numericRating(round.playerDeficitThreshold)
                        ?? numericRating(subLeagueData.playerDeficitThreshold)
                        ?? DEFAULT_PLAYER_DEFICIT_THRESHOLD
                    const playerDeficitCount = oppCount - ourCount
                    const playerDeficit = playerDeficitCount >= playerDeficitThreshold
                    const minNotMet = minRequired > 0 && ourCount < minRequired
                    const surgeStatus = getSurgeRecruitmentStatus(round)

                    let ratingDisadvantage = false
                    let avgDiff = 0
                    let recruitmentSuggestions = []
                    let showRecruitmentRecommendations = false
                    let mismatchedBoards = []
                    let activeBoardCount = 0
                    if (round.registrationData && round.registrationData.type === 'roster') {
                        const cap = round.maxTeamPlayers ?? round.boards ?? Infinity
                        const matchup = computeMatchupRatings(round.registrationData.ourRoster || [], round.registrationData.oppRoster || [], cap)
                        avgDiff = matchup.avgDiff
                        ratingDisadvantage = avgDiff < -50

                        const activeOurRatings = (round.registrationData.ourRoster || [])
                            .map(player => numericRating(player.rating)).filter(rating => rating !== null).sort((a, b) => b - a)
                        const activeOppRatings = (round.registrationData.oppRoster || [])
                            .map(player => numericRating(player.rating)).filter(rating => rating !== null).sort((a, b) => b - a)
                        activeBoardCount = Math.min(activeOurRatings.length, activeOppRatings.length, cap)
                        mismatchedBoards = Array.from({ length: activeBoardCount }, (_, index) => index + 1)
                            .filter(boardNumber => activeOppRatings[boardNumber - 1] - activeOurRatings[boardNumber - 1] > BALANCE_THRESHOLD)
                        const hasBoardMismatch = mismatchedBoards.length > 0
                        ratingDisadvantage = hasBoardMismatch
                        // Board mismatches always qualify for recruitment options. If
                        // there is no mismatch, only an opponent player-count lead does.
                        showRecruitmentRecommendations = ratingDisadvantage
                            || (!ratingDisadvantage && oppCount > ourCount)

                        // A mismatch still takes priority when multiple issues apply;
                        // this creates one recommendation set rather than duplicating it
                        // for the player deficit or surge warning.
                        if (showRecruitmentRecommendations) {
                            recruitmentSuggestions = buildRecruitmentSuggestions(
                                round.registrationData.ourRoster || [],
                                round.registrationData.oppRoster || [],
                                cap,
                                round,
                                [leagueData, subLeagueData, leagueName, subLeagueName]
                            )
                        }
                    }

                    // Only HIGH risk players receive timeout alerts. Simulate each
                    // removal after sorting the remaining roster by rating.
                    const highRiskTimeoutPlayers = []
                    const roster = round.registrationData?.ourRoster || []
                    const opponentRoster = round.registrationData?.oppRoster || []
                    const boardCap = round.maxTeamPlayers ?? round.boards ?? Infinity
                    if (timeoutData?.players && roster.length > 0) {
                        const seen = new Set()
                        roster.forEach(player => {
                            const username = player?.username
                            if (!username) return
                            const key = username.toLowerCase()
                            const td = timeoutData.players[key]
                            if (!td?.riskFlag || String(td?.riskLevel || '').toUpperCase() !== 'HIGH' || seen.has(key)) return
                            seen.add(key)
                            const removal = analyzeTimeoutRemoval(
                                player,
                                roster,
                                opponentRoster,
                                boardCap,
                                ourCount,
                                minRequired,
                            )
                            highRiskTimeoutPlayers.push({
                                ...removal,
                                username,
                                riskLevel: 'HIGH',
                                riskReason: td.riskReason || '',
                            })
                        })
                    }

                    const playersWithHighTimeout = highRiskTimeoutPlayers.length
                    const hasTimeoutWarning = playersWithHighTimeout > 0
                    const hasTrappedHighRiskTimeout = highRiskTimeoutPlayers.some(player => player.belowMinimum)
                    const hasSafeHighRiskTimeoutRemoval = highRiskTimeoutPlayers.some(player => player.safeRemoval)
                    const status = getMatchStatusLevel({
                        minNotMet,
                        ourCount,
                        oppCount,
                        ratingDisadvantage,
                        mismatchedBoardCount: mismatchedBoards.length,
                        activeBoards: activeBoardCount,
                        playerDeficit,
                        surgeRecruitment: surgeStatus.surgeRecruitment,
                        avgDiff,
                        highRiskTimeoutPresent: hasTimeoutWarning,
                        highRiskRemovalDropsBelowMinimum: hasTrappedHighRiskTimeout,
                        highRiskRemovalSafe: hasSafeHighRiskTimeoutRemoval,
                    })
                    const hasWarning = minNotMet
                        || playerDeficit
                        || ratingDisadvantage
                        || surgeStatus.surgeRecruitment
                        || hasTimeoutWarning

                    // Only include if has any warning
                    if (hasWarning) {
                        matches.push({
                            ...round,
                            leagueName,
                            subLeagueName,
                            warnings: {
                                minNotMet,
                                needPlayers: minRequired - ourCount,
                                playerDeficit,
                                playerDeficitCount,
                                playerDeficitThreshold,
                                surgeRecruitment: surgeStatus.surgeRecruitment,
                                opponentPlayersAdded24h: surgeStatus.opponentPlayersAdded24h,
                                matchStartsInDays: surgeStatus.matchStartsInDays,
                                activeBoardCount,
                                statusLevel: status.level,
                                status,
                                statusReasons: status.reasons,
                                ratingDisadvantage,
                                avgDiff: Math.round(avgDiff),
                                mismatchedBoardCount: mismatchedBoards?.length || 0,
                                mismatchedBoards: formatBoardNumbers(mismatchedBoards || []),
                                recruitmentSuggestions,
                                showRecruitmentRecommendations,
                                highRiskTimeoutPlayers,
                                hasTrappedHighRiskTimeout,
                                hasSafeHighRiskTimeoutRemoval,
                                playersWithHighTimeout,
                                hasTimeoutWarning,
                            }
                        })
                    }
                })
            })
        })

        // Sort by startTime ascending
        matches.sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
        return matches
    }, [data, timeoutData])

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
                                    const matchKey = match.matchId || `${match.leagueName}-${match.subLeagueName}-${match.name}-${idx}`
                                    const isExpanded = expandedMatches.has(matchKey)
                                    const metricBadges = getMetricBadges(match.warnings)
                                    const summary = recruitmentSummary(match.warnings.recruitmentSuggestions)
                                    const hasRecruitment = match.warnings.showRecruitmentRecommendations && match.warnings.recruitmentSuggestions.length > 0

                                    return (
                                        <div key={matchKey} className={`card p-0 border-l-4 overflow-hidden ${match.warnings.status.level === 'urgent' ? 'border-red-400' : match.warnings.status.level === 'advisory' ? 'border-amber-400' : 'border-green-400'}`}>
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
                                                                <div className="flex items-center justify-between gap-2 mb-2">
                                                                    <div className="text-xs font-semibold text-gray-800">Recruitment options</div>
                                                                    <button onClick={() => setRecruitsModalMatch(match)} className="text-[11px] font-semibold text-chess-green hover:underline">Suggested Recruits</button>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    {match.warnings.recruitmentSuggestions.map((sugg, suggestionIndex) => (
                                                                        <div key={suggestionIndex} className="text-xs text-gray-700">
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <span className="font-semibold">Option {suggestionIndex + 1}: {sugg.title}</span>
                                                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${sugg.repairedBoards >= sugg.totalBoards ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{sugg.repairedBoards}/{sugg.totalBoards} fixed</span>
                                                                            </div>
                                                                            <div className="mt-1">Recruit {groupRecruitCohorts(sugg.cohorts).join(', ')}.</div>
                                                                            {(sugg.impact || sugg.capNote) && <div className="mt-1 text-[11px] text-gray-500">{sugg.impact}{sugg.capNote ? ` ${sugg.capNote}.` : ''}</div>}
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
                timeoutData={timeoutData}
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
