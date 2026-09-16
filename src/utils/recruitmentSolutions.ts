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
    strategy: 'top-down' | 'depth-first-fallback'
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

type FallbackSimulation = Simulation & {
    concessionCutoff: number
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

/** Tests raw board-level fixability (ignoring net-gain gating) so concession grouping can look one board at a time. */
function boardReachableWithCohorts(boardIndex: number, baseRatings: number[], oppRatings: number[], testCohorts: number[], options: RecruitmentOptions): boolean {
    const threshold = options.balanceThreshold ?? DEFAULT_THRESHOLD
    for (const first of testCohorts) {
        for (const combo of [[first], ...testCohorts.filter(second => second <= first).map(second => [first, second])]) {
            if (!materializeRecruits(baseRatings, combo, options)) continue
            const ratings = [...baseRatings, ...combo].sort((a, b) => b - a).slice(0, options.boardCap)
            if (isCompetitive(ratings[boardIndex], oppRatings[boardIndex], threshold)) return true
        }
    }
    return false
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

function compareTopDown(left: Simulation, right: Simulation, oppRatings: number[], threshold: number): number {
    for (let index = 0; index < oppRatings.length; index++) {
        const leftFixesBoard = isCompetitive(left.ratings[index], oppRatings[index], threshold)
        const rightFixesBoard = isCompetitive(right.ratings[index], oppRatings[index], threshold)
        if (leftFixesBoard !== rightFixesBoard) return leftFixesBoard ? -1 : 1
    }
    return right.repaired.length - left.repaired.length || left.recruits.length - right.recruits.length || right.score - left.score
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

        choices.sort((left, right) => compareTopDown(left.simulation, right.simulation, oppRatings, threshold))
        const chosen = choices[0]
        const prior: Simulation = {
            recruits: [],
            ratings: currentRatings,
            repaired: Array.from({ length: activeBoards }, (_, index) => index + 1)
                .filter(board => isCompetitive(currentRatings[board - 1], oppRatings[board - 1], threshold)),
            score: 0,
        }
        if (compareTopDown(chosen.simulation, prior, oppRatings, threshold) >= 0) break

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
 * Finds a top-board solution and an availability-aware depth-first fallback.
 * Candidate recruits are represented by 100-point cohorts by default and one
 * or two recruits are simulated for each strategy.
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

    const cohorts = buildCohorts(options)
    const candidates: Simulation[] = []
    for (const first of cohorts) {
        const one = simulate(ourRatings, oppRatings, [first], 0, activeBoards, options)
        if (one) candidates.push(one)
        for (const second of cohorts) {
            if (second > first) continue // Avoid duplicate recruit combinations.
            const two = simulate(ourRatings, oppRatings, [first, second], 0, activeBoards, options)
            if (two) candidates.push(two)
        }
    }

    // Solution 1 may require more than two recruits. Build a greedy,
    // board-prioritized sequence until every active board is covered or no
    // further legal insertion improves the top-down position.
    const fullTopDown = buildFullTopDownSolution(ourRatings, oppRatings, cohorts, activeBoards, options)
    if (fullTopDown) candidates.push(fullTopDown)

    const threshold = options.balanceThreshold ?? DEFAULT_THRESHOLD
    const baseRepaired = Array.from({ length: activeBoards }, (_, index) => index + 1)
        .filter(board => isCompetitive(ourRatings[board - 1], oppRatings[board - 1], threshold))
    const topCandidates = candidates.length ? candidates : [{ recruits: [], ratings: ourRatings, repaired: baseRepaired, score: baseRepaired.length }]
    const bestTop = [...topCandidates].sort((a, b) => compareTopDown(a, b, oppRatings, threshold))[0]
    const solution1MinRating = bestTop.recruits.length
        ? Math.min(...bestTop.recruits.map(recruit => recruit.rating))
        : null

    // A fallback must be genuinely more attainable than the direct strategy.
    // Cohort values are their ceilings, so this is strict cohort separation.
    const fallbackCohorts = solution1MinRating === null
        ? []
        : cohorts.filter(cohortCeiling => cohortCeiling < solution1MinRating)

    // Group every consecutive top board that no fallback-tier cohort can repair
    // (i.e. boards that would need a Solution-1-equivalent recruit) into the concession.
    let concessionCutoff = 0
    while (
        concessionCutoff < activeBoards
        && !isCompetitive(ourRatings[concessionCutoff], oppRatings[concessionCutoff], threshold)
        && !boardReachableWithCohorts(concessionCutoff, ourRatings, oppRatings, fallbackCohorts, options)
    ) concessionCutoff++

    const targetZoneTotal = activeBoards - concessionCutoff
    let bestFallback: FallbackSimulation | undefined
    if (targetZoneTotal > 0) {
        const baselineTargetRepaired = Array.from({ length: targetZoneTotal }, (_, index) => index + concessionCutoff)
            .filter(index => isCompetitive(ourRatings[index], oppRatings[index], threshold)).length
        const fallbackCandidates: FallbackSimulation[] = []
        for (const first of fallbackCohorts) {
            const one = simulate(ourRatings, oppRatings, [first], concessionCutoff, activeBoards, options)
            if (one && one.repaired.length > baselineTargetRepaired) {
                fallbackCandidates.push({
                    ...one,
                    concessionCutoff,
                    score: one.repaired.length * 2 - one.recruits.length * 0.75
                        - (one.recruits.reduce((sum, recruit) => sum + recruit.tier, 0) / one.recruits.length) * 0.05,
                })
            }
            for (const second of fallbackCohorts) {
                if (second > first) continue
                const two = simulate(ourRatings, oppRatings, [first, second], concessionCutoff, activeBoards, options)
                if (two && two.repaired.length > baselineTargetRepaired) {
                    fallbackCandidates.push({
                        ...two,
                        concessionCutoff,
                        score: two.repaired.length * 2 - two.recruits.length * 0.75
                            - (two.recruits.reduce((sum, recruit) => sum + recruit.tier, 0) / two.recruits.length) * 0.05,
                    })
                }
            }
        }
        // Suppress low-signal recommendations: the fallback must repair at least half of
        // the non-conceded target zone or add two net-new boards over the starting roster.
        const qualifyingCandidates = fallbackCandidates.filter(candidate =>
            candidate.repaired.length / targetZoneTotal >= 0.5
            || candidate.repaired.length - baselineTargetRepaired >= 2
        )
        // Repair count is the primary objective. Score then chooses the lighter,
        // lower-tier option only among cascades that repair the same target boards.
        bestFallback = [...qualifyingCandidates].sort((a, b) =>
            b.repaired.length - a.repaired.length || b.score - a.score || a.recruits.length - b.recruits.length
        )[0]
    }

    const topSolution: RecruitmentSolution = {
        strategy: 'top-down',
        recruits: bestTop.recruits,
        repairedBoards: bestTop.repaired.length,
        repairedBoardNumbers: bestTop.repaired,
        totalTargetBoards: activeBoards,
        concededBoards: [],
        score: bestTop.score,
        summaryLabel: bestTop.recruits.length
            ? `Fixes boards ${compactBoards(bestTop.repaired)}.`
            : `No legal recruit improves the active boards; currently fixes boards ${compactBoards(bestTop.repaired)}.`,
    }

    const fallbackSolution = bestFallback ? {
        strategy: 'depth-first-fallback' as const,
        recruits: bestFallback.recruits,
        repairedBoards: bestFallback.repaired.length,
        repairedBoardNumbers: bestFallback.repaired,
        totalTargetBoards: activeBoards - bestFallback.concessionCutoff,
        concededBoards: Array.from({ length: bestFallback.concessionCutoff }, (_, index) => index + 1),
        score: bestFallback.score,
        summaryLabel: bestFallback.concessionCutoff > 0
            ? `Concedes upper boards ${compactBoards(Array.from({ length: bestFallback.concessionCutoff }, (_, index) => index + 1))} to focus on lower boards ${compactBoards(Array.from({ length: activeBoards - bestFallback.concessionCutoff }, (_, index) => index + bestFallback.concessionCutoff + 1))}; fixes boards ${compactBoards(bestFallback.repaired)}.`
            : `Fixes boards ${compactBoards(bestFallback.repaired)}.`,
    } : null

    return { solution1: topSolution, solution2: fallbackSolution }
}
