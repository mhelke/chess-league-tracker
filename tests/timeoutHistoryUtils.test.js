import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTimeoutHistory, getRecentDetectedTimeoutPlayers } from '../src/utils/timeoutHistoryUtils.js'

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
