import { useEffect, useState } from 'react'

/**
 * Derives a flat per-player timeline from the registrationHistory array.
 *
 * Each history entry looks like:
 *   { ts, our: { added: [], removed: [] }, opp: { added: [], removed: [] } }
 *
 * Returns an array of player objects:
 *   { username, team: 'our'|'opp', joinedTs, removedTs, isRemoved }
 *
 * Players who were removed and later re-added show their most-recent join date.
 * The removedTs is set to the most-recent removal (null if currently active).
 */
export function derivePlayerTimeline(history) {
    if (!history || history.length === 0) return []

    // Track join/remove events per username per team
    // Map key: `${team}:${username}`
    const events = new Map()

    const ensureEntry = (team, username) => {
        const key = `${team}:${username}`
        if (!events.has(key)) {
            events.set(key, { username, team, joinedTs: null, removedTs: null })
        }
        return events.get(key)
    }

    for (const entry of history) {
        const { ts } = entry
        for (const team of ['our', 'opp']) {
            const side = entry[team]
            if (!side) continue
            for (const username of (side.added || [])) {
                const e = ensureEntry(team, username)
                e.joinedTs = ts
                // If they were re-added, clear any previous removal
                e.removedTs = null
            }
            for (const username of (side.removed || [])) {
                const e = ensureEntry(team, username)
                e.removedTs = ts
            }
        }
    }

    return Array.from(events.values()).map(e => ({
        ...e,
        isRemoved: e.removedTs !== null,
    }))
}

function formatTs(isoString) {
    if (!isoString) return '—'
    const d = new Date(isoString)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function PlayerRow({ player }) {
    return (
        <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
            <td className="py-2 px-3 font-medium whitespace-nowrap">
                <div className="flex items-center gap-2">
                    <a
                        href={`https://www.chess.com/member/${player.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-chess-green hover:text-green-700 hover:underline text-sm"
                    >
                        {player.username}
                    </a>
                    {player.isRemoved && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                            Removed
                        </span>
                    )}
                </div>
            </td>
            <td className="py-2 px-3 text-sm text-gray-600 whitespace-nowrap">
                {player.joinedTs ? (
                    <span className="inline-flex items-center gap-1">
                        <span className="text-green-600 font-bold">+</span>
                        {formatTs(player.joinedTs)}
                    </span>
                ) : '—'}
            </td>
            <td className="py-2 px-3 text-sm whitespace-nowrap">
                {player.isRemoved ? (
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                        <span className="font-bold">−</span>
                        {formatTs(player.removedTs)}
                    </span>
                ) : (
                    <span className="text-gray-400 text-xs">Active</span>
                )}
            </td>
        </tr>
    )
}

function CollapsibleTeamSection({ teamName, players, accentColor }) {
    const [expanded, setExpanded] = useState(false)

    if (players.length === 0) return null

    const active = players.filter(p => !p.isRemoved)
    const removed = players.filter(p => p.isRemoved)
    const sorted = [...active, ...removed]

    return (
        <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
            <button
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
                <div className="flex items-center gap-2">
                    <span className={`font-semibold text-sm ${accentColor}`}>{teamName}</span>
                    <span className="text-xs text-gray-500">
                        {active.length} active
                        {removed.length > 0 && (
                            <span className="ml-1 text-red-500">&middot; {removed.length} removed</span>
                        )}
                    </span>
                </div>
                <span className="text-gray-400 text-xs select-none">{expanded ? '▲' : '▼'}</span>
            </button>
            {expanded && (
                <table className="w-full text-sm border-separate border-spacing-0">
                    <thead>
                        <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide border-t border-gray-200">
                            <th className="text-left py-2 px-3 font-semibold">Player</th>
                            <th className="text-left py-2 px-3 font-semibold">Joined</th>
                            <th className="text-left py-2 px-3 font-semibold">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map(player => (
                            <PlayerRow key={player.username} player={player} />
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

/**
 * AuditLogModal
 *
 * Props:
 *   isOpen     (bool)
 *   onClose    (fn)
 *   matchName  (string)
 *   history    ([{ ts, our: { added, removed }, opp: { added, removed } }])
 */
function AuditLogModal({ isOpen, onClose, matchName, history, ourTeamName = 'Our Team', oppTeamName = 'Opponent' }) {
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
        const onKey = e => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    if (!isOpen) return null

    const timeline = derivePlayerTimeline(history)
    const ourPlayers = timeline.filter(p => p.team === 'our')
    const oppPlayers = timeline.filter(p => p.team === 'opp')



    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

                {/* Header */}
                <div className="flex justify-between items-start px-6 py-5 border-b border-gray-200 flex-shrink-0">
                    <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <span>📋</span>
                            Audit Log
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                                BETA
                            </span>
                        </h3>
                        <p className="text-sm text-gray-600 mt-0.5 line-clamp-1">{matchName}</p>
                        <p className="text-xs text-gray-500 mt-2">
                            This audit log records when players were added or removed from a match. It does not track the reason for removal, which may vary (e.g., voluntary withdrawal, admin action, club removal, or account closure). This should be used as a reference guide only. It may not reflect the complete context.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none flex-shrink-0"
                        aria-label="Close"
                    >×</button>
                </div>

                {/* Body */}
                <div className="overflow-auto flex-1 px-6 py-5">
                    {timeline.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No audit log available.</p>
                    ) : (
                        <>
                            {/* Expandable team sections — both collapsed by default for audit log style */}
                            <CollapsibleTeamSection
                                teamName={ourTeamName}
                                players={ourPlayers}
                                accentColor="text-blue-700"
                            />
                            <CollapsibleTeamSection
                                teamName={oppTeamName}
                                players={oppPlayers}
                                accentColor="text-purple-700"
                            />
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end px-6 py-4 border-t border-gray-200 flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

export default AuditLogModal
