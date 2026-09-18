export interface RatedPlayer {
    rating: number
    [key: string]: unknown
}

export interface BoardRatingRange {
    min?: number
    max?: number
}

export interface RecruitmentOptions {
    boardCap: number
    balanceThreshold?: number
    availabilityCeiling: number
    minAllowedRating?: number
    maxAllowedRating?: number
    boardMins?: number[]
    boardMaxs?: number[]
    boardRanges?: BoardRatingRange[]
    cohortStep?: number
    baseRating?: number
}

export interface RecruitCohort {
    min: number
    max: number
    rating: number
    assignedBoard: number
    tier: number
    /** Minimum legal rating that brings the recruit's final board within the threshold. */
    exactMinRequiredRating: number
}

export interface RecruitmentSolution {
    strategy: 'top-down' | 'alternative-full-coverage'
    recruits: RecruitCohort[]
    repairedBoards: number
    repairedBoardNumbers: number[]
    totalTargetBoards: number
    concededBoards: number[]
    score: number
    summaryLabel: string
}

export interface RecruitmentSolutions {
    solution1: RecruitmentSolution | null
    solution2: RecruitmentSolution | null
}

type Simulation = {
    recruits: RecruitCohort[]
    ratings: number[]
    repaired: number[]
    score: number
}

const DEFAULT_THRESHOLD = 50
const DEFAULT_COHORT_STEP = 100

function compactBoards(boards: number[]): string {
    if (!boards.length) return 'none'
    const chunks: string[] = []
    let start = boards[0]
    let end = start
    for (const board of boards.slice(1)) {
        if (board === end + 1) {
            end = board
        } else {
            chunks.push(start === end ? `${start}` : `${start}–${end}`)
            start = board
            end = board
        }
    }
    chunks.push(start === end ? `${start}` : `${start}–${end}`)
    return chunks.join(', ')
}

/** Ratings are sorted at every simulation boundary; roster input order is never relied upon. */
function sortedRatings(roster: RatedPlayer[]): number[] {
    return roster
        .map(player => Number(player?.rating))
        .filter(rating => Number.isFinite(rating))
        .sort((a, b) => b - a)
}

function isCompetitive(our: number | undefined, opponent: number | undefined, threshold: number): boolean {
    if (opponent === undefined) return true // No opposing board exists to repair.
    return our !== undefined && opponent - our <= threshold
}

function boardBounds(boardIndex: number, options: RecruitmentOptions): { min: number, max: number } {
    const range = options.boardRanges?.[boardIndex]
    return {
        min: Math.max(options.minAllowedRating ?? -Infinity, options.boardMins?.[boardIndex] ?? range?.min ?? -Infinity),
        max: Math.min(options.maxAllowedRating ?? Infinity, options.boardMaxs?.[boardIndex] ?? range?.max ?? Infinity),
    }
}

/**
 * The ceiling is intentionally calculated after sorting: a recruit's board cap
 * applies to the board where that recruit actually lands, not the board desired
 * before the cascade is simulated.
 */
function materializeRecruits(baseRatings: number[], candidateRatings: number[], options: RecruitmentOptions): RecruitCohort[] | null {
    const tagged = [
        ...baseRatings.map(rating => ({ rating, recruit: false })),
        ...candidateRatings.map(rating => ({ rating, recruit: true })),
    ].sort((a, b) => b.rating - a.rating)

    const active = tagged.slice(0, options.boardCap)
    const recruits: RecruitCohort[] = []
    const step = options.cohortStep ?? DEFAULT_COHORT_STEP
    const baseRating = options.baseRating ?? options.minAllowedRating ?? 0

    for (let index = 0; index < active.length; index++) {
        const player = active[index]
        if (!player.recruit) continue
        const bounds = boardBounds(index, options)
        const effectiveCeiling = Math.min(options.availabilityCeiling, bounds.max)
        if (player.rating < bounds.min || player.rating > effectiveCeiling) return null
        const cohortMin = Math.floor(player.rating / step) * step
        recruits.push({
            min: Math.max(cohortMin, bounds.min, options.minAllowedRating ?? -Infinity),
            max: Math.min(cohortMin + step - 1, effectiveCeiling),
            rating: player.rating,
            assignedBoard: index + 1,
            tier: (cohortMin - baseRating) / step,
            exactMinRequiredRating: player.rating,
        })
    }

    // A candidate below the active cutoff cannot be a recommendation.
    return recruits.length === candidateRatings.length ? recruits : null
}

