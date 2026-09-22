import { computeMatchupRatings } from './ratingUtils.js'

export const BALANCE_THRESHOLD = 50
export const DEFAULT_PLAYER_DEFICIT_THRESHOLD = 3

const DAY_SECONDS = 24 * 60 * 60
const SURGE_WINDOW_SECONDS = DAY_SECONDS
const SURGE_IMMINENCE_SECONDS = 5 * DAY_SECONDS
const RISK_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 }

export function normalizeMatchId(matchId) {
    if (!matchId) return ''
    const value = String(matchId)
    const apiMatch = value.match(/\/match\/(\d+)/i)
    return apiMatch ? apiMatch[1] : value
}

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

export const numericRating = value => Number.isFinite(Number(value)) ? Number(value) : null

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
 * Simulates removing one roster player, including the rating-sort cascade
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
    const source = sources.find(value => Array.isArray(value)
        ? value.length > 0
        : value && typeof value === 'object' && Object.keys(value).length > 0)
    if (!source) return []
    if (Array.isArray(source)) return source
    if (historyTimestamp(source) !== null) return [source]
    return Object.entries(source).map(([timestamp, value]) => ({ ts: timestamp, added: value }))
}

function normalizeAddedPlayers(value) {
    if (!Array.isArray(value)) return []
    return value.map(player => {
        if (typeof player === 'string') return { username: player, rating: null }
        if (!player || typeof player !== 'object') return null
        const username = player.username ?? player.userName ?? player.handle ?? player.name
        if (!username) return null
        const rating = numericRating(player.rating ?? player.dailyRating ?? player.currentRating)
        return { username: String(username), rating }
    }).filter(Boolean)
}

function getRecentOpponentAdditions(round, nowSeconds = Date.now() / 1000) {
    const seen = new Set()
    const additions = []
    registrationHistoryEntries(round).forEach(entry => {
        const timestamp = historyTimestamp(entry)
        if (timestamp === null) return
        const age = nowSeconds - timestamp
        if (age < 0 || age > SURGE_WINDOW_SECONDS) return
        const opponent = entry?.opp ?? entry?.opponent ?? entry
        const added = opponent?.added
            ?? opponent?.joined
            ?? opponent?.joins
            ?? opponent?.playersAdded
            ?? opponent?.opponentPlayersAdded
            ?? opponent?.players
        normalizeAddedPlayers(added).forEach(player => {
            const key = player.username.toLowerCase()
            if (seen.has(key)) return
            seen.add(key)
            additions.push(player)
        })
    })
    return additions.sort((left, right) => (right.rating ?? -Infinity) - (left.rating ?? -Infinity))
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
    if (matchTime === null) {
        return {
            surgeRecruitment: false,
            opponentPlayersAdded24h: 0,
            recentOpponentAdditions: [],
            matchStartsInDays: null,
        }
    }
    const secondsUntilStart = matchTime - nowSeconds
    const matchImminent = secondsUntilStart >= 0 && secondsUntilStart <= SURGE_IMMINENCE_SECONDS
    const opponentPlayersAdded24h = getOpponentPlayersAdded24h(round, nowSeconds)
    return {
        surgeRecruitment: matchImminent && opponentPlayersAdded24h > 3,
        opponentPlayersAdded24h,
        recentOpponentAdditions: getRecentOpponentAdditions(round, nowSeconds),
        matchStartsInDays: Math.max(0, Math.ceil(secondsUntilStart / DAY_SECONDS)),
    }
}

/**
 * Returns all at-risk roster players for a match, regardless of risk level.
 * This is the shared source for the match-level monitoring indicators and modal.
 */
