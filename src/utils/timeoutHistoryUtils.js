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
                    matchUrl: round.matchUrl || round.matchId,
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
                        matchUrl: match.matchUrl,
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

function detectedTime(event) {
    const value = event?.detectedAt
    const numericValue = Number(value)
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue > 100000000000 ? numericValue / 1000 : numericValue
    }

    const parsedValue = Date.parse(value)
    return Number.isFinite(parsedValue) ? parsedValue / 1000 : 0
}

/**
 * Return timeout events detected by tracker fetches within the requested window.
 * Historical aggregate counts intentionally do not participate because they
 * predate the ledger and have no trustworthy detection timestamp.
 */
export function getRecentDetectedTimeoutPlayers(history, timeoutHistory, days = 30, now = Date.now() / 1000) {
    const cutoff = now - (days * 24 * 60 * 60)
    const matchesByPlayer = new Map()

    history.players.forEach(player => {
        player.matches.forEach(match => {
            const matchUrl = String(match.matchUrl || match.matchId || '').trim()
            if (matchUrl) matchesByPlayer.set(`${matchUrl}|${player.username.toLowerCase()}`, { player, match })
        })
    })

    const playersByUsername = new Map()
    ; (timeoutHistory?.events || []).forEach(event => {
        const occurredAt = detectedTime(event)
        if (occurredAt < cutoff || occurredAt > now) return

        const matchUrl = String(event?.matchUrl || '').trim()
        const username = String(event?.username || '').trim().toLowerCase()
        const source = matchesByPlayer.get(`${matchUrl}|${username}`)
        if (!source) return

        let player = playersByUsername.get(username)
        if (!player) {
            player = {
                username: source.player.username,
                totalTimeouts: 0,
                latestDetectedAt: 0,
                matchesByUrl: new Map(),
            }
            playersByUsername.set(username, player)
        }

        let match = player.matchesByUrl.get(matchUrl)
        if (!match) {
            match = { ...source.match, timeouts: 0, detectedAt: occurredAt }
            player.matchesByUrl.set(matchUrl, match)
        }
        match.timeouts += 1
        match.detectedAt = Math.max(match.detectedAt, occurredAt)
        player.totalTimeouts += 1
        player.latestDetectedAt = Math.max(player.latestDetectedAt, occurredAt)
    })

    return [...playersByUsername.values()]
        .map(player => ({
            username: player.username,
            totalTimeouts: player.totalTimeouts,
            latestDetectedAt: player.latestDetectedAt,
            matches: [...player.matchesByUrl.values()].sort((left, right) => right.detectedAt - left.detectedAt
                || left.name.localeCompare(right.name)),
        }))
        .sort((left, right) => right.totalTimeouts - left.totalTimeouts
            || right.latestDetectedAt - left.latestDetectedAt
            || left.username.localeCompare(right.username))
}
