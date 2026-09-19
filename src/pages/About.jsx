import { Link } from 'react-router-dom'

const METHODOLOGY_SECTIONS = [
    {
        title: 'Action Items',
        intro: 'Only open matches appear here, and only when the available data points to a decision worth reviewing.',
        points: [
            'Triggers include minimum-roster gaps, configured player-count deficits, board-rating mismatches, opponent recruitment surges, and HIGH timeout risk.',
            'A 50-point board balance threshold is used by default. Match or sub-league settings can provide different player-count thresholds.',
            'Severity increases when a minimum roster is unmet, most active boards are mismatched, or a high-risk player cannot be removed safely.',
        ],
    },
    {
        title: 'Open-match calendar',
        intro: 'Open matches are grouped by the browser’s local date and sorted by start time.',
        points: [
            'Search and league filters are applied before matches are grouped.',
            'The By league view remains available when league context is more useful than a calendar view.',
        ],
    },
    {
        title: 'Timeout visibility',
        intro: 'Timeout data supports both action-oriented alerts and quieter monitoring, with sensitivity settings that can be adjusted for the club.',
        points: [
            'HIGH risk can create an Action Item. MEDIUM and LOW risks remain available from the match card and timeout details.',
            'Removal safety simulates removing one player, re-sorts the remaining roster, and compares competitive board coverage while checking the minimum roster requirement.',
        ],
    },
    {
        title: 'Recruitment suggestions',
        intro: 'Recommendations model how roster changes would affect board coverage.',
        points: [
            'Rosters are sorted by rating to model board order, then candidate combinations are tested against board limits, rating ranges, and availability constraints.',
            'Suggestions can compare top-down and lower-rated approaches, including the rating tiers and boards each option would repair.',
        ],
    },
]

function About() {
    return (
        <div className="page-container">
            <div className="mb-8">
                <Link to="/" className="text-chess-green hover:underline">
                    ← Leagues
                </Link>
                <h2 className="mt-6 text-4xl font-bold text-chess-dark">About &amp; Methodology</h2>
                <p className="mt-3 max-w-3xl text-lg text-gray-600">
                    Chess League Tracker turns Chess.com club league data into a practical workspace for team admins.
                    Use Action Items for prioritized decisions and All Matches for broader browsing and monitoring.
                </p>
            </div>

            <section className="mb-8">
                <h3 className="mb-4 text-2xl font-bold text-gray-900">How it works</h3>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {METHODOLOGY_SECTIONS.map(section => (
                        <section key={section.title} className="card">
                            <h4 className="text-lg font-bold text-chess-dark">{section.title}</h4>
                            <p className="mt-2 text-sm leading-6 text-gray-600">{section.intro}</p>
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-600">
                                {section.points.map(point => <li key={point}>{point}</li>)}
                            </ul>
                        </section>
                    ))}
                </div>
            </section>

            <section className="mb-8 card">
                <h3 className="text-2xl font-bold text-gray-900">Configuration and admin support</h3>
                <div className="mt-3 space-y-4 text-sm leading-6 text-gray-600">
                    <p>
                        Admins can request adjustments to:
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>Which leagues and sub-leagues are tracked.</li>
                        <li>Minimum roster requirements and player-count deficit rules.</li>
                        <li>Board limits, rating ranges, and constraints used by recruitment suggestions.</li>
                        <li>Timeout sensitivity, including risk thresholds, HIGH/MEDIUM/LOW cutoffs, lookback windows, and recent-timeout triggers.</li>
                        <li>Recruitment features and the enrichment sources used for ratings, registration history, and timeout data.</li>
                    </ul>
                    <p>
                        Match data comes from the Chess.com Public API, with ratings, registration history, and timeout information added through
                        enrichment sources. Data is normally refreshed nightly, and recommendations remain decision support rather than guarantees.
                    </p>
                    <p>
                        If you are a club admin and need a league added, a threshold adjusted, or another site behavior changed, contact{' '}
                        <a
                            href="https://www.chess.com/member/MasterMatthew52"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-chess-green hover:underline"
                        >
                            MasterMatthew52 on Chess.com
                        </a>.
                    </p>
                </div>
            </section>

            <section className="rounded-lg border border-green-200 bg-green-50 p-6">
                <h3 className="text-xl font-bold text-green-900">Start with the admin workflow</h3>
                <p className="mt-2 text-sm leading-6 text-green-800">
                    Open Action Items for the prioritized view, then use All Matches when broader browsing or match-level monitoring is needed.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                    <Link to="/action-items" className="btn btn-primary">View Action Items</Link>
                    <Link to="/matches" className="btn btn-secondary">Browse All Matches</Link>
                </div>
            </section>
        </div>
    )
}

export default About
