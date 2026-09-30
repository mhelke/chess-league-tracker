import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTimeoutHistory, filterTimeoutHistory, getRecentDetectedTimeoutPlayers } from '../src/utils/timeoutHistoryUtils.js'

const NOW = 2_000_000
const DAY = 24 * 60 * 60

function leagueData() {
    return {
        globalLeaderboard: [{ username: 'Alice' }, { username: 'Bob' }],
        leagues: {
            League: {
                subLeagues: {
                    Division: {
                        rounds: [
                            {
                                status: 'in_progress',
                                matchUrl: 'https://api.chess.com/pub/match/one',
                                name: 'Match One',
                                startTime: 1,
                                playerStats: { Alice: { timeouts: 2 } },
                            },
                            {
                                status: 'finished',
                                matchUrl: 'https://api.chess.com/pub/match/two',
                                name: 'Match Two',
                                endTime: 2,
                                playerStats: { Alice: { timeouts: 1 } },
                            },
                            {
                                status: 'finished',
                                matchUrl: 'https://api.chess.com/pub/match/legacy',
                                name: 'Legacy Match',
                                endTime: NOW,
                                playerStats: { Bob: { timeouts: 2 } },
                            },
                        ],
                    },
                },
            },
        },
    }
}

test('recent timeout players use only resolved ledger events inside the detection window', () => {
    const history = buildTimeoutHistory(leagueData())
    const ledger = {
        events: [
            { matchUrl: 'https://api.chess.com/pub/match/one', username: 'alice', detectedAt: NOW - DAY },
            { matchUrl: 'https://api.chess.com/pub/match/two', username: 'alice', detectedAt: NOW - (2 * DAY) },
            { matchUrl: 'https://api.chess.com/pub/match/one', username: 'alice', detectedAt: NOW - (8 * DAY) },
            { matchUrl: 'https://api.chess.com/pub/match/missing', username: 'alice', detectedAt: NOW - DAY },
        ],
    }

    const recent = getRecentDetectedTimeoutPlayers(history, ledger, 7, NOW)

    assert.equal(recent.length, 1)
    assert.equal(recent[0].username, 'Alice')
    assert.equal(recent[0].totalTimeouts, 2)
    assert.equal(recent[0].matches.length, 2)
    assert.deepEqual(recent[0].matches.map(match => match.name), ['Match One', 'Match Two'])
    assert.equal(recent.some(player => player.username === 'Bob'), false)
})

test('aggregate history without a ledger never creates a recent timeout result', () => {
    const history = buildTimeoutHistory(leagueData())
    assert.deepEqual(getRecentDetectedTimeoutPlayers(history, null, 7, NOW), [])
})

test('timeout history filters matches and player totals by rolling date range', () => {
    const history = buildTimeoutHistory(leagueData())
    const timeoutHistory = {
        events: [
            { matchUrl: 'https://api.chess.com/pub/match/one', username: 'alice', ordinal: 1, detectedAt: new Date((NOW - DAY) * 1000).toISOString() },
            { matchUrl: 'https://api.chess.com/pub/match/two', username: 'alice', ordinal: 1, detectedAt: new Date((NOW - (30 * DAY)) * 1000).toISOString() },
        ],
    }
    const filtered = filterTimeoutHistory(history, timeoutHistory, 7, NOW)

    assert.deepEqual(filtered.matches.map(match => match.name), ['Match One'])
    assert.deepEqual(filtered.players.map(player => player.username), ['Alice'])
    assert.equal(filtered.totalTimeouts, 1)
    assert.equal(filtered.players[0].totalTimeouts, 1)
    assert.equal(filtered.players[0].matches[0].detectedAt, NOW - DAY)
})
