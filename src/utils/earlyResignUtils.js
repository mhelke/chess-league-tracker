/**
 * Build lookup index from raw earlyResignations.json data.
 *
 * Returns:
 *   byMatchUrl: { matchUrl -> [{username, color, moves_ply, game_api, board_api, matchWebUrl, subLeagueName}] }
 */
export function buildEarlyResignIndex(rawData, leagueData) {
    const byMatchUrl = {}
    const clubPlayerNames = getClubPlayerNames(leagueData)

    if (!rawData?.leagues) return { byMatchUrl }

    Object.entries(rawData.leagues).forEach(([, leagueVal]) => {
        Object.entries(leagueVal.subLeagues || {}).forEach(([subLeagueName, subVal]) => {
            ; (subVal.matches || []).forEach(match => {
                const matchUrl = match.matchUrl
                const matchWebUrl = match.matchWebUrl
                    ; (match.players || []).forEach(player => {
                        const uname = (player.username || '').toLowerCase()
                        if (!uname) return
                        if (!isClubPlayer(uname, clubPlayerNames)) return
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

function timestamp(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

import { getClubPlayerNames, isClubPlayer } from './clubPlayerUtils.js'

/**
 * Build match-level early resignation history with the league data needed for
 * dates, match names, and links back to the relevant match.
 */
export function buildEarlyResignationHistory(rawData, leagueData) {
    const matchDetails = {}
    const clubPlayerNames = getClubPlayerNames(leagueData)

    Object.entries(leagueData?.leagues || {}).forEach(([leagueName, leagueValue]) => {
        Object.entries(leagueValue.subLeagues || {}).forEach(([subLeagueName, subLeagueValue]) => {
            ; (subLeagueValue.rounds || []).forEach(round => {
                const matchUrl = round.matchUrl || round.matchId
                if (!matchUrl) return
                matchDetails[matchUrl] = {
                    leagueName,
                    subLeagueName,
                    name: round.name || round.round || matchUrl,
                    round: round.round,
                    status: round.status,
                    startTime: timestamp(round.startTime),
                    endTime: timestamp(round.endTime),
                    matchWebUrl: round.matchWebUrl,
                }
            })
        })
    })

    const history = []
    Object.entries(rawData?.leagues || {}).forEach(([fallbackLeagueName, leagueValue]) => {
        Object.entries(leagueValue.subLeagues || {}).forEach(([fallbackSubLeagueName, subLeagueValue]) => {
            ; (subLeagueValue.matches || []).forEach(match => {
                const matchUrl = match.matchUrl
                if (!matchUrl) return

                const details = matchDetails[matchUrl] || {}
                const playersByUsername = {}
                ; (match.players || []).forEach((player, index) => {
                    const username = (player.username || '').toLowerCase()
                    if (!username) return
                    if (!isClubPlayer(username, clubPlayerNames)) return
                    if (!playersByUsername[username]) {
                        playersByUsername[username] = { username, games: [] }
                    }

                    const gameKey = player.game_api || `${player.board_api || 'game'}-${index}`
                    if (!playersByUsername[username].games.some(game => game.game_api === gameKey)) {
                        playersByUsername[username].games.push({
                            game_api: player.game_api,
                            board_api: player.board_api,
                            moves_ply: player.moves_ply,
                        })
                    }
                })

                const players = Object.values(playersByUsername)
                    .map(player => ({
                        ...player,
                        matchEarlyResignations: player.games.length,
                    }))
                    .sort((left, right) => right.matchEarlyResignations - left.matchEarlyResignations
                        || left.username.localeCompare(right.username))

                if (players.length === 0) return

                const activityTime = details.endTime || details.startTime || null

                history.push({
                    matchUrl,
                    matchWebUrl: match.matchWebUrl || details.matchWebUrl,
                    leagueName: details.leagueName || fallbackLeagueName,
                    subLeagueName: details.subLeagueName || fallbackSubLeagueName,
                    name: details.name || matchUrl,
                    round: details.round,
                    status: details.status,
                    startTime: details.startTime,
                    endTime: details.endTime,
                    activityTime,
                    players,
                    totalGames: players.reduce((sum, player) => sum + player.games.length, 0),
                })
            })
        })
    })

    return history.sort((left, right) => (right.activityTime || 0) - (left.activityTime || 0)
        || left.leagueName.localeCompare(right.leagueName)
        || left.subLeagueName.localeCompare(right.subLeagueName)
        || left.name.localeCompare(right.name))
}

export function getRecentEarlyResignations(history, days = 7, now = Date.now() / 1000) {
    const cutoff = now - (days * 24 * 60 * 60)
    return history.filter(record => (
        Number.isFinite(record.activityTime)
        && record.activityTime >= cutoff
        && record.activityTime <= now
    ))
}