export function getTimeoutRiskPlayers({ round, timeoutData, leagueName, subLeagueName } = {}) {
    if (!timeoutData?.players) return []
    const roster = round?.registrationData?.ourRoster ?? []
    const opponentRoster = round?.registrationData?.oppRoster ?? []
    const ourCount = round?.registeredPlayers?.our ?? roster.length
    const minRequired = round?.minTeamPlayers || 0
    const boardCap = round?.maxTeamPlayers ?? round?.boards ?? Infinity
    const seen = new Set()
    const players = []

    roster.forEach(rosterPlayer => {
        const username = rosterPlayer?.username
        if (!username) return
        const key = String(username).toLowerCase()
        const td = timeoutData.players[key]
        if (!td?.riskFlag || seen.has(key)) return
        seen.add(key)
        const player = {
            username: String(username),
            dailyRating: td.dailyRating ?? null,
            rating960: td.rating960 ?? null,
            timeoutPercent: td.timeoutPercent ?? null,
            totalLeagueTimeouts90Days: td.totalLeagueTimeouts90Days ?? 0,
            subleagueTimeouts: td.subLeagueTimeouts?.[leagueName]?.[subLeagueName] ?? 0,
            dailyTimeouts: td.dailyTimeouts ?? {},
            riskFlag: true,
            riskLevel: String(td.riskLevel || '').toUpperCase() || null,
            riskReason: td.riskReason,
        }
        Object.assign(player, analyzeTimeoutRemoval(
            roster.find(candidate => String(candidate?.username || '').toLowerCase() === key),
            roster,
            opponentRoster,
            boardCap,
            ourCount,
            minRequired,
        ))
        players.push(player)
    })

    return players.sort((left, right) => {
        const riskDifference = (RISK_ORDER[left.riskLevel] ?? 99) - (RISK_ORDER[right.riskLevel] ?? 99)
        return riskDifference || left.username.localeCompare(right.username)
    })
}

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

/**
 * Evaluates one open match using the same inclusion rules as Action Items.
 * The optional recruitment builder keeps expensive recommendation generation
 * in Action Items while allowing other pages to use the same classifier.
 */
export function evaluateActionItemMatch({
    round,
    leagueName,
    subLeagueName,
    leagueData = {},
    subLeagueData = {},
    timeoutData,
    recruitmentEnabled = false,
    buildRecruitmentSuggestions,
} = {}) {
    if (!round || round.status !== 'open') return null

    const minRequired = round.minTeamPlayers || 0
    const ourCount = round.registeredPlayers?.our || 0
    const oppCount = round.registeredPlayers?.opponent || 0
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
        ratingDisadvantage = mismatchedBoards.length > 0
        showRecruitmentRecommendations = ratingDisadvantage
            || (!ratingDisadvantage && oppCount > ourCount)

        if (showRecruitmentRecommendations && recruitmentEnabled && buildRecruitmentSuggestions) {
            recruitmentSuggestions = buildRecruitmentSuggestions(
                round.registrationData.ourRoster || [],
                round.registrationData.oppRoster || [],
                cap,
                round,
                [leagueData, subLeagueData, leagueName, subLeagueName]
            )
        }
    }

    const timeoutRiskPlayers = getTimeoutRiskPlayers({ round, timeoutData, leagueName, subLeagueName })
    const highRiskTimeoutPlayers = timeoutRiskPlayers.filter(player => player.riskLevel === 'HIGH')
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

    if (!hasWarning) return null

    return {
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
            recentOpponentAdditions: surgeStatus.recentOpponentAdditions,
            matchStartsInDays: surgeStatus.matchStartsInDays,
            activeBoardCount,
            statusLevel: status.level,
            status,
            statusReasons: status.reasons,
            ratingDisadvantage,
            avgDiff: Math.round(avgDiff),
            mismatchedBoardCount: mismatchedBoards.length,
            mismatchedBoards: formatBoardNumbers(mismatchedBoards),
            recruitmentSuggestions,
            showRecruitmentRecommendations,
            highRiskTimeoutPlayers,
            hasTrappedHighRiskTimeout,
            hasSafeHighRiskTimeoutRemoval,
            playersWithHighTimeout,
            hasTimeoutWarning,
        },
    }
}

export function collectActionItems(data, timeoutData, options = {}) {
    if (!data?.leagues) return []
    const matches = []
    const {
        recruitmentEnabled = false,
        buildRecruitmentSuggestions,
    } = options

    Object.entries(data.leagues).forEach(([leagueName, leagueData]) => {
        Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
            ; (subLeagueData.rounds || []).forEach(round => {
                const evaluated = evaluateActionItemMatch({
                    round,
                    leagueName,
                    subLeagueName,
                    leagueData,
                    subLeagueData,
                    timeoutData,
                    recruitmentEnabled,
                    buildRecruitmentSuggestions,
                })
                if (evaluated) matches.push(evaluated)
            })
        })
    })

    return matches.sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
}
