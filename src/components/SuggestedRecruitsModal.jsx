import { useEffect, useState } from 'react'
import { findRecruitCandidatesForTier, parseTierThreshold } from '../utils/recruitmentCandidates'

const SOURCE_LABELS = {
    'sub-league': 'Sub-League',
    'league': 'Parent League',
    'other-league': 'Other League',
}

const SOURCE_BADGE_STYLES = {
    'sub-league': 'bg-blue-100 text-blue-700 border border-blue-200',
    'league': 'bg-purple-100 text-purple-700 border border-purple-200',
    'other-league': 'bg-amber-100 text-amber-700 border border-amber-200',
}

function SkeletonRow() {
    return (
        <tr className="animate-pulse border-b border-gray-100">
            <td className="py-3 px-3"><div className="h-3 w-24 bg-gray-200 rounded" /></td>
            <td className="py-3 px-3"><div className="h-3 w-12 bg-gray-200 rounded mx-auto" /></td>
            <td className="py-3 px-3"><div className="h-4 w-20 bg-gray-200 rounded-full mx-auto" /></td>
            <td className="py-3 px-3"><div className="h-6 w-16 bg-gray-200 rounded mx-auto" /></td>
        </tr>
    )
}

// Every tier's table shares this column layout so their contents stay aligned even though each is a separate <table>.
function TierColumns() {
    return (
        <colgroup>
            <col className="w-auto" />
            <col style={{ width: '20%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '22%' }} />
        </colgroup>
    )
}

function SuggestedRecruitsModal({ isOpen, onClose, data, playerRatings, leagueName, subLeagueName, round, tiers, existingUsernames }) {
    const [loading, setLoading] = useState(true)
    const [candidatesByTier, setCandidatesByTier] = useState({})

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
        // Defer to the next tick so the loading skeleton has a chance to render.
        const timer = setTimeout(() => {
            const result = {}
            // A player only belongs to their highest-qualifying tier; claim them there
            // first so lower tiers backfill with a different candidate instead.
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

                <div className="overflow-auto flex-1 px-6 py-4 space-y-6">
                    {(tiers || []).map(tier => {
                        const candidates = candidatesByTier[tier] || []
                        return (
                            <div key={tier}>
                                <h4 className="text-sm font-bold text-gray-800 mb-2">{tier} Tier</h4>
                                <table className="w-full text-sm border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
                                    <TierColumns />
                                    <thead>
                                        <tr className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wide">
                                            <th className="text-left py-2 px-3 font-semibold rounded-tl-lg">Username</th>
                                            <th className="text-center py-2 px-3 font-semibold">Rating</th>
                                            <th className="text-center py-2 px-3 font-semibold">Source</th>
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
                                                <td colSpan={4} className="py-4 px-3 text-center text-gray-400 text-xs">
                                                    No matching players found in league history for this tier
                                                </td>
                                            </tr>
                                        ) : candidates.map((candidate, idx) => (
                                            <tr key={candidate.username} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                                                <td className="py-2.5 px-3 font-medium truncate">
                                                    <a
                                                        href={`https://www.chess.com/member/${candidate.username}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-chess-green hover:text-green-700 hover:underline"
                                                    >
                                                        {candidate.username}
                                                    </a>
                                                </td>
                                                <td className="py-2.5 px-3 text-center text-gray-700">{candidate.rating}</td>
                                                <td className="py-2.5 px-3 text-center">
                                                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${SOURCE_BADGE_STYLES[candidate.source]}`}>
                                                        {SOURCE_LABELS[candidate.source]}
                                                    </span>
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
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default SuggestedRecruitsModal