function buildCohorts(options: RecruitmentOptions): number[] {
    const step = options.cohortStep ?? DEFAULT_COHORT_STEP
    const min = options.minAllowedRating ?? 0
    const max = Math.min(options.availabilityCeiling, options.maxAllowedRating ?? Infinity)
    const cohorts: number[] = []
    for (let floor = Math.ceil(min / step) * step; floor <= max; floor += step) {
        // The cohort's highest available rating gives the most conservative
        // test of its useful cascade while retaining its human-readable band.
        cohorts.push(Math.min(floor + step - 1, max))
    }
    return cohorts
}

function simulate(baseRatings: number[], oppRatings: number[], candidateRatings: number[], targetStart: number, activeBoards: number, options: RecruitmentOptions): Simulation | null {
    const materializedRecruits = materializeRecruits(baseRatings, candidateRatings, options)
    if (!materializedRecruits) return null
    const ratings = [...baseRatings, ...candidateRatings].sort((a, b) => b - a).slice(0, options.boardCap)
    const threshold = options.balanceThreshold ?? DEFAULT_THRESHOLD
    const recruits = materializedRecruits.map(recruit => {
        const boardIndex = recruit.assignedBoard - 1
        const bounds = boardBounds(boardIndex, options)
        const minimumToBalance = oppRatings[boardIndex] === undefined
            ? -Infinity
            : oppRatings[boardIndex] - threshold
        const exactMinRequiredRating = Math.max(bounds.min, minimumToBalance)
        return {
            ...recruit,
            exactMinRequiredRating: Number.isFinite(exactMinRequiredRating)
                ? exactMinRequiredRating
                : recruit.rating,
        }
    })
    const repaired = Array.from({ length: activeBoards }, (_, index) => index)
        .filter(index => index >= targetStart && isCompetitive(ratings[index], oppRatings[index], threshold))
        .map(index => index + 1)

    const baseline = Array.from({ length: activeBoards }, (_, index) => index)
        .filter(index => index >= targetStart && isCompetitive(baseRatings[index], oppRatings[index], threshold)).length
    const ownUncompetitive = recruits.some(recruit => {
        const index = recruit.assignedBoard - 1
        return !isCompetitive(recruit.rating, oppRatings[index], threshold)
    })
    // A recruit may take a difficult board only when the overall non-conceded
    // range gains boards; this prevents misleading depth recommendations.
    if (ownUncompetitive && repaired.length <= baseline) return null

    const avgTier = recruits.reduce((sum, recruit) => sum + recruit.tier, 0) / recruits.length
    return {
        recruits,
        ratings,
        repaired,
        score: repaired.length - recruits.length * 0.75 - avgTier * 0.15,
    }
}

function requiredRatingStats(simulation: Simulation): { max: number, sum: number } {
    const required = simulation.recruits.map(recruit => recruit.exactMinRequiredRating)
    return {
        max: required.length ? Math.max(...required) : 0,
        sum: required.reduce((sum, rating) => sum + rating, 0),
    }
}

function lowerHalfCoverage(simulation: Simulation, activeBoards: number): number {
    const lowerHalfStart = Math.floor(activeBoards / 2) + 1
    return simulation.repaired.filter(board => board >= lowerHalfStart).length
}

