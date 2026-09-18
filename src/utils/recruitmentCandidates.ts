export interface RosterPlayer {
    username: string
    rating?: number
    [key: string]: unknown
}

export interface RoundLike {
    matchId?: string
    name?: string
    status?: string
    startTime?: number | null
    playerStats?: { [username: string]: unknown }
    apiMetadata?: {
        rules?: string | null
        maxRating?: number | null
        [key: string]: unknown
    } | null
    registrationData?: {
        type: string
        ourRoster?: RosterPlayer[]
        oppRoster?: RosterPlayer[]
    } | null
    [key: string]: unknown
}

export interface SubLeagueLike {
    rounds?: RoundLike[]
    [key: string]: unknown
}

export interface LeagueLike {
    subLeagues?: { [subLeagueName: string]: SubLeagueLike }
    [key: string]: unknown
}

export interface LeagueDataLike {
    leagues?: { [leagueName: string]: LeagueLike }
    [key: string]: unknown
}

export interface PlayerRatingEntry {
    dailyRating?: number | null
    rating960?: number | null
    memberServiceTimeoutPercent?: number | null
    memberServiceTotalTimeouts?: number | null
    totalMatches90Days?: number | null
    lastOnlineAt?: string | null
    fetchedAt?: string | null
    [key: string]: unknown
}

export interface PlayerRatingsLike {
    recruitmentEnabled?: boolean
    membershipStatus?: 'verified' | 'unverified'
    membershipVerifiedAt?: string | null
    sourceStatus?: 'ok' | 'stale' | 'unavailable' | 'disabled'
    sourceUpdatedAt?: string | null
    lastAttemptedAt?: string | null
    players?: { [username: string]: PlayerRatingEntry }
}

export type MatchVariant = 'chess960' | 'daily'
export type RecruitCandidateSource = 'sub-league' | 'league' | 'other-league'

export interface RecruitCandidate {
    username: string
    rating: number
    source: RecruitCandidateSource
    sourceRank: number
    hasVariantHistory: boolean
    variantMatches90Days: number
    subLeagueMatches90Days: number
    leagueMatches90Days: number
    otherLeagueMatches90Days: number
    otherVariantMatches90Days: number
    totalMatches90Days: number | null
    lastOnlineAt: string | null
    onlineWithin2Days: boolean
    timeoutPercent: number | null
    memberServiceTotalTimeouts: number | null
}

const MAX_CANDIDATES_PER_TIER = 5
const RECENT_ROUND_WINDOW_DAYS = 180
const ACTIVITY_WINDOW_DAYS = 90
const PREFERRED_RATING_WINDOW = 50
const DAY_SECONDS = 86400
const SOURCE_RANK: Record<RecruitCandidateSource, number> = {
    'sub-league': 3,
    'league': 2,
    'other-league': 1,
}

/**
 * Chess960 matches are identified by the API's authoritative `apiMetadata.rules` field.
 * The match title is only used as a fallback when that metadata is unavailable, since
 * titles like "TCMAC ARENA S3 PLAYOFF" don't always mention "960" despite being chess960.
 */
export function detectMatchVariant(matchName: string | null | undefined, apiRules?: string | null): MatchVariant {
    if (apiRules) return apiRules.toLowerCase() === 'chess960' ? 'chess960' : 'daily'
    return /\b(?:chess\s*)?960\b/i.test(matchName || '') ? 'chess960' : 'daily'
}

/** Rounds without a startTime can't be aged, so they're treated as recent rather than excluded. */
function isRecentRound(round: RoundLike, days = RECENT_ROUND_WINDOW_DAYS): boolean {
    if (round.status === 'open' || round.status === 'in_progress') return true
    const startTime = round.startTime as number | null | undefined
    if (!Number.isFinite(startTime)) return true
    const ageDays = (Date.now() / 1000 - (startTime as number)) / DAY_SECONDS
    return ageDays <= days
}

function isWithinActivityWindow(round: RoundLike): boolean {
    return isRecentRound(round, ACTIVITY_WINDOW_DAYS)
}

function roundIdentity(round: RoundLike, index: number): string {
    return String(round.matchId || `${round.name || 'round'}:${round.startTime ?? 'unknown'}:${index}`)
}

function numericOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function onlineWithinTwoDays(lastOnlineAt: string | null | undefined): boolean {
    if (!lastOnlineAt) return false
    const match = String(lastOnlineAt).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!match) return false
    const onlineMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    const now = new Date()
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const ageDays = Math.floor((todayMs - onlineMs) / (DAY_SECONDS * 1000))
    return ageDays >= 0 && ageDays <= 2
}

function resolveCurrentEntry(
    ratings: PlayerRatingsLike | null | undefined,
    username: string,
): PlayerRatingEntry | null {
    if (ratings?.recruitmentEnabled !== true) return null
    if (ratings?.membershipStatus !== 'verified') return null
    return ratings.players?.[username.toLowerCase()] || null
}

