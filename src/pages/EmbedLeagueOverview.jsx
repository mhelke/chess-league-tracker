import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// ─── helpers ────────────────────────────────────────────────────────────────

function getSubLeagueCategory(subLeagueData) {
    const rounds = subLeagueData.rounds
    if (rounds.some(r => r.status === 'open')) return 0
    if (rounds.some(r => r.status === 'in_progress')) return 1
    return 2
}

/** Club name fragments to exclude when parsing opponent from match name */
const OUR_CLUB_PATTERNS = {
    '1dpmc': /1\s*day\s*per\s*move/i,
    'teamusa': /team[\s-]*usa/i,
}

/** Extract opponent display name from match name string */
function parseOpponent(matchName = '') {
    const vsMatch = matchName.match(/:\s*(.+?)\s+vs\s+(.+)/i)
    if (!vsMatch) return matchName
    const sides = [vsMatch[1].trim(), vsMatch[2].trim()]
    const ours = OUR_CLUB_PATTERNS[__SITE_KEY__]
    return (ours ? sides.find(s => !ours.test(s)) : null) ?? sides[0]
}

function formatDate(timestamp) {
    if (!timestamp) return null
    return new Date(timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sortSubLeagues(entries) {
    return [...entries].sort(([, a], [, b]) => {
        const catA = getSubLeagueCategory(a)
        const catB = getSubLeagueCategory(b)
        if (catA !== catB) return catA - catB
        if (catA === 1) {
            const latestA = Math.max(...a.rounds.filter(r => r.status === 'in_progress').map(r => r.startTime || 0))
            const latestB = Math.max(...b.rounds.filter(r => r.status === 'in_progress').map(r => r.startTime || 0))
            return latestB - latestA
        }
        if (catA === 2) {
            const latestA = Math.max(...a.rounds.filter(r => r.endTime).map(r => r.endTime || 0))
            const latestB = Math.max(...b.rounds.filter(r => r.endTime).map(r => r.endTime || 0))
            return latestB - latestA
        }
        return 0
    })
}

// ─── Open Match Card ─────────────────────────────────────────────────────────

const RATING_GAP_THRESHOLD = 150 // avg pts across board-matched pairs

/**
 * Compute all urgency signals for an open match.
 * Returns { belowMin, playerGap, ratingGap }
 *   belowMin  – we are below the required minimum player count
 *   playerGap – opponent has >3 more players AND neither team is capped
 *   ratingGap – opponent's board-matched avg rating exceeds ours by ≥ threshold
 */
function getMatchWarnings(round) {
    const ourRoster = round.registrationData?.ourRoster ?? []
    const oppRoster = round.registrationData?.oppRoster ?? []
    const boards = round.boards ?? 0
    const minPlayers = round.minTeamPlayers ?? 0
    const cap = round.maxTeamPlayers || boards || minPlayers

    const ourCount = ourRoster.length
    const oppCount = oppRoster.length

    // 1. Below minimum
    const belowMin = cap > 0 && ourCount < minPlayers

    // 2. Player gap — skip if both teams have hit the board cap
    const bothCapped = cap > 0 && ourCount >= cap && oppCount >= cap
    const playerGap = !bothCapped && (oppCount - ourCount) > 3
        ? oppCount - ourCount
        : null

    // 3. Rating imbalance — board-matched pairs (both rosters already sorted desc)
    // Cap to maxTeamPlayers when set, so extra registered players don't skew the average
    let ratingGap = null
    const pairCount = Math.min(ourCount, oppCount, round.maxTeamPlayers || boards || Infinity)
    if (pairCount >= 2) {
        let totalDiff = 0
        for (let i = 0; i < pairCount; i++) {
            totalDiff += (oppRoster[i].rating ?? 0) - (ourRoster[i].rating ?? 0)
        }
        const avgDiff = Math.round(totalDiff / pairCount)
        if (avgDiff >= RATING_GAP_THRESHOLD) ratingGap = avgDiff
    }

    return { belowMin, playerGap, ratingGap }
}

function WarningBadges({ belowMin, playerGap, ratingGap }) {
    if (!belowMin && !playerGap && !ratingGap) return null
    return (
        <div className="flex flex-col items-center gap-0.5 mt-0.5">
            {belowMin && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5" title="Below required minimum — players needed">
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                    Need players
                </span>
            )}
            {playerGap && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5" title={`Opponent has ${playerGap} more players registered`}>
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9 6a3 3 0 1 1 6 0 3 3 0 0 1-6 0zM17 17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1zM3 8a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM1 15a1 1 0 0 1-1-1v-.5A3.5 3.5 0 0 1 3.5 10H5a1 1 0 0 1 0 2h-1.5A1.5 1.5 0 0 0 2 13.5V14a1 1 0 0 1-1 1z" /></svg>
                    +{playerGap} opp players
                </span>
            )}
            {ratingGap && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded px-1 py-0.5" title={`Opponent averages ~${ratingGap} pts higher per board`}>
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M12 7a1 1 0 01-1 1H9v1h2a1 1 0 010 2H9v1h2a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1h3a1 1 0 011 1zM5 4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H5zm0-2h10a3 3 0 013 3v10a3 3 0 01-3 3H5a3 3 0 01-3-3V5a3 3 0 013-3z" clipRule="evenodd" /></svg>
                    ~{ratingGap}pt outrated
                </span>
            )}
        </div>
    )
}

