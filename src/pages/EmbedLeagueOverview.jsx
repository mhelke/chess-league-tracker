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

/** Urgency level for an open match based on roster vs minimum required */
function getUrgency(rosterCount, minTeamPlayers, boards) {
    const threshold = minTeamPlayers || boards
    if (!threshold) return null
    if (rosterCount < threshold) return 'critical'   // below required minimum
    if (rosterCount < boards) return 'low'            // registered but under full boards
    return null
}

function UrgencyBadge({ level }) {
    if (level === 'critical') {
        return (
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 flex-shrink-0" title="Players needed — below minimum">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                Need players
            </span>
        )
    }
    return null
}

function OpenMatchCard({ round, leagueName, subLeagueName }) {
    const opponent = parseOpponent(round.name)
    const roster = round.registrationData?.ourRoster ?? []
    const rosterCount = roster.length
    const boards = round.boards ?? 0
    const minTeamPlayers = round.minTeamPlayers ?? 0
    const startDate = round.startTime ? formatDate(round.startTime) : null
    const matchUrl = round.matchWebUrl || round.matchUrl
    const urgency = getUrgency(rosterCount, minTeamPlayers, boards)

    const borderColor = urgency === 'critical' ? 'border-red-300' : 'border-green-200'
    const bgColor = urgency === 'critical' ? 'bg-red-50' : 'bg-white'

    return (
        <a
            href={matchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`block ${bgColor} border ${borderColor} rounded-lg p-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
        >
            <div className="flex items-start justify-between gap-1.5 mb-0.5">
                <p className="text-xs font-semibold text-gray-900 truncate leading-tight flex-1" title={opponent}>
                    vs {opponent}
                </p>
                {urgency && <UrgencyBadge level={urgency} />}
            </div>
            <p className="text-xs text-gray-500 truncate mb-1">
                {leagueName} · {subLeagueName}{round.round && round.round !== 'NA' ? ` · ${round.round}` : ''}
            </p>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-400">
                <span>{boards}b</span>
                {rosterCount > 0 && (
                    <span className={urgency === 'critical' ? 'text-red-500 font-medium' : ''}>
                        {rosterCount}/{minTeamPlayers || boards} registered
                    </span>
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
    const [loading, setLoading] = useState(true)
    const [searchParams] = useSearchParams()
    const isEmbed = searchParams.get('embed') === '1'

    useEffect(() => {
        fetch('/data/leagueData.json')
            .then(r => r.json())
            .then(d => { setData(d); setLoading(false) })
            .catch(() => setLoading(false))
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
