export function getClubPlayerNames(data) {
    const names = new Set()
    const add = username => {
        const normalized = String(username || '').trim().toLowerCase()
        if (normalized) names.add(normalized)
    }

    ; (data?.globalLeaderboard || []).forEach(player => add(player?.username))

    Object.values(data?.leagues || {}).forEach(league => {
        Object.values(league.subLeagues || {}).forEach(subLeague => {
            ; (subLeague.leaderboard || []).forEach(player => add(player?.username))
            ; (subLeague.rounds || []).forEach(round => {
                ; (round.registrationData?.ourRoster || []).forEach(player => add(player?.username))
            })
        })
    })

    return names
}

export function isClubPlayer(username, clubPlayerNames) {
    return !clubPlayerNames?.size || clubPlayerNames.has(String(username || '').toLowerCase())
}
