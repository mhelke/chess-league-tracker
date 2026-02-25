/**
 * Build lookup index from raw earlyResignations.json data.
 *
 * Returns:
 *   byMatchUrl: { matchUrl -> [{username, color, moves_ply, game_api, board_api, matchWebUrl, subLeagueName}] }
 */
export function buildEarlyResignIndex(rawData) {
    const byMatchUrl = {}

    if (!rawData?.leagues) return { byMatchUrl }

    Object.entries(rawData.leagues).forEach(([, leagueVal]) => {
        Object.entries(leagueVal.subLeagues || {}).forEach(([subLeagueName, subVal]) => {
            ; (subVal.matches || []).forEach(match => {
                const matchUrl = match.matchUrl
                const matchWebUrl = match.matchWebUrl
                    ; (match.players || []).forEach(player => {
                        const uname = (player.username || '').toLowerCase()
                        if (!uname) return
                        if (!byMatchUrl[matchUrl]) byMatchUrl[matchUrl] = []
                        byMatchUrl[matchUrl].push({ ...player, username: uname, matchWebUrl, subLeagueName })
                    })
            })
        })
    })

    return { byMatchUrl }
}

/**
 * Given an earlyResignIndex and a matchUrl, return the modal player array
 * for finished / in-progress matches.
 *
 * Each entry contains only games from that specific match.
 * Returns [] when there are no early resignations for this match.
 */
export function getModalPlayersForMatch(index, matchUrl) {
    const entries = index?.byMatchUrl?.[matchUrl]
    if (!entries?.length) return []

    // Group by username, deduplicating by game_api within each player
    const byUsername = {}
    entries.forEach(entry => {
        const u = entry.username
        if (!byUsername[u]) byUsername[u] = { username: u, games: [] }
        const alreadyAdded = byUsername[u].games.some(g => g.game_api === entry.game_api)
        if (!alreadyAdded) {
            byUsername[u].games.push({
                game_api: entry.game_api,
                board_api: entry.board_api,
                moves_ply: entry.moves_ply,
            })
        }
    })

    const result = Object.values(byUsername).map(({ username, games }) => ({
        username,
        matchEarlyResignations: games.length,
        games,
    }))
    result.sort((a, b) => b.matchEarlyResignations - a.matchEarlyResignations)
    return result
}