function resolveCurrentRating(
    ratings: PlayerRatingsLike | null | undefined,
    username: string,
    variant: MatchVariant,
): number | null {
    const entry = resolveCurrentEntry(ratings, username)
    if (!entry) return null
    return numericOrNull(variant === 'chess960' ? entry.rating960 : entry.dailyRating)
}

/**
 * Chess.com represents an under-rating section such as U1800 with a
 * `maxRating` of 1800. Ratings at that boundary are not eligible, so a player
 * must be at most 1799 for that match. Leave the search uncapped when the feed
 * does not provide a numeric cap.
 */
function resolveExclusiveMatchCap(round: RoundLike | null | undefined): number | null {
    const maxRating = round?.apiMetadata?.maxRating
    return typeof maxRating === 'number' && Number.isFinite(maxRating)
        ? Math.ceil(maxRating) - 1
        : null
}

interface CandidateAccumulator {
    username: string
    rating: number
    targetSource: RecruitCandidateSource | null
    targetSourceRank: number
    anySource: RecruitCandidateSource
    anySourceRank: number
    variantMatchIds: Set<string>
    subLeagueMatchIds: Set<string>
    leagueMatchIds: Set<string>
    otherLeagueMatchIds: Set<string>
    otherVariantMatchIds: Set<string>
    totalMatches90Days: number | null
    lastOnlineAt: string | null
    timeoutPercent: number | null
    memberServiceTotalTimeouts: number | null
}

function updateSource(acc: CandidateAccumulator, source: RecruitCandidateSource, targetVariant: boolean) {
    const rank = SOURCE_RANK[source]
    if (rank > acc.anySourceRank) {
        acc.anySource = source
        acc.anySourceRank = rank
    }
    if (targetVariant && rank > acc.targetSourceRank) {
        acc.targetSource = source
        acc.targetSourceRank = rank
    }
}

function collectRosterCandidates(
    rounds: RoundLike[],
    excludeMatchId: string | undefined,
    excludeUsernames: Set<string>,
    variant: MatchVariant,
    minRating: number,
    maxRating: number | null,
    source: RecruitCandidateSource,
    playerRatings: PlayerRatingsLike | null | undefined,
    found: Map<string, CandidateAccumulator>,
): void {
    rounds.forEach((round, roundIndex) => {
        if (round.matchId && round.matchId === excludeMatchId) return
        if (!isRecentRound(round)) return

        const roundVariant = detectMatchVariant(round.name, round.apiMetadata?.rules)
        const targetVariant = roundVariant === variant
        const usernames = new Set([
            ...(round.registrationData?.ourRoster || []).map(player => player?.username),
            ...Object.keys(round.playerStats || {}),
        ].filter(Boolean).map(username => String(username)))
        const matchId = roundIdentity(round, roundIndex)
        const activityWindow = isWithinActivityWindow(round)

        usernames.forEach(username => {
            const key = username.toLowerCase()
            if (excludeUsernames.has(key)) return
            const entry = resolveCurrentEntry(playerRatings, key)
            const rating = resolveCurrentRating(playerRatings, key, variant)
            if (rating === null || rating < minRating || (maxRating !== null && rating > maxRating)) return

            let acc = found.get(key)
            if (!acc) {
                acc = {
                    username,
                    rating,
                    targetSource: null,
                    targetSourceRank: 0,
                    anySource: source,
                    anySourceRank: SOURCE_RANK[source],
                    variantMatchIds: new Set(),
                    subLeagueMatchIds: new Set(),
                    leagueMatchIds: new Set(),
                    otherLeagueMatchIds: new Set(),
                    otherVariantMatchIds: new Set(),
                    totalMatches90Days: numericOrNull(entry?.totalMatches90Days),
                    lastOnlineAt: entry?.lastOnlineAt || null,
                    timeoutPercent: numericOrNull(entry?.memberServiceTimeoutPercent),
                    memberServiceTotalTimeouts: numericOrNull(entry?.memberServiceTotalTimeouts),
                }
                found.set(key, acc)
            }

            updateSource(acc, source, targetVariant)
            if (!activityWindow) return
            if (targetVariant) {
                acc.variantMatchIds.add(matchId)
                if (source !== 'other-league') acc.leagueMatchIds.add(matchId)
                if (source === 'sub-league') acc.subLeagueMatchIds.add(matchId)
                if (source === 'other-league') acc.otherLeagueMatchIds.add(matchId)
            } else {
                acc.otherVariantMatchIds.add(matchId)
            }
        })
    })
}

