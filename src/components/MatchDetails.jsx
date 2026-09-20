import { computeMatchupRatings } from '../utils/ratingUtils'

function MatchDetails({ round }) {
    if (!round) return null

    const cap = round.maxTeamPlayers || 0
    const registration = round.registrationData
    const hasRoster = registration && registration.type === 'roster'

    let ourCount = round.registeredPlayers?.our ?? 0
    let oppCount = round.registeredPlayers?.opponent ?? 0
    let ourAvg = 0
    let oppAvg = 0
    let avgDiff = 0
    let pairCount = 0
    let ourRatings = []
    let oppRatings = []

    if (hasRoster) {
        const r = computeMatchupRatings(registration.ourRoster || [], registration.oppRoster || [], cap)
        ourAvg = Math.round(r.ourAvg)
        oppAvg = Math.round(r.oppAvg)
        avgDiff = Math.round(r.avgDiff)
        pairCount = r.pairCount
        ourRatings = r.ourRatings
        oppRatings = r.oppRatings
    }

    const boardDiffs = (round.boardsData || []).map(b => ({ boardNumber: b.boardNumber, diff: b.ratingDiff }))

    // Cohort comparison (100-point ranges) like All Matches page
    const ourCohorts = {}
    const oppCohorts = {}
    ourRatings.forEach(r => { const cohort = Math.floor(r / 100) * 100; ourCohorts[cohort] = (ourCohorts[cohort] || 0) + 1 })
    oppRatings.forEach(r => { const cohort = Math.floor(r / 100) * 100; oppCohorts[cohort] = (oppCohorts[cohort] || 0) + 1 })
    const allCohorts = new Set([...Object.keys(ourCohorts), ...Object.keys(oppCohorts)])
    const cohortComparison = Array.from(allCohorts)
        .map(c => parseInt(c))
        .sort((a, b) => a - b)
        .map(cohort => ({
            range: `${cohort}-${cohort + 100}`,
            our: ourCohorts[cohort] || 0,
            opp: oppCohorts[cohort] || 0,
            diff: (ourCohorts[cohort] || 0) - (oppCohorts[cohort] || 0)
        }))

    return (
        <div className="space-y-4 text-sm text-gray-700">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-xs text-gray-500">Players</div>
                    <div className="text-lg font-bold">{ourCount} vs {oppCount}</div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-gray-500">Avg Rating</div>
                    <div className={`text-lg font-bold ${avgDiff > 0 ? 'text-green-600' : avgDiff < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                        {ourAvg} · {oppAvg} · {avgDiff > 0 ? '+' : ''}{avgDiff}
                    </div>
                    <div className="text-xs text-gray-500">Boards counted: {pairCount}</div>
                </div>
            </div>

            {boardDiffs.length > 0 && (
                <div>
                    <div className="text-xs text-gray-500 mb-2">Board Differentials</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                        {boardDiffs.map(b => (
                            <div key={b.boardNumber} className="p-2 rounded border bg-white">
                                <div className="text-gray-500">B{b.boardNumber}</div>
                                <div className={`font-semibold ${b.diff > 0 ? 'text-green-600' : b.diff < 0 ? 'text-red-600' : 'text-gray-700'}`}>{b.diff > 0 ? '+' : ''}{b.diff ?? '—'}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {hasRoster && (
                <div>
                    <div className="text-xs text-gray-500 mb-2">Matched Ratings (top {pairCount})</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-[10px] text-gray-500">Our Ratings</div>
                            <div className="mt-1">{ourRatings.length > 0 ? ourRatings.join(', ') : '—'}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-gray-500">Opp Ratings</div>
                            <div className="mt-1">{oppRatings.length > 0 ? oppRatings.join(', ') : '—'}</div>
                        </div>
                    </div>

                    {cohortComparison.length > 0 && (
                        <div className="mt-3">
                            <div className="text-sm font-semibold text-gray-700 mb-2">Strength Distribution by Rating</div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                {cohortComparison.map((stat, idx) => (
                                    <div key={idx} className={`p-2.5 rounded-lg border-2 ${stat.diff < 0 ? 'bg-red-50 border-red-300' : stat.diff > 0 ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'}`}>
                                        <div className="text-xs font-semibold text-gray-700 mb-1.5">{stat.range}</div>
                                        <div className="flex justify-between items-center text-xs mb-1">
                                            <span className="font-medium text-chess-dark">{stat.our}</span>
                                            <span className="text-gray-400">vs</span>
                                            <span className="font-medium text-gray-700">{stat.opp}</span>
                                        </div>
                                        <div className={`text-center text-sm font-bold ${stat.diff > 0 ? 'text-green-600' : stat.diff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                            {stat.diff > 0 ? '+' : ''}{stat.diff}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default MatchDetails
