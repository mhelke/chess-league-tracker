import { useEffect, useState } from 'react'
import { findRecruitCandidatesForTier, parseTierThreshold } from '../utils/recruitmentCandidates'

const SOURCE_LABELS = {
    'sub-league': 'Sub-League',
    'league': 'Parent League',
    'other-league': 'Other League',
}

const INITIAL_ROWS_PER_TIER = 5
const ROWS_PER_EXPANSION = 5

const SOURCE_BADGE_STYLES = {
    'sub-league': 'bg-blue-100 text-blue-700 border border-blue-200',
    'league': 'bg-purple-100 text-purple-700 border border-purple-200',
    'other-league': 'bg-amber-100 text-amber-700 border border-amber-200',
}

function SkeletonRow() {
    return (
        <tr className="animate-pulse border-b border-gray-100">
            <td className="py-3 px-3"><div className="h-3 w-32 bg-gray-200 rounded" /></td>
            <td className="py-3 px-3"><div className="h-3 w-12 bg-gray-200 rounded mx-auto" /></td>
            <td className="py-3 px-3"><div className="h-4 w-20 bg-gray-200 rounded-full mx-auto" /></td>
            <td className="py-3 px-3"><div className="h-7 w-32 bg-gray-200 rounded mx-auto" /></td>
            <td className="py-3 px-3"><div className="h-6 w-16 bg-gray-200 rounded mx-auto" /></td>
        </tr>
    )
}