function compareCoveragePlans(
    left: Simulation,
    right: Simulation,
    oppRatings: number[],
    threshold: number,
    activeBoards: number,
    preferLowerThreshold: boolean = false,
): number {
    // Coverage is always the first priority. A full-cap solution must beat any
    // partial solution, regardless of which individual boards the partial plan fixes.
    if (left.repaired.length !== right.repaired.length) {
        return right.repaired.length - left.repaired.length
    }

    const leftLowerHalf = lowerHalfCoverage(left, activeBoards)
    const rightLowerHalf = lowerHalfCoverage(right, activeBoards)
    if (leftLowerHalf !== rightLowerHalf) return rightLowerHalf - leftLowerHalf

    const leftRequirements = requiredRatingStats(left)
    const rightRequirements = requiredRatingStats(right)

    if (preferLowerThreshold) {
        if (leftRequirements.max !== rightRequirements.max) {
            return leftRequirements.max - rightRequirements.max
        }
        if (leftRequirements.sum !== rightRequirements.sum) {
            return leftRequirements.sum - rightRequirements.sum
        }
        if (left.recruits.length !== right.recruits.length) {
            return left.recruits.length - right.recruits.length
        }
    } else {
        // The primary plan minimizes the number of recruits first. A lower
        // threshold then makes the plan easier to source when recruit counts tie.
        if (left.recruits.length !== right.recruits.length) {
            return left.recruits.length - right.recruits.length
        }
        if (leftRequirements.max !== rightRequirements.max) {
            return leftRequirements.max - rightRequirements.max
        }
        if (leftRequirements.sum !== rightRequirements.sum) {
            return leftRequirements.sum - rightRequirements.sum
        }
    }

    // Retain top-down ordering as the final tie-breaker, after coverage and
    // sourcing practicality have been considered.
    for (let index = 0; index < activeBoards; index++) {
        const leftFixesBoard = isCompetitive(left.ratings[index], oppRatings[index], threshold)
        const rightFixesBoard = isCompetitive(right.ratings[index], oppRatings[index], threshold)
        if (leftFixesBoard !== rightFixesBoard) return leftFixesBoard ? -1 : 1
    }
    return right.score - left.score
}

function planKey(simulation: Simulation): string {
    return simulation.recruits
        .map(recruit => recruit.exactMinRequiredRating)
        .sort((a, b) => a - b)
        .join(',')
}

function buildFullTopDownSolution(
    baseRatings: number[],
    oppRatings: number[],
    cohorts: number[],
    activeBoards: number,
    options: RecruitmentOptions,
): Simulation | null {
    const threshold = options.balanceThreshold ?? DEFAULT_THRESHOLD
    let candidateRatings: number[] = []
    let currentRatings = baseRatings.slice(0, options.boardCap)
    let best: Simulation | null = null

    // One additional recruit per pass is enough to model every cascade while
    // avoiding an exponential all-cohort combination search.
    for (let recruitCount = 0; recruitCount < activeBoards; recruitCount++) {
        const choices = cohorts.map(rating => ({
            candidateRatings: [...candidateRatings, rating],
            simulation: simulate(baseRatings, oppRatings, [...candidateRatings, rating], 0, activeBoards, options),
        })).filter((choice): choice is { candidateRatings: number[], simulation: Simulation } => choice.simulation !== null)
        if (!choices.length) break

        choices.sort((left, right) => compareCoveragePlans(
            left.simulation,
            right.simulation,
            oppRatings,
            threshold,
            activeBoards,
        ))
        const chosen = choices[0]
        const prior: Simulation = {
            recruits: [],
            ratings: currentRatings,
            repaired: Array.from({ length: activeBoards }, (_, index) => index + 1)
                .filter(board => isCompetitive(currentRatings[board - 1], oppRatings[board - 1], threshold)),
            score: 0,
        }
        if (compareCoveragePlans(chosen.simulation, prior, oppRatings, threshold, activeBoards) >= 0) break

        candidateRatings = chosen.candidateRatings
        currentRatings = chosen.simulation.ratings
        best = chosen.simulation
        const coversAllBoards = Array.from({ length: activeBoards }, (_, index) =>
            isCompetitive(currentRatings[index], oppRatings[index], threshold)
        ).every(Boolean)
        if (coversAllBoards) return best
    }
    return best
}

