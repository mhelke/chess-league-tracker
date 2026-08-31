/**
 * Compute average ratings and the differential for a roster matchup.
 *
 * Only boards that will actually face an opponent are counted: rosters are
 * paired rank-for-rank (both are pre-sorted desc by rating), so when one
 * team has more registered players than the other, the extra low-ranked
 * players on the larger roster have no opponent and are excluded. An
 * optional `cap` (e.g. maxTeamPlayers) further limits the pairing.
 */
export function computeMatchupRatings(ourRoster = [], oppRoster = [], cap = 0) {
    const pairCount = cap
        ? Math.min(ourRoster.length, oppRoster.length, cap)
        : Math.min(ourRoster.length, oppRoster.length)

    const ourRatings = ourRoster.slice(0, pairCount).map(p => p.rating).filter(r => r)
    const oppRatings = oppRoster.slice(0, pairCount).map(p => p.rating).filter(r => r)

    const ourAvg = ourRatings.length > 0 ? ourRatings.reduce((a, b) => a + b, 0) / ourRatings.length : 0
    const oppAvg = oppRatings.length > 0 ? oppRatings.reduce((a, b) => a + b, 0) / oppRatings.length : 0

    return { ourAvg, oppAvg, avgDiff: ourAvg - oppAvg, pairCount, ourRatings, oppRatings }
}
