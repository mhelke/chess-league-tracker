import assert from 'node:assert/strict'
import test from 'node:test'

import { buildActionItemsFeed } from '../scripts/generate_action_items.mjs'
import { collectActionItems } from '../src/utils/actionItemUtils.js'

const NOW_SECONDS = 2_000_000

function warningFixture() {
    return {
        leagues: {
            League: {
                subLeagues: {
                    Division: {
                        rounds: [{
                            round: 'R1',
                            status: 'open',
                            matchId: 'https://api.chess.com/pub/match/12345',
                            matchWebUrl: 'https://www.chess.com/club/matches/12345',
                            name: 'League Division R1',
                            startTime: NOW_SECONDS + 60,
                            endTime: NOW_SECONDS + 86400,
                            minTeamPlayers: 5,
                            maxTeamPlayers: 5,
                            registeredPlayers: { our: 3, opponent: 6 },
                            playerDeficitThreshold: 3,
                            opponentHistory: [{
                                ts: NOW_SECONDS - 60,
                                opponent: { added: ['One', 'Two', 'Three', 'Four'] },
                            }],
                            registrationData: {
                                type: 'roster',
                                ourRoster: [
                                    { username: 'Alice', rating: 1500 },
                                    { username: 'Bob', rating: 1400 },
                                    { username: 'Cara', rating: 1300 },
                                ],
                                oppRoster: [
                                    { username: 'Opponent1', rating: 1700 },
                                    { username: 'Opponent2', rating: 1600 },
                                    { username: 'Opponent3', rating: 1500 },
                                ],
                            },
                        }],
                    },
                },
            },
        },
    }
}

const timeoutData = {
    players: {
        alice: {
            riskFlag: true,
            riskLevel: 'HIGH',
            timeoutPercent: 75,
            totalLeagueTimeouts90Days: 3,
        },
    },
}

test('feed is an exact compact projection of the shared action-item evaluator', () => {
    const originalNow = Date.now
    Date.now = () => NOW_SECONDS * 1000
    try {
        const leagueData = warningFixture()
        const evaluated = collectActionItems(leagueData, timeoutData)
        const feed = buildActionItemsFeed({
            siteKey: 'teamusa',
            leagueData,
            timeoutData,
            generatedAt: '2026-09-21T02:00:00.000Z',
        })

        assert.equal(feed.schemaVersion, 1)
        assert.equal(feed.generatedAt, '2026-09-21T02:00:00.000Z')
        assert.equal(feed.actionItems.length, 1)
        assert.equal(feed.actionItems[0].id, 'teamusa:12345')
        assert.equal(feed.actionItems[0].matchName, evaluated[0].name)
        assert.equal(feed.actionItems[0].startTime, evaluated[0].startTime)
        assert.equal(feed.actionItems[0].actionItemUrl, 'https://teamusa.chessteamdata.com/action-items?matchId=12345')
        assert.equal('severity' in feed.actionItems[0], false)
        const {
            highRiskTimeoutPlayers,
            recentOpponentAdditions,
            statusLevel,
            statusReasons,
            status,
            ...expectedWarnings
        } = evaluated[0].warnings
        expectedWarnings.status = {
            level: status.level,
            label: status.label,
            reasons: status.reasons,
        }
        assert.deepEqual(feed.actionItems[0].warnings, expectedWarnings)
        assert.equal('highRiskTimeoutPlayers' in feed.actionItems[0].warnings, false)
        assert.equal('recentOpponentAdditions' in feed.actionItems[0].warnings, false)
        assert.equal('statusLevel' in feed.actionItems[0].warnings, false)
        assert.equal('statusReasons' in feed.actionItems[0].warnings, false)
        assert.deepEqual(feed.actionItems[0].warnings.status, {
            level: evaluated[0].warnings.status.level,
            label: evaluated[0].warnings.status.label,
            reasons: evaluated[0].warnings.status.reasons,
        })
        assert.equal(feed.actionItems[0].warnings.mismatchedBoardCount, 3)
        assert.equal(feed.actionItems[0].warnings.playersWithHighTimeout, 1)
        assert.equal(feed.actionItems[0].warnings.surgeRecruitment, true)
    } finally {
        Date.now = originalNow
    }
})

test('feed contains no records when the shared evaluator finds no action items', () => {
    const leagueData = warningFixture()
    const round = leagueData.leagues.League.subLeagues.Division.rounds[0]
    round.registeredPlayers = { our: 5, opponent: 5 }
    round.registrationData.ourRoster = round.registrationData.oppRoster.map(player => ({
        username: `Our${player.username}`,
        rating: player.rating,
    }))
    round.opponentHistory = []

    const feed = buildActionItemsFeed({
        siteKey: 'mn',
        leagueData,
        timeoutData: { players: {} },
        generatedAt: '2026-09-21T02:00:00.000Z',
    })

    assert.deepEqual(feed.actionItems, [])
})
