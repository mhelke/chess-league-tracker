export interface RosterPlayer {
    username: string
    rating?: number
    [key: string]: unknown
}

export interface RoundLike {
    matchId?: string
    name?: string
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
    const startTime = round.startTime as number | null | undefined
    if (!Number.isFinite(startTime)) return true
    const ageDays = (Date.now() / 1000 - (startTime as number)) / 86400
    return ageDays <= RECENT_ROUND_WINDOW_DAYS
}

/**
 * Resolves the appropriate rating for a candidate based on the match variant.
 * Only the matching variant's rating from timeoutData is used; the other variant's
 * rating is never substituted since a chess960 rating is not comparable to a daily one.
 * The roster snapshot rating is only trusted as a fallback when it was itself captured
 * from a round of the same variant; otherwise it's a different rating type and unusable.
 */
function resolveVariantRating(
    username: string,
    fallbackRating: number | null | undefined,
    fallbackRatingVariant: MatchVariant,
    timeoutData: TimeoutDataLike | null | undefined,
    variant: MatchVariant,
): number | null {
    const risk = timeoutData?.players?.[username.toLowerCase()]
    const variantRating = variant === 'chess960' ? risk?.rating960 : risk?.dailyRating
    if (Number.isFinite(variantRating)) return variantRating as number
    if (fallbackRatingVariant !== variant) return null
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
        const roundVariant = detectMatchVariant(round.name, round.apiMetadata?.rules)
        if (requiredHistoricalVariant && roundVariant !== requiredHistoricalVariant) return
        const roster = round.registrationData?.ourRoster
        if (!roster) return
        roster.forEach(player => {
            const username = player?.username
            if (!username) return
            const key = username.toLowerCase()
            if (excludeUsernames.has(key) || found.has(key)) return
            const rating = resolveVariantRating(username, player.rating, roundVariant, timeoutData, variant)
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
    const variant = detectMatchVariant(currentRound?.name as string | undefined, currentRound?.apiMetadata?.rules)
    const exclude = new Set(existingUsernames.map(u => u.toLowerCase()))

    const league = data?.leagues?.[leagueName]
    const subLeague = league?.subLeagues?.[subLeagueName]
    const subLeagueRounds = subLeague?.rounds || []

    const findCandidates = (requiredHistoricalVariant?: MatchVariant): RecruitCandidate[] => {
        const subLeagueCandidates = collectRosterCandidates(
            subLeagueRounds, currentRound?.matchId, exclude, timeoutData, variant, minRating, 'sub-league', requiredHistoricalVariant
        )

        let candidates = subLeagueCandidates
        if (league) {
            const excludeAll = new Set([...exclude, ...candidates.map(c => c.username.toLowerCase())])
            const leagueRounds = Object.entries(league.subLeagues || {})
                .filter(([name]) => name !== subLeagueName)
                .flatMap(([, sl]) => sl.rounds || [])
            const leagueCandidates = collectRosterCandidates(
                leagueRounds, currentRound?.matchId, excludeAll, timeoutData, variant, minRating, 'league', requiredHistoricalVariant
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
