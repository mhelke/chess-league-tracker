import { getClubPlayerNames, isClubPlayer } from './clubPlayerUtils.js'

function activityTime(match) {
    const value = Number(match.endTime || match.startTime)
    return Number.isFinite(value) && value > 0 ? value : 0
}

function sortByRecent(left, right) {
    return activityTime(right) - activityTime(left)
        || left.leagueName.localeCompare(right.leagueName)
        || left.subLeagueName.localeCompare(right.subLeagueName)
        || left.name.localeCompare(right.name)
}

/**
 * Aggregate recorded timeout events from in-progress and finished matches.
 * The match data remains the source of truth; risk projections for open
 * matches are intentionally not included in this history.
 */
export function buildTimeoutHistory(data) {
    const matches = []
    const playersByUsername = {}
    const clubPlayerNames = getClubPlayerNames(data)

    Object.entries(data?.leagues || {}).forEach(([leagueName, leagueData]) => {
        Object.entries(leagueData.subLeagues || {}).forEach(([subLeagueName, subLeagueData]) => {
            ; (subLeagueData.rounds || []).forEach(round => {
                if (round.status !== 'in_progress' && round.status !== 'finished') return

                const timeoutPlayers = Object.entries(round.playerStats || {})
                    .map(([username, stats]) => ({ username, count: Number(stats?.timeouts) || 0 }))
                    .filter(player => isClubPlayer(player.username, clubPlayerNames))
                    .filter(player => player.count > 0)
                const totalTimeouts = timeoutPlayers.reduce((sum, player) => sum + player.count, 0)
                if (totalTimeouts === 0) return

                const match = {
                    matchId: round.matchId || round.matchUrl,
                    matchWebUrl: round.matchWebUrl,
                    leagueName,
                    subLeagueName,
                    name: round.name || round.round || round.matchId || round.matchUrl || 'Match',
                    status: round.status,
                    startTime: round.startTime,
                    endTime: round.endTime,
                    totalTimeouts,
                    timeoutPlayers,
                }
                matches.push(match)

                timeoutPlayers.forEach(({ username, count }) => {
                    const key = username.toLowerCase()
                    if (!playersByUsername[key]) {
                        playersByUsername[key] = {
                            username,
                            totalTimeouts: 0,
                            latestActivityTime: 0,
                            matches: [],
                        }
                    }
                    const player = playersByUsername[key]
                    player.totalTimeouts += count
                    player.latestActivityTime = Math.max(player.latestActivityTime, activityTime(match))
                    player.matches.push({
                        matchId: match.matchId,
                        matchWebUrl: match.matchWebUrl,
                        leagueName,
                        subLeagueName,
                        name: match.name,
                        status: match.status,
                        startTime: match.startTime,
                        endTime: match.endTime,
                        timeouts: count,
                    })
                })
            })
        })
    })

    matches.sort(sortByRecent)
    const players = Object.values(playersByUsername)
        .map(player => ({
            ...player,
            matches: player.matches.sort(sortByRecent),
        }))
        .sort((left, right) => right.totalTimeouts - left.totalTimeouts
            || right.latestActivityTime - left.latestActivityTime
            || left.username.localeCompare(right.username))

    return {
        matches,
        players,
        totalTimeouts: matches.reduce((sum, match) => sum + match.totalTimeouts, 0),
    }
}

export function getRecentTimeoutPlayers(history, days = 30, now = Date.now() / 1000) {
    const cutoff = now - (days * 24 * 60 * 60)

    return history.players
        .map(player => {
            const recentMatches = player.matches.filter(match => {
                const time = activityTime(match)
                return time >= cutoff && time <= now
            })
            return {
                ...player,
                matches: recentMatches,
                totalTimeouts: recentMatches.reduce((sum, match) => sum + match.timeouts, 0),
            }
        })
        .filter(player => player.matches.length > 0)
        .sort((left, right) => right.totalTimeouts - left.totalTimeouts
            || right.latestActivityTime - left.latestActivityTime
            || left.username.localeCompare(right.username))
}
