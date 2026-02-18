function Leaderboard({ players, showRank = false }) {
    if (!players || players.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500">
                No players yet
            </div>
        )
    }

    const getMedalEmoji = (rank) => {
        if (rank === 1) return '🥇'
        if (rank === 2) return '🥈'
        if (rank === 3) return '🥉'
        return null
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="table-header">
                    <tr>
                        {showRank && (
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Rank
                            </th>
                        )}
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Player
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Games
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Wins
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Draws
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Losses
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Points
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Win Rate
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {players.map((player, index) => {
                        const rank = index + 1
                        const winRate = player.games > 0
                            ? ((player.wins / player.games) * 100).toFixed(1)
                            : '0.0'
                        const medal = showRank ? getMedalEmoji(rank) : null

                        return (
                            <tr key={player.username} className="table-row">
                                {showRank && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        <div className="flex items-center space-x-2">
                                            {medal && <span className="text-xl">{medal}</span>}
                                            <span>{rank}</span>
                                        </div>
                                    </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <a
                                        href={`https://www.chess.com/member/${player.username}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-chess-green hover:text-green-700 font-medium"
                                    >
                                        {player.username}
                                    </a>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                                    {player.games}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-green-600 font-medium">
                                    {player.wins}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                                    {player.draws}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-red-600 font-medium">
                                    {player.losses}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-chess-dark font-bold">
                                    {player.points}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-700">
                                    {winRate}%
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

export default Leaderboard