function compareCandidates(a: RecruitCandidate, b: RecruitCandidate, minRating: number): number {
    if (a.hasVariantHistory !== b.hasVariantHistory) return a.hasVariantHistory ? -1 : 1
    const aPreferred = a.rating <= minRating + PREFERRED_RATING_WINDOW
    const bPreferred = b.rating <= minRating + PREFERRED_RATING_WINDOW
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1
    if (a.sourceRank !== b.sourceRank) return b.sourceRank - a.sourceRank
    if (a.onlineWithin2Days !== b.onlineWithin2Days) return a.onlineWithin2Days ? -1 : 1
    if (a.variantMatches90Days !== b.variantMatches90Days) return b.variantMatches90Days - a.variantMatches90Days

    if (a.totalMatches90Days !== null && b.totalMatches90Days !== null
        && a.totalMatches90Days !== b.totalMatches90Days) {
        return b.totalMatches90Days - a.totalMatches90Days
    }
    if (a.timeoutPercent !== null && b.timeoutPercent !== null
        && a.timeoutPercent !== b.timeoutPercent) {
        return a.timeoutPercent - b.timeoutPercent
    }

    const distance = Math.abs(a.rating - minRating) - Math.abs(b.rating - minRating)
    return distance || a.rating - b.rating || a.username.localeCompare(b.username)
}

function materializeCandidate(acc: CandidateAccumulator): RecruitCandidate {
    const hasVariantHistory = acc.variantMatchIds.size > 0 || acc.targetSource !== null
    return {
        username: acc.username,
        rating: acc.rating,
        source: acc.targetSource || acc.anySource,
        sourceRank: acc.targetSourceRank || acc.anySourceRank,
        hasVariantHistory,
        variantMatches90Days: acc.variantMatchIds.size,
        subLeagueMatches90Days: acc.subLeagueMatchIds.size,
        leagueMatches90Days: acc.leagueMatchIds.size,
        otherLeagueMatches90Days: acc.otherLeagueMatchIds.size,
        otherVariantMatches90Days: acc.otherVariantMatchIds.size,
        totalMatches90Days: acc.totalMatches90Days,
        lastOnlineAt: acc.lastOnlineAt,
        onlineWithin2Days: onlineWithinTwoDays(acc.lastOnlineAt),
        timeoutPercent: acc.timeoutPercent,
        memberServiceTotalTimeouts: acc.memberServiceTotalTimeouts,
    }
}

/**
 * Finds active candidates within the match cap. The full ranked pool is returned
 * by default so the modal can reveal more rows without changing ordering.
 * Candidates with target-variant history always precede other-variant fallbacks.
 */
export function findRecruitCandidatesForTier(
    data: LeagueDataLike | null | undefined,
    leagueName: string,
    subLeagueName: string,
    currentRound: RoundLike | null | undefined,
    minRating: number,
    existingUsernames: string[],
    playerRatings: PlayerRatingsLike | null | undefined,
    maxResults: number = Number.POSITIVE_INFINITY,
): RecruitCandidate[] {
    const variant = detectMatchVariant(currentRound?.name as string | undefined, currentRound?.apiMetadata?.rules)
    const maxRating = resolveExclusiveMatchCap(currentRound)
    const exclude = new Set(existingUsernames.map(u => u.toLowerCase()))
    const league = data?.leagues?.[leagueName]
    const subLeague = league?.subLeagues?.[subLeagueName]
    const found = new Map<string, CandidateAccumulator>()

    collectRosterCandidates(
        subLeague?.rounds || [], currentRound?.matchId, exclude, variant,
        minRating, maxRating, 'sub-league', playerRatings, found,
    )
    if (league) {
        const leagueRounds = Object.entries(league.subLeagues || {})
            .filter(([name]) => name !== subLeagueName)
            .flatMap(([, sl]) => sl.rounds || [])
        collectRosterCandidates(
            leagueRounds, currentRound?.matchId, exclude, variant,
            minRating, maxRating, 'league', playerRatings, found,
        )
    }
    if (data?.leagues) {
        const otherLeagueRounds = Object.entries(data.leagues)
            .filter(([name]) => name !== leagueName)
            .flatMap(([, otherLeague]) => Object.values(otherLeague.subLeagues || {}))
            .flatMap(sl => sl.rounds || [])
        collectRosterCandidates(
            otherLeagueRounds, currentRound?.matchId, exclude, variant,
            minRating, maxRating, 'other-league', playerRatings, found,
        )
    }

    return Array.from(found.values())
        .map(materializeCandidate)
        .sort((a, b) => compareCandidates(a, b, minRating))
        .slice(0, maxResults)
}

/** Cohort labels look like "1850+"; the leading number is the recruit rating threshold. */
export function parseTierThreshold(tierLabel: string): number {
    const match = tierLabel.match(/(\d+)/)
    return match ? Number(match[1]) : 0
}