// Every tier's table shares this column layout so their contents stay aligned even though each is a separate <table>.
function TierColumns() {
    return (
        <colgroup>
            <col style={{ width: '25%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '33%' }} />
            <col style={{ width: '14%' }} />
        </colgroup>
    )
}

function formatLastOnline(lastOnlineAt) {
    if (!lastOnlineAt) return '—'
    const match = String(lastOnlineAt).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!match) return lastOnlineAt
    const onlineMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    const now = new Date()
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const ageDays = Math.floor((todayMs - onlineMs) / 86400000)
    if (ageDays === 0) return 'Today'
    if (ageDays === 1) return 'Yesterday'
    if (ageDays >= 0 && ageDays <= 7) return `${ageDays} days ago`
    return lastOnlineAt
}

function formatTimeout(candidate) {
    const timeoutPercent = candidate.timeoutPercent === null || candidate.timeoutPercent === undefined
        ? null
        : candidate.timeoutPercent
    if (timeoutPercent === 0) return '0%'
    const percent = timeoutPercent === null
        ? null
        : `${timeoutPercent}%`
    const count = candidate.memberServiceTotalTimeouts === null || candidate.memberServiceTotalTimeouts === undefined
        ? null
        : `${candidate.memberServiceTotalTimeouts} timeout${candidate.memberServiceTotalTimeouts === 1 ? '' : 's'}`
    return [percent, count].filter(Boolean).join(' · ') || '—'
}

function usernameStyle(username) {
    const length = Math.max(String(username || '').length, 1)
    return { fontSize: `${Math.min(14, Math.max(9, 260 / length))}px` }
}

function SuggestedRecruitsModal({ isOpen, onClose, data, playerRatings, leagueName, subLeagueName, round, tiers, existingUsernames }) {
    const [loading, setLoading] = useState(true)
    const [candidatesByTier, setCandidatesByTier] = useState({})
    const [expandedTiers, setExpandedTiers] = useState({})

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'unset'
        }
        return () => { document.body.style.overflow = 'unset' }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return
        setLoading(true)
        setExpandedTiers({})
        // Defer to the next tick so the loading skeleton has a chance to render.
        const timer = setTimeout(() => {
            const result = {}
            // A player only belongs to their highest-qualifying tier; claim the
            // complete pool there first so Show More never creates duplicates below.
            const claimedUsernames = new Set()
            const tiersHighestFirst = [...new Set(tiers || [])].sort((a, b) => parseTierThreshold(b) - parseTierThreshold(a))
            tiersHighestFirst.forEach(tier => {
                const candidates = findRecruitCandidatesForTier(
                    data,
                    leagueName,
                    subLeagueName,
                    round,
                    parseTierThreshold(tier),
                    [...(existingUsernames || []), ...claimedUsernames],
                    playerRatings,
                )
                candidates.forEach(candidate => claimedUsernames.add(candidate.username.toLowerCase()))
                result[tier] = candidates
            })
            setCandidatesByTier(result)
            setLoading(false)
        }, 0)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, tiers, round, leagueName, subLeagueName, playerRatings])

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                <div className="flex justify-between items-start px-6 py-5 border-b border-gray-200 flex-shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Suggested Recruits</h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Active players from league history matching each rating tier
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none flex-shrink-0"
                        aria-label="Close"
                    >×</button>
                </div>

                <div className="overflow-y-auto [scrollbar-gutter:stable] flex-1 px-6 py-4 space-y-6">
                    {(tiers || []).map(tier => {
                        const candidates = candidatesByTier[tier] || []
                        const extraRows = expandedTiers[tier] || 0
                        const visibleCount = INITIAL_ROWS_PER_TIER + extraRows
                        const visibleCandidates = candidates.slice(0, visibleCount)
                        return (
                            <div key={tier}>
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <h4 className="text-sm font-bold text-gray-800">{tier} Tier</h4>
                                    {!loading && candidates.length > INITIAL_ROWS_PER_TIER && (
                                        <div className="flex items-center gap-3">
                                            {visibleCount < candidates.length && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedTiers(previous => ({
                                                        ...previous,
                                                        [tier]: Math.min(
                                                            (previous[tier] || 0) + ROWS_PER_EXPANSION,
                                                            candidates.length - INITIAL_ROWS_PER_TIER,
                                                        ),
                                                    }))}
                                                    className="text-[11px] font-semibold text-chess-green hover:underline"
                                                >
                                                    Show more ({candidates.length - visibleCount} remaining)
                                                </button>
                                            )}
                                            {extraRows > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedTiers(previous => ({ ...previous, [tier]: 0 }))}
                                                    className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 hover:underline"
                                                >
                                                    Show less
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="sm:hidden space-y-2">
                                    {loading ? (
                                        <>
                                            <div className="h-28 animate-pulse rounded-lg bg-gray-100" />
                                            <div className="h-28 animate-pulse rounded-lg bg-gray-100" />
                                        </>
                                    ) : candidates.length === 0 ? (
                                        <div className="py-4 px-3 text-center text-gray-400 text-xs border border-gray-100 rounded-lg">
                                            No matching players found in league history for this tier
                                        </div>
                                    ) : visibleCandidates.map(candidate => (
                                        <div key={candidate.username} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                                            <div className="flex items-start justify-between gap-3">
                                                <a
                                                    href={`https://www.chess.com/member/${candidate.username}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="min-w-0 break-words [overflow-wrap:anywhere] font-medium text-chess-green hover:text-green-700 hover:underline"
                                                >
                                                    {candidate.username}
                                                </a>
                                                <span className="flex-shrink-0 font-semibold text-gray-700">{candidate.rating}</span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${SOURCE_BADGE_STYLES[candidate.source]}`}>
                                                    {SOURCE_LABELS[candidate.source]}
                                                </span>
                                                {!candidate.hasVariantHistory && (
                                                    <span className="text-[10px] text-gray-400">Other variant</span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-4 text-gray-600">
                                                <div title="Target-variant league matches in the last 90 days">Leagues: {candidate.variantMatches90Days}</div>
                                                <div>Total: {candidate.totalMatches90Days ?? '—'} / 90d</div>
                                                <div>Online: {formatLastOnline(candidate.lastOnlineAt)}</div>
                                                <div>TO: {formatTimeout(candidate)}</div>
                                            </div>
                                            <a
                                                href={`https://www.chess.com/messages/compose/${candidate.username}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block w-full text-center text-xs font-medium text-white bg-chess-green hover:bg-green-700 px-2.5 py-1.5 rounded"
                                            >
                                                Message
                                            </a>
                                        </div>
                                    ))}
                                </div>

                                <div className="hidden sm:block overflow-hidden">
                                <table className="w-full text-sm border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
                                    <TierColumns />
                                    <thead>
                                        <tr className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wide">
                                            <th className="text-left py-2 px-3 font-semibold rounded-tl-lg">Username</th>
                                            <th className="text-center py-2 px-3 font-semibold">Rating</th>
                                            <th className="text-center py-2 px-3 font-semibold">Source</th>
                                            <th className="text-center py-2 px-3 font-semibold">Activity</th>
                                            <th className="text-center py-2 px-3 font-semibold rounded-tr-lg">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <>
                                                <SkeletonRow />
                                                <SkeletonRow />
                                            </>
                                        ) : candidates.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-4 px-3 text-center text-gray-400 text-xs">
                                                    No matching players found in league history for this tier
                                                </td>
                                            </tr>
                                        ) : visibleCandidates.map((candidate, idx) => (
                                            <tr key={candidate.username} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                                                <td className="py-2.5 px-3 font-medium align-top">
                                                    <a
                                                        href={`https://www.chess.com/member/${candidate.username}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-chess-green hover:text-green-700 hover:underline break-words [overflow-wrap:anywhere]"
                                                    >
                                                        {candidate.username}
                                                    </a>
                                                </td>
                                                <td className="py-2.5 px-3 text-center text-gray-700">{candidate.rating}</td>
                                                <td className="py-2.5 px-3 text-center">
                                                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${SOURCE_BADGE_STYLES[candidate.source]}`}>
                                                        {SOURCE_LABELS[candidate.source]}
                                                    </span>
                                                    {!candidate.hasVariantHistory && (
                                                        <div className="text-[10px] text-gray-400 mt-1">Other variant</div>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-2 text-center text-[10px] leading-4 text-gray-600 align-top">
                                                    <div title="Target-variant league matches in the last 90 days">
                                                        Leagues: {candidate.variantMatches90Days} · Total: {candidate.totalMatches90Days ?? '—'}
                                                    </div>
                                                    <div title="Last online and member-service timeout data">
                                                        Online: {formatLastOnline(candidate.lastOnlineAt)} · TO: {formatTimeout(candidate)}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                    <a
                                                        href={`https://www.chess.com/messages/compose/${candidate.username}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-block text-xs font-medium text-white bg-chess-green hover:bg-green-700 px-2.5 py-1 rounded"
                                                    >
                                                        Message
                                                    </a>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default SuggestedRecruitsModal
