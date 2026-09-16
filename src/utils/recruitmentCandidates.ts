export interface RosterPlayer {
    username: string
    rating?: number
    [key: string]: unknown
}

export interface RoundLike {
    matchId?: string
    name?: string
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

export interface PlayerRiskLike {
    dailyRating?: number | null
    rating960?: number | null
    riskFlag?: boolean
    [key: string]: unknown
}

export interface TimeoutDataLike {
    players?: { [username: string]: PlayerRiskLike }
    [key: string]: unknown
}

export type MatchVariant = 'chess960' | 'daily'

export interface RecruitCandidate {
    username: string
    rating: number
    source: 'sub-league' | 'league' | 'other-league'
}

const MIN_SUBLEAGUE_CANDIDATES = 3
const MAX_CANDIDATES_PER_TIER = 5
const RECENT_ROUND_WINDOW_DAYS = 180

/** Chess960 matches are identified by their title; every other daily match uses the standard rating. */
export function detectMatchVariant(matchName: string | null | undefined): MatchVariant {
    return /\b(?:chess\s*)?960\b/i.test(matchName || '') ? 'chess960' : 'daily'
}

/** Rounds without a startTime can't be aged, so they're treated as recent rather than excluded. */
function isRecentRound(round: RoundLike): boolean {
    const startTime = round.startTime as number | null | undefined
    if (!Number.isFinite(startTime)) return true
    const ageDays = (Date.now() / 1000 - (startTime as number)) / 86400
    return ageDays <= RECENT_ROUND_WINDOW_DAYS
}

/** The variant-specific rating from timeoutData.json is authoritative; the roster snapshot rating is only a fallback. */
function resolveVariantRating(
    username: string,
    fallbackRating: number | null | undefined,
    timeoutData: TimeoutDataLike | null | undefined,
    variant: MatchVariant,
): number | null {
    const risk = timeoutData?.players?.[username.toLowerCase()]
    const variantRating = variant === 'chess960' ? risk?.rating960 : risk?.dailyRating
    if (Number.isFinite(variantRating)) return variantRating as number
    return Number.isFinite(fallbackRating) ? (fallbackRating as number) : null
}

function collectRosterCandidates(
    rounds: RoundLike[],
    excludeMatchId: string | undefined,
    excludeUsernames: Set<string>,
    timeoutData: TimeoutDataLike | null | undefined,
    variant: MatchVariant,
    minRating: number,
    source: RecruitCandidate['source'],
    requiredHistoricalVariant?: MatchVariant,
): RecruitCandidate[] {
    const found = new Map<string, RecruitCandidate>()
    rounds.forEach(round => {
        if (round.matchId && round.matchId === excludeMatchId) return
        if (requiredHistoricalVariant && detectMatchVariant(round.name) !== requiredHistoricalVariant) return
        const roster = round.registrationData?.ourRoster
        if (!roster) return
        roster.forEach(player => {
            const username = player?.username
            if (!username) return
            const key = username.toLowerCase()
            if (excludeUsernames.has(key) || found.has(key)) return
            const rating = resolveVariantRating(username, player.rating, timeoutData, variant)
            if (rating === null || rating < minRating) return
            found.set(key, { username, rating, source })
        })
    })
    return Array.from(found.values())
}

/**
 * Finds up to 5 active player candidates at or above `minRating`, preferring players
 * already registered in other Sub-League matches before expanding to the parent League.
 * For Chess960 targets, players with Chess960 league history are used exclusively when
 * available; standard-match history is only used as a fallback.
 */
export function findRecruitCandidatesForTier(
    data: LeagueDataLike | null | undefined,
    timeoutData: TimeoutDataLike | null | undefined,
    leagueName: string,
    subLeagueName: string,
    currentRound: RoundLike | null | undefined,
    minRating: number,
    existingUsernames: string[],
    maxResults: number = MAX_CANDIDATES_PER_TIER,
): RecruitCandidate[] {
    const variant = detectMatchVariant(currentRound?.name as string | undefined)
    const exclude = new Set(existingUsernames.map(u => u.toLowerCase()))

    const league = data?.leagues?.[leagueName]
    const subLeague = league?.subLeagues?.[subLeagueName]
    const subLeagueRounds = subLeague?.rounds || []

    const findCandidates = (requiredHistoricalVariant?: MatchVariant): RecruitCandidate[] => {
        const subLeagueCandidates = collectRosterCandidates(
            subLeagueRounds, currentRound?.matchId, exclude, timeoutData, variant, minRating, 'sub-league', requiredHistoricalVariant
        )

        let candidates = subLeagueCandidates
        if (candidates.length < MIN_SUBLEAGUE_CANDIDATES && league) {
            const excludeAll = new Set([...exclude, ...candidates.map(c => c.username.toLowerCase())])
            const leagueRounds = Object.entries(league.subLeagues || {})
                .filter(([name]) => name !== subLeagueName)
                .flatMap(([, sl]) => sl.rounds || [])
            const leagueCandidates = collectRosterCandidates(
                leagueRounds, currentRound?.matchId, excludeAll, timeoutData, variant, minRating, 'league', requiredHistoricalVariant
            )
            candidates = [...candidates, ...leagueCandidates]
        }

        // Still short? Widen the net to recent rounds in every other league.
        if (candidates.length < MIN_SUBLEAGUE_CANDIDATES && data?.leagues) {
            const excludeAll = new Set([...exclude, ...candidates.map(c => c.username.toLowerCase())])
            const otherLeagueRounds = Object.entries(data.leagues)
                .filter(([name]) => name !== leagueName)
                .flatMap(([, otherLeague]) => Object.values(otherLeague.subLeagues || {}))
                .flatMap(sl => sl.rounds || [])
                .filter(isRecentRound)
            const otherLeagueCandidates = collectRosterCandidates(
                otherLeagueRounds, currentRound?.matchId, excludeAll, timeoutData, variant, minRating, 'other-league', requiredHistoricalVariant
            )
            candidates = [...candidates, ...otherLeagueCandidates]
        }

        return candidates
    }

    // A known Chess960 player is preferable to a standard-only player. Do not
    // constrain standard matches, where cross-variant history is acceptable.
    const chess960Candidates = variant === 'chess960' ? findCandidates('chess960') : []
    const candidates = chess960Candidates.length > 0 ? chess960Candidates : findCandidates()

    return candidates
        .sort((a, b) => b.rating - a.rating)
        .slice(0, maxResults)
}

/** Cohort labels look like "1850+"; the leading number is the recruit rating threshold. */
export function parseTierThreshold(tierLabel: string): number {
    const match = tierLabel.match(/(\d+)/)
    return match ? Number(match[1]) : 0
}
