import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Small inner modal that lists clickable links to the games where
 * a player resigned early.
 */
export function GameLinksModal({ isOpen, onClose, username, games }) {
    useEffect(() => {
        if (!isOpen) return
        const onKey = e => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    if (!isOpen) return null

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose} />
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-center px-5 py-4 border-b border-gray-200">
                    <div>
                        <h4 className="font-bold text-gray-900 text-sm">
                            <a
                                href={`https://www.chess.com/member/${username}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-chess-green hover:underline"
                            >
                                {username}
                            </a>
                            <span className="text-gray-600 font-normal"> — Early Resignations</span>
                        </h4>
                        <p className="text-xs text-gray-500 mt-0.5">{games.length} game{games.length !== 1 ? 's' : ''} found</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none flex-shrink-0"
                        aria-label="Close"
                    >×</button>
                </div>

                {/* Game list */}
                <ul className="px-5 py-4 space-y-2 overflow-auto max-h-80">
                    {games.map((game, i) => {
                        const moveLabel = game.moves_ply === 0
                            ? 'no moves played'
                            : `${game.moves_ply} move${game.moves_ply !== 1 ? 's' : ''}`
                        return (
                            <li key={i} className="flex items-center justify-between gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                                <span className="text-gray-500 text-xs">({moveLabel})</span>
                                <a
                                    href={game.game_api}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-shrink-0 text-xs font-medium text-chess-green hover:text-green-700 hover:underline whitespace-nowrap"
                                >
                                    View game →
                                </a>
                            </li>
                        )
                    })}
                </ul>
            </div>
        </div>,
        document.body
    )
}

/**
 * Main early-resignation modal.
 *
 * Props:
 *   isOpen   (bool)
 *   onClose  (fn)
 *   title    (string)
 *   players  ([{ username, matchEarlyResignations, games }])
 */
function EarlyResignModal({ isOpen, onClose, title, players }) {
    const [gameLinksFor, setGameLinksFor] = useState(null)   // { username, games }

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'unset'
            setGameLinksFor(null)
        }
        return () => { document.body.style.overflow = 'unset' }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return
        const onKey = e => {
            if (e.key === 'Escape') {
                if (gameLinksFor) setGameLinksFor(null)
                else onClose()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [isOpen, gameLinksFor, onClose])

    if (!isOpen) return null

    const sorted = [...players].sort((a, b) => b.matchEarlyResignations - a.matchEarlyResignations)

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

                {/* Modal */}
                <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

                    {/* Header */}
                    <div className="flex justify-between items-start px-6 py-5 border-b border-gray-200 flex-shrink-0">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <span>🏳️</span>
                                {title}
                            </h3>
                            <p className="text-sm text-gray-500 mt-0.5">
                                {sorted.length === 0
                                    ? 'No early resignations recorded'
                                    : `${sorted.length} player${sorted.length !== 1 ? 's' : ''} · click "Games" to view individual games`}
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
                        {sorted.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">No early resignation data to display</p>
                        ) : (
                            <table className="w-full text-sm border-separate border-spacing-0">
                                <thead>
                                    <tr className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wide">
                                        <th className="text-left py-2.5 px-3 font-semibold sticky left-0 bg-gray-100 z-10 rounded-tl-lg whitespace-nowrap">
                                            Username
                                        </th>
                                        <th className="text-center py-2.5 px-3 font-semibold rounded-tr-lg whitespace-nowrap">
                                            Games
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((player, idx) => {
                                        const rowBg = idx % 2 === 0 ? 'bg-rose-50/40' : 'bg-white'
                                        return (
                                            <tr
                                                key={player.username}
                                                className={`${rowBg} border-b border-gray-100 hover:brightness-[0.97] transition-colors`}
                                            >
                                                {/* Username */}
                                                <td className={`py-3 px-3 font-medium sticky left-0 ${idx % 2 === 0 ? 'bg-rose-50' : 'bg-white'} z-10 whitespace-nowrap`}>
                                                    <a
                                                        href={`https://www.chess.com/member/${player.username}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-chess-green hover:text-green-700 hover:underline"
                                                    >
                                                        {player.username}
                                                    </a>
                                                </td>

                                                {/* Games button */}
                                                <td className="py-3 px-3 text-center whitespace-nowrap">
                                                    <button
                                                        onClick={() => setGameLinksFor({ username: player.username, games: player.games })}
                                                        className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-200 transition-colors"
                                                    >
                                                        <span>🔗</span>
                                                        <span>{player.games.length} game{player.games.length !== 1 ? 's' : ''}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {/* Inner game-links modal rendered via portal above z-50 layer */}
            {gameLinksFor && (
                <GameLinksModal
                    isOpen={!!gameLinksFor}
                    onClose={() => setGameLinksFor(null)}
                    username={gameLinksFor.username}
                    games={gameLinksFor.games}
                />
            )}
        </>
    )
}

export default EarlyResignModal
