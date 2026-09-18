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

export interface PlayerRatingsLike {
    recruitmentEnabled?: boolean
    membershipStatus?: 'verified' | 'unverified'
    membershipVerifiedAt?: string | null
    sourceStatus?: 'ok' | 'stale' | 'unavailable' | 'disabled'
    sourceUpdatedAt?: string | null
    lastAttemptedAt?: string | null
    players?: {
        [username: string]: {
            dailyRating?: number | null
            rating960?: number | null
            fetchedAt?: string | null
        }
    }
}

export type MatchVariant = 'chess960' | 'daily'

export interface RecruitCandidate {
    username: string
    rating: number
    source: 'sub-league' | 'league' | 'other-league'
}

const MAX_CANDIDATES_PER_TIER = 5
const RECENT_ROUND_WINDOW_DAYS = 180

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
function isRecentRound(round: RoundLike): boolean {
    if (round.status === 'open' || round.status === 'in_progress') return true
    const startTime = round.startTime as number | null | undefined
    if (!Number.isFinite(startTime)) return true
    const ageDays = (Date.now() / 1000 - (startTime as number)) / 86400
    return ageDays <= RECENT_ROUND_WINDOW_DAYS
}

/**
 * Collects roster candidates from rounds whose own variant matches `variant`. The
 * member-service snapshot supplies the current variant-specific rating; its normal
 * daily/weekly cadence is accepted when the service is temporarily unavailable.
 */
function resolveCurrentRating(
    ratings: PlayerRatingsLike | null | undefined,
    username: string,
    variant: MatchVariant,
): number | null {
    if (ratings?.recruitmentEnabled !== true) return null
    if (ratings?.membershipStatus !== 'verified') return null
    const entry = ratings.players?.[username.toLowerCase()]
    if (!entry) return null
    const rating = variant === 'chess960' ? entry.rating960 : entry.dailyRating
    return Number.isFinite(rating) ? rating as number : null
}

function collectRosterCandidates(
    rounds: RoundLike[],
    excludeMatchId: string | undefined,
    excludeUsernames: Set<string>,
    variant: MatchVariant,
    minRating: number,
    source: RecruitCandidate['source'],
    playerRatings: PlayerRatingsLike | null | undefined,
): RecruitCandidate[] {
    const found = new Map<string, RecruitCandidate>()
    rounds.forEach(round => {
        if (round.matchId && round.matchId === excludeMatchId) return
        if (detectMatchVariant(round.name, round.apiMetadata?.rules) !== variant) return
        if (!isRecentRound(round)) return
        const usernames = [
            ...(round.registrationData?.ourRoster || []).map(player => player?.username),
            ...Object.keys(round.playerStats || {}),
        ]
        usernames.forEach(username => {
            if (!username) return
            const key = username.toLowerCase()
            if (excludeUsernames.has(key) || found.has(key)) return
            const rating = resolveCurrentRating(playerRatings, key, variant)
            if (rating === null || rating < minRating) return
            found.set(key, { username, rating, source })
        })
    })
    return Array.from(found.values())
}

/**
 * Finds up to 5 active player candidates at or above `minRating`, preferring players
 * already registered in other Sub-League matches before expanding to the main League.
 * Only roster snapshots from rounds matching the target match's variant are considered,
 * since a chess960 rating and a daily rating are not comparable.
 */
export function findRecruitCandidatesForTier(
    data: LeagueDataLike | null | undefined,
    leagueName: string,
    subLeagueName: string,
    currentRound: RoundLike | null | undefined,
    minRating: number,
    existingUsernames: string[],
    playerRatings: PlayerRatingsLike | null | undefined,
    maxResults: number = MAX_CANDIDATES_PER_TIER,
): RecruitCandidate[] {
    const variant = detectMatchVariant(currentRound?.name as string | undefined, currentRound?.apiMetadata?.rules)
    const exclude = new Set(existingUsernames.map(u => u.toLowerCase()))

    const league = data?.leagues?.[leagueName]
    const subLeague = league?.subLeagues?.[subLeagueName]
    const subLeagueRounds = subLeague?.rounds || []

    const subLeagueCandidates = collectRosterCandidates(
        subLeagueRounds, currentRound?.matchId, exclude, variant, minRating, 'sub-league', playerRatings
    )

    let candidates = subLeagueCandidates
    if (league) {
        const excludeAll = new Set([...exclude, ...candidates.map(c => c.username.toLowerCase())])
        const leagueRounds = Object.entries(league.subLeagues || {})
            .filter(([name]) => name !== subLeagueName)
            .flatMap(([, sl]) => sl.rounds || [])
        const leagueCandidates = collectRosterCandidates(
            leagueRounds, currentRound?.matchId, excludeAll, variant, minRating, 'league', playerRatings
        )
        candidates = [...candidates, ...leagueCandidates]
    }

    // Also check recent rounds in every other league so no higher-rated
    // candidate is missed here only to surface in a lower tier's search.
    if (data?.leagues) {
        const excludeAll = new Set([...exclude, ...candidates.map(c => c.username.toLowerCase())])
        const otherLeagueRounds = Object.entries(data.leagues)
            .filter(([name]) => name !== leagueName)
            .flatMap(([, otherLeague]) => Object.values(otherLeague.subLeagues || {}))
            .flatMap(sl => sl.rounds || [])
            .filter(isRecentRound)
        const otherLeagueCandidates = collectRosterCandidates(
            otherLeagueRounds, currentRound?.matchId, excludeAll, variant, minRating, 'other-league', playerRatings
        )
        candidates = [...candidates, ...otherLeagueCandidates]
    }

    return candidates
        .sort((a, b) => b.rating - a.rating)
        .slice(0, maxResults)
}

/** Cohort labels look like "1850+"; the leading number is the recruit rating threshold. */
export function parseTierThreshold(tierLabel: string): number {
    const match = tierLabel.match(/(\d+)/)
    return match ? Number(match[1]) : 0
}
