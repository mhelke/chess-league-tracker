import assert from 'node:assert/strict'
import test from 'node:test'

import {
    buildEarlyResignationHistory,
    buildEarlyResignationPlayers,
    filterEarlyResignationHistory,
} from '../src/utils/earlyResignUtils.js'

const NOW = 10_000_000
const DAY = 24 * 60 * 60

function leagueData() {
    return {
        globalLeaderboard: [{ username: 'Alice' }, { username: 'Bob' }],
        leagues: {
            League: {
                subLeagues: {
                    Division: {
                        rounds: [{
                            status: 'finished',
                            matchUrl: 'https://api.chess.com/pub/match/old-match',
                            matchWebUrl: 'https://www.chess.com/club/matches/old-match',
                            name: 'Old Match',
                            startTime: NOW - (30 * DAY),
                            endTime: NOW - (29 * DAY),
                        }, {
                            status: 'finished',
                            matchUrl: 'https://api.chess.com/pub/match/end-only',
                            name: 'End Only Match',
                            endTime: NOW - DAY,
                        }],
                    },
                },
            },
        },
    }
}

function earlyResignData() {
    return {
        leagues: {
            League: {
                subLeagues: {
                    Division: {
                        matches: [{
                            matchUrl: 'https://api.chess.com/pub/match/old-match',
                            players: [{
                                username: 'Alice',
                                game_api: 'game-recent',
                                detectedAt: new Date((NOW - DAY) * 1000).toISOString(),
                            }, {
                                username: 'Alice',
                                game_api: 'game-old',
                                detectedAt: new Date((NOW - (30 * DAY)) * 1000).toISOString(),
                            }, {
                                username: 'Bob',
                                game_api: 'game-undated',
                            }],
                        }, {
                            matchUrl: 'https://api.chess.com/pub/match/end-only',
                            players: [{
                                username: 'Bob',
                                game_api: 'game-end-fallback',
                            }],
                        }],
                    },
                },
            },
        },
    }
}

test('early resignation filtering uses per-game detected dates and recalculates totals', () => {
    const history = buildEarlyResignationHistory(earlyResignData(), leagueData())
    const filtered = filterEarlyResignationHistory(history, 7, NOW)
    const players = buildEarlyResignationPlayers(filtered)

    assert.deepEqual(filtered.map(record => record.name), ['End Only Match', 'Old Match'])
    const filteredOldMatch = filtered.find(record => record.name === 'Old Match')
    assert.equal(filteredOldMatch.totalGames, 1)
    assert.equal(filteredOldMatch.players.length, 1)
    assert.equal(filteredOldMatch.players[0].username, 'alice')
    assert.equal(filteredOldMatch.players[0].games[0].game_api, 'game-recent')
    assert.deepEqual(players.players.map(player => player.username), ['alice', 'bob'])
    assert.equal(players.players[0].totalGames, 1)
})

test('legacy games backfill from match start, then end, and all keeps undated records', () => {
    const history = buildEarlyResignationHistory(earlyResignData(), leagueData())
    const oldMatch = history.find(record => record.name === 'Old Match')
    const endOnlyMatch = history.find(record => record.name === 'End Only Match')

    assert.equal(oldMatch.players.find(player => player.username === 'bob').games[0].detectedAt, NOW - (30 * DAY))
    assert.equal(endOnlyMatch.players[0].games[0].detectedAt, NOW - DAY)

    const allPlayers = buildEarlyResignationPlayers(history)
    assert.equal(allPlayers.totalGames, 4)
    assert.equal(filterEarlyResignationHistory(history, 7, NOW).length, 2)
})