/**
 * Finds a full-coverage top-down solution and, when materially different, an
 * alternate full-coverage solution that favors lower minimum rating thresholds.
 * Candidate recruits are represented by 100-point cohorts by default.
 */
export function findRecruitmentSolutions(
    ourRoster: RatedPlayer[],
    oppRoster: RatedPlayer[],
    options: RecruitmentOptions,
): RecruitmentSolutions {
    if (!Number.isFinite(options.boardCap) || options.boardCap <= 0) {
        return { solution1: null, solution2: null }
    }

    const ourRatings = sortedRatings(ourRoster)
    const oppRatings = sortedRatings(oppRoster)
    const activeBoards = Math.min(options.boardCap, Math.max(ourRatings.length, oppRatings.length))
    if (!activeBoards) return { solution1: null, solution2: null }

    const threshold = options.balanceThreshold ?? DEFAULT_THRESHOLD
    const cohorts = buildCohorts(options)
    const baseRepaired = Array.from({ length: activeBoards }, (_, index) => index + 1)
        .filter(board => isCompetitive(ourRatings[board - 1], oppRatings[board - 1], threshold))
    const candidates: Simulation[] = [{
        recruits: [],
        ratings: ourRatings.slice(0, options.boardCap),
        repaired: baseRepaired,
        score: baseRepaired.length,
    }]
    for (const first of cohorts) {
        const one = simulate(ourRatings, oppRatings, [first], 0, activeBoards, options)
        if (one) candidates.push(one)
        for (const second of cohorts) {
            if (second > first) continue // Avoid duplicate recruit combinations.
            const two = simulate(ourRatings, oppRatings, [first, second], 0, activeBoards, options)
            if (two) candidates.push(two)
        }
    }

    // A full solution may require more than two recruits. Build a greedy,
    // coverage-first sequence until every active board is covered or no legal
    // insertion improves coverage.
    const fullTopDown = buildFullTopDownSolution(ourRatings, oppRatings, cohorts, activeBoards, options)
    if (fullTopDown) candidates.push(fullTopDown)

    const bestTop = [...candidates].sort((a, b) => compareCoveragePlans(
        a,
        b,
        oppRatings,
        threshold,
        activeBoards,
    ))[0]

    // Only expose a secondary plan when it also repairs every active board and
    // has a genuinely different rating/recruit tradeoff. A partial fallback is
    // less useful than a single clear, actionable full-coverage recommendation.
    const fullCandidates = candidates.filter(candidate => candidate.repaired.length === activeBoards)
    const bestLowerThreshold = [...fullCandidates].sort((a, b) => compareCoveragePlans(
        a,
        b,
        oppRatings,
        threshold,
        activeBoards,
        true,
    ))[0]
    const bestAlternative = bestLowerThreshold
        && planKey(bestLowerThreshold) !== planKey(bestTop)
        ? bestLowerThreshold
        : null

    const topSolution: RecruitmentSolution = {
        strategy: 'top-down',
        recruits: bestTop.recruits,
        repairedBoards: bestTop.repaired.length,
        repairedBoardNumbers: bestTop.repaired,
        totalTargetBoards: activeBoards,
        concededBoards: [],
        score: bestTop.score,
        summaryLabel: bestTop.recruits.length
            ? bestTop.repaired.length === activeBoards
                ? 'Fixes all active boards.'
                : `Fixes boards ${compactBoards(bestTop.repaired)}; no full-coverage plan was found within the configured caps.`
            : `No legal recruit improves the active boards; currently fixes boards ${compactBoards(bestTop.repaired)}.`,
    }

    const alternativeSolution = bestAlternative ? {
        strategy: 'alternative-full-coverage' as const,
        recruits: bestAlternative.recruits,
        repairedBoards: bestAlternative.repaired.length,
        repairedBoardNumbers: bestAlternative.repaired,
        totalTargetBoards: activeBoards,
        concededBoards: [],
        score: bestAlternative.score,
        summaryLabel: 'Alternative full-coverage plan with a lower rating threshold.',
    } : null

    return { solution1: topSolution, solution2: alternativeSolution }
}