function TeamLogo({ icon, name, boards }) {
    return (
        <div className="flex flex-col items-center gap-0.5 min-w-0">
            {icon ? (
                <img src={icon} alt={name} className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200 flex-shrink-0" />
            ) : (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2m0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z" />
                    </svg>
                </div>
            )}
            <span className="text-xs font-bold text-gray-700">{boards}b</span>
        </div>
    )
}

function OpenMatchCard({ round, leagueName, subLeagueName, clubIcons, ourClubIcon }) {
    const ourRoster = round.registrationData?.ourRoster ?? []
    const oppRoster = round.registrationData?.oppRoster ?? []
    const rosterCount = ourRoster.length
    const boards = round.boards ?? 0
    const minTeamPlayers = round.minTeamPlayers ?? 0
    const maxTeamPlayers = round.maxTeamPlayers ?? 0
    const startDate = round.startTime ? formatDate(round.startTime) : null
    const matchUrl = round.matchWebUrl || round.matchUrl

    const { belowMin, playerGap, ratingGap } = getMatchWarnings(round)
    const hasWarning = belowMin || playerGap || ratingGap

    const oppClub = clubIcons?.[round.opponentClubId]
    const oppIcon = oppClub?.icon ?? null
    const oppName = oppClub?.name ?? parseOpponent(round.name)

    const borderColor = belowMin ? 'border-red-300' : hasWarning ? 'border-amber-300' : 'border-green-200'
    const bgColor = belowMin ? 'bg-red-50' : hasWarning ? 'bg-amber-50' : 'bg-white'

    // Show the cap when a team has met/exceeded it, otherwise show their actual count
    const ourBoardDisplay = maxTeamPlayers && rosterCount >= maxTeamPlayers ? maxTeamPlayers : rosterCount
    const oppBoardDisplay = maxTeamPlayers && oppRoster.length >= maxTeamPlayers ? maxTeamPlayers : oppRoster.length

    return (
        <a
            href={matchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`block ${bgColor} border ${borderColor} rounded-lg p-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
        >
            {/* Matchup row */}
            <div className="flex items-center gap-2 mb-1">
                <TeamLogo icon={ourClubIcon} name="Us" boards={ourBoardDisplay} />
                <div className="flex-1 min-w-0 text-center">
                    <p className="text-xs text-gray-400 font-medium">vs</p>
                    <WarningBadges belowMin={belowMin} playerGap={playerGap} ratingGap={ratingGap} />
                </div>
                <TeamLogo icon={oppIcon} name={oppName} boards={oppBoardDisplay} />
            </div>
            <p className="text-xs text-gray-500 truncate text-center mb-1">
                {leagueName} · {subLeagueName}{round.round && round.round !== 'NA' ? ` · ${round.round}` : ''}
            </p>
            <div className="flex justify-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-400">
                {rosterCount > 0 && (
                    maxTeamPlayers ? (
                        <span className={belowMin ? 'text-red-500 font-medium' : ''}>
                            {rosterCount}/{maxTeamPlayers} registered
                        </span>
                    ) : (
                        <span className={belowMin ? 'text-red-500 font-medium' : ''}>
                            {rosterCount}/{minTeamPlayers || boards}{minTeamPlayers && !maxTeamPlayers ? '+' : ''} registered
                        </span>
                    )
                )}
                {startDate && <span>{startDate}</span>}
            </div>
        </a>
    )
}


// ─── Sub-league Summary Card ─────────────────────────────────────────────────

function RecordPill({ wins, draws, losses }) {
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium">
            <span className="text-green-700 font-semibold">{wins}W</span>
            <span className="text-gray-300">/</span>
            <span className="text-yellow-700 font-semibold">{draws}D</span>
            <span className="text-gray-300">/</span>
            <span className="text-red-700 font-semibold">{losses}L</span>
        </span>
    )
}

function SubLeagueSummaryCard({ name, subLeagueData }) {
    const rounds = subLeagueData.rounds
    const category = getSubLeagueCategory(subLeagueData)
    const status = category === 0 ? 'open' : category === 1 ? 'in_progress' : 'finished'

    const totalRounds = rounds.length
    const record = subLeagueData.record || { wins: 0, draws: 0, losses: 0 }

    const activePlayers = new Set()
    rounds
        .filter(r => r.status === 'open' || r.status === 'in_progress')
        .forEach(r => {
            if (r.playerStats) Object.keys(r.playerStats).forEach(p => activePlayers.add(p))
            if (r.registrationData?.ourRoster) r.registrationData.ourRoster.forEach(p => activePlayers.add(p.username))
        })

    return (
        <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="text-xs font-semibold text-gray-900 leading-tight">{name}</h4>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                <RecordPill wins={record.wins} draws={record.draws} losses={record.losses} />
                <span className="text-gray-300">·</span>
                <span>{totalRounds} rounds</span>
                {activePlayers.size > 0 && (
                    <>
                        <span className="text-gray-300">·</span>
                        <span>{activePlayers.size} players</span>
                    </>
                )}
            </div>
        </div>
    )
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ children }) {
    return (
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
            {children}
        </h3>
    )
}

// ─── Main page ───────────────────────────────────────────────────────────────

function EmbedLeagueOverview() {
    const [data, setData] = useState(null)
    const [clubIcons, setClubIcons] = useState({})
    const [ourClubIcon, setOurClubIcon] = useState(null)
    const [loading, setLoading] = useState(true)
    const [searchParams] = useSearchParams()
    const isEmbed = searchParams.get('embed') === '1'

    useEffect(() => {
        fetch('/data/leagueData.json')
            .then(r => r.json())
            .then(leagueJson => {
                const clubId = leagueJson.clubId
                return Promise.all([
                    Promise.resolve(leagueJson),
                    fetch('/data/clubIcons.json').then(r => r.json()).catch(() => ({})),
                    clubId
                        ? fetch(`https://api.chess.com/pub/club/${clubId}`).then(r => r.json()).catch(() => null)
                        : Promise.resolve(null),
                ])
            })
            .then(([leagueJson, iconsJson, clubJson]) => {
                setData(leagueJson)
                setClubIcons(iconsJson || {})
                if (clubJson?.icon) setOurClubIcon(clubJson.icon)
                setLoading(false)
            }).catch(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-chess-green" />
            </div>
        )
    }

    if (!data) {
        return <p className="p-4 text-sm text-gray-500">Unable to load league data.</p>
    }

    const leagues = data.leagues || {}

    // Gather all open matches across every league/sub-league
    const openMatches = []
    // Gather sub-league summaries: active always, finished only if recent (≤90 days)
    const subLeagueGroups = []

    for (const [leagueName, leagueData] of Object.entries(leagues)) {
        const subEntries = sortSubLeagues(Object.entries(leagueData.subLeagues || {}))
        const groupCards = []

        for (const [subLeagueName, subLeagueData] of subEntries) {
            const cat = getSubLeagueCategory(subLeagueData)

            // Open rounds → section 1
            subLeagueData.rounds
                .filter(r => r.status === 'open')
                .forEach(r => openMatches.push({ round: r, leagueName, subLeagueName }))

            // Section 2: active only (open or in_progress)
            if (cat < 2) {
                groupCards.push([subLeagueName, subLeagueData])
            }
        }

        if (groupCards.length > 0) {
            subLeagueGroups.push({ leagueName, cards: groupCards })
        }
    }

    // Sort open matches: soonest start first
    openMatches.sort((a, b) => (a.round.startTime || 0) - (b.round.startTime || 0))

    const lastUpdated = data.lastUpdated
        ? new Date(data.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null

    return (
        <div className={`bg-gray-50 min-h-screen ${isEmbed ? 'p-2' : 'p-4'}`}>
            {!isEmbed && (
                <div className="mb-4">
                    <h2 className="text-lg font-bold text-chess-dark">League Overview</h2>
                    {lastUpdated && <p className="text-xs text-gray-500 mt-0.5">Updated {lastUpdated}</p>}
                </div>
            )}

            {/* ── Section 1: Open Matches ── */}
            {openMatches.length > 0 && (
                <section className="mb-6">
                    <SectionHeader>Open Matches ({openMatches.length})</SectionHeader>
                    <div className="space-y-2">
                        {openMatches.map(({ round, leagueName, subLeagueName }) => (
                            <OpenMatchCard
                                key={round.matchId}
                                round={round}
                                leagueName={leagueName}
                                subLeagueName={subLeagueName}
                                clubIcons={clubIcons}
                                ourClubIcon={ourClubIcon}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* ── Section 2: Sub-league summaries ── */}
            {subLeagueGroups.length > 0 && (
                <section>
                    <SectionHeader>Active Leagues</SectionHeader>
                    <div className="space-y-5">
                        {subLeagueGroups.map(({ leagueName, cards }) => (
                            <div key={leagueName}>
                                <p className="text-xs font-bold text-gray-500 mb-1.5">{leagueName}</p>
                                <div className="space-y-2">
                                    {cards.map(([subLeagueName, subLeagueData]) => (
                                        <SubLeagueSummaryCard
                                            key={subLeagueName}
                                            name={subLeagueName}
                                            subLeagueData={subLeagueData}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {openMatches.length === 0 && subLeagueGroups.length === 0 && (
                <p className="text-sm text-gray-500">No active league data available.</p>
            )}

            {isEmbed && lastUpdated && (
                <p className="text-xs text-gray-400 mt-4 text-right">Updated {lastUpdated}</p>
            )}
        </div>
    )
}

export default EmbedLeagueOverview
