import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'

const RISK_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 }

const RISK_BADGE_STYLES = {
    HIGH: 'bg-red-100 text-red-800 border border-red-300 ring-1 ring-red-400',
    MEDIUM: 'bg-amber-100 text-amber-800 border border-amber-300',
    LOW: 'bg-blue-100 text-blue-700 border border-blue-200',
}

const ROW_BG = {
    HIGH: 'bg-red-50',
    MEDIUM: 'bg-amber-50/60',
    LOW: 'bg-blue-50/30',
}

// Solid (opaque) equivalents for the sticky column — prevents scroll bleed-through
const STICKY_BG = {
    HIGH: 'bg-red-50',
    MEDIUM: 'bg-amber-50',
    LOW: 'bg-blue-50',
}

function RiskBadge({ level, reason }) {
    const [visible, setVisible] = useState(false)
    const [pos, setPos] = useState({ top: 0, left: 0 })
    const badgeRef = useRef(null)

    if (!level) return <span className="text-gray-300">—</span>

    const handleMouseEnter = () => {
        if (badgeRef.current) {
            const rect = badgeRef.current.getBoundingClientRect()
            setPos({ top: rect.bottom + 8, left: rect.left })
        }
        setVisible(true)
    }

    return (
        <div className="inline-flex justify-center w-full">
            <span
                ref={badgeRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setVisible(false)}
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold cursor-help select-none ${RISK_BADGE_STYLES[level] || 'bg-gray-100 text-gray-700'}`}
                aria-label={reason || level}
            >
                {level}
            </span>
            {reason && visible && createPortal(
                <div
                    style={{ position: 'fixed', top: pos.top, left: pos.left }}
                    className="z-[9999] w-80 bg-gray-900 text-white text-xs rounded-lg p-2.5 shadow-2xl pointer-events-none leading-relaxed whitespace-normal"
                >
                    {reason}
                    <div className="absolute bottom-full left-4 border-[6px] border-transparent border-b-gray-900"></div>
                </div>,
                document.body
            )}
        </div>
    )
}

function NumCell({ value, warn, danger }) {
    const v = value ?? 0
    const cls = v > 0 && danger ? 'text-red-700 font-semibold' :
        v > 0 && warn ? 'text-amber-700 font-medium' :
            v > 0 ? 'text-gray-700 font-medium' : 'text-gray-400'
    return <span className={cls}>{v}</span>
}

function TimeoutModal({ isOpen, onClose, title, players, threshold = 25, highPct = 50 }) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'unset'
        }
        return () => { document.body.style.overflow = 'unset' }
    }, [isOpen])

    if (!isOpen) return null

    // Only at-risk players, sorted HIGH → MEDIUM → LOW then alphabetically
    const sortedPlayers = [...players]
        .filter(p => p.riskFlag)
        .sort((a, b) => {
            const ra = RISK_ORDER[a.riskLevel] ?? 99
            const rb = RISK_ORDER[b.riskLevel] ?? 99
            if (ra !== rb) return ra - rb
            return a.username.localeCompare(b.username)
        })

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-[95vw] xl:max-w-7xl max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex justify-between items-start px-6 py-5 border-b border-gray-200 flex-shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {sortedPlayers.length === 0
                                ? 'No at-risk players in this match'
                                : `${sortedPlayers.length} at-risk player${sortedPlayers.length !== 1 ? 's' : ''} · hover the risk badge for details`}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none flex-shrink-0"
                        aria-label="Close"
                    >×</button>
                </div>

                {/* Table */}
                <div className="overflow-auto flex-1 px-6 py-4">
                    {sortedPlayers.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No at-risk players to display</p>
                    ) : (
                        <table className="w-full text-sm border-separate border-spacing-0">
                            <thead>
                                <tr className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wide">
                                    <th className="text-left py-2.5 px-3 font-semibold sticky left-0 bg-gray-100 z-10 whitespace-nowrap rounded-tl-lg">Username</th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">Risk</th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">Daily&nbsp;Rating</th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">960&nbsp;Rating</th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">Timeout&nbsp;%</th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">League TOs<br /><span className="font-normal normal-case text-[10px] text-gray-400">90 days</span></th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">Subleague<br /><span className="font-normal normal-case text-[10px] text-gray-400">TOs (all-time)</span></th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">1-day<br /><span className="font-normal normal-case text-[10px] text-gray-400">TOs</span></th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">2-day<br /><span className="font-normal normal-case text-[10px] text-gray-400">TOs</span></th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap">3-day<br /><span className="font-normal normal-case text-[10px] text-gray-400">TOs</span></th>
                                    <th className="text-center py-2.5 px-3 font-semibold whitespace-nowrap rounded-tr-lg">Last TO Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedPlayers.map((player, idx) => {
                                    const bg = ROW_BG[player.riskLevel] || (idx % 2 === 0 ? 'bg-gray-50' : 'bg-white')
                                    const stickyBg = STICKY_BG[player.riskLevel] || (idx % 2 === 0 ? 'bg-gray-50' : 'bg-white')
                                    const daily = player.dailyTimeouts || {}
                                    const allDates = ['1day', '2day', '3day']
                                        .map(k => daily[k]?.lastTimeoutDate)
                                        .filter(Boolean)
                                    const lastDate = allDates.length > 0 ? [...allDates].sort().at(-1) : null
                                    const pct = player.timeoutPercent

                                    return (
                                        <tr key={player.username} className={`${bg} border-b border-gray-100 hover:brightness-[0.97] transition-colors`}>
                                            {/* Username */}
                                            <td className={`py-3 px-3 font-medium sticky left-0 ${stickyBg} z-10 whitespace-nowrap`}>
                                                <a
                                                    href={`https://www.chess.com/member/${player.username}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-chess-green hover:text-green-700 hover:underline"
                                                >
                                                    {player.username}
                                                </a>
                                            </td>

                                            {/* Risk badge */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <RiskBadge level={player.riskLevel} reason={player.riskReason} />
                                            </td>

                                            {/* Daily Rating */}
                                            <td className="py-3 px-3 text-center text-gray-800 font-medium whitespace-nowrap">
                                                {player.dailyRating ?? '—'}
                                            </td>

                                            {/* 960 Rating */}
                                            <td className="py-3 px-3 text-center text-gray-800 font-medium whitespace-nowrap">
                                                {player.rating960 ?? '—'}
                                            </td>

                                            {/* Timeout % */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <span className={`font-bold ${pct > highPct ? 'text-red-700' : pct > threshold ? 'text-amber-700' : 'text-gray-500'}`}>
                                                    {pct != null ? `${pct.toFixed(1)}%` : '—'}
                                                </span>
                                            </td>

                                            {/* 90-day league TOs */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <NumCell value={player.totalLeagueTimeouts90Days} warn />
                                            </td>

                                            {/* Subleague TOs */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <NumCell value={player.subleagueTimeouts} danger />
                                            </td>

                                            {/* 1-day TOs */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <NumCell value={daily['1day']?.count} warn />
                                            </td>

                                            {/* 2-day TOs */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <NumCell value={daily['2day']?.count} warn />
                                            </td>

                                            {/* 3-day TOs */}
                                            <td className="py-3 px-3 text-center whitespace-nowrap">
                                                <NumCell value={daily['3day']?.count} warn />
                                            </td>

                                            {/* Last TO Date */}
                                            <td className="py-3 px-3 text-center text-gray-600 text-xs whitespace-nowrap">
                                                {lastDate ?? '—'}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-between items-center px-6 py-4 border-t border-gray-200 flex-shrink-0">
                    <p className="text-xs text-gray-400">TO = Timeout &nbsp;·&nbsp; Subleague TOs count only active sub-leagues (last 2 months)</p>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium text-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

export default TimeoutModal
