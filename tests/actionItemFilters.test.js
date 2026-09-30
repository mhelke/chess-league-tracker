import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_ACTION_ITEM_FILTERS,
    filterActionItems,
    hasActionItemFilterParams,
    parseActionItemFilters,
    serializeActionItemFilters,
} from '../src/utils/actionItemUtils.js'

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime() / 1000

function localDate(date, hour = 12) {
    return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime() / 1000
}

function item(id, overrides = {}) {
    return {
        matchId: id,
        leagueName: 'League A',
        startTime: localDate('2026-01-15'),
        registeredPlayers: { our: 5, opponent: 5 },
        warnings: {
            minNotMet: false,
            mismatchedBoardCount: 0,
            hasTimeoutWarning: false,
            surgeRecruitment: false,
            status: { level: 'advisory' },
        },
        ...overrides,
    }
}

const matches = [
    item('minimum', { warnings: { minNotMet: true, mismatchedBoardCount: 0, hasTimeoutWarning: false, surgeRecruitment: false, status: { level: 'urgent' } } }),
    item('needs-players', { registeredPlayers: { our: 4, opponent: 5 } }),
    item('board-gap', { warnings: { minNotMet: false, mismatchedBoardCount: 1, hasTimeoutWarning: false, surgeRecruitment: false, status: { level: 'advisory' } } }),
    item('timeout', { warnings: { minNotMet: false, mismatchedBoardCount: 0, hasTimeoutWarning: true, surgeRecruitment: false, status: { level: 'urgent' } } }),
    item('surge', { warnings: { minNotMet: false, mismatchedBoardCount: 0, hasTimeoutWarning: false, surgeRecruitment: true, status: { level: 'advisory' } } }),
    item('league-b', { leagueName: 'League B', startTime: localDate('2026-01-20'), warnings: { minNotMet: false, mismatchedBoardCount: 0, hasTimeoutWarning: false, surgeRecruitment: false, status: { level: 'advisory' } } }),
]

test('league filtering limits matches to the selected league', () => {
    assert.deepEqual(filterActionItems(matches, { league: 'League B' }, NOW).map(match => match.matchId), ['league-b'])
})

test('date windows use local calendar boundaries', () => {
    const dateMatches = [
        item('past', { startTime: localDate('2026-01-14') }),
        item('today', { startTime: localDate('2026-01-15', 1) }),
        item('day-seven', { startTime: localDate('2026-01-21') }),
        item('day-eight', { startTime: localDate('2026-01-22') }),
        item('no-date', { startTime: null }),
    ]

    assert.deepEqual(filterActionItems(dateMatches, { date: 'next-7' }, NOW).map(match => match.matchId), ['today', 'day-seven'])
    assert.deepEqual(filterActionItems(dateMatches, { date: 'next-14' }, NOW).map(match => match.matchId), ['today', 'day-seven', 'day-eight'])
    assert.deepEqual(filterActionItems(dateMatches, DEFAULT_ACTION_ITEM_FILTERS, NOW).map(match => match.matchId), ['past', 'today', 'day-seven', 'day-eight', 'no-date'])
})

test('issue filters distinguish minimum roster from needs players', () => {
    assert.deepEqual(filterActionItems(matches, { issues: ['minimum-roster'] }, NOW).map(match => match.matchId), ['minimum'])
    assert.deepEqual(filterActionItems(matches, { issues: ['needs-players'] }, NOW).map(match => match.matchId), ['needs-players'])
})

test('all issue types are explicit by default and an empty selection matches nothing', () => {
    assert.deepEqual(filterActionItems(matches, { issues: [] }, NOW), [])
    const params = serializeActionItemFilters({ ...DEFAULT_ACTION_ITEM_FILTERS, issues: [] }, '', { includeDefaults: true })
    assert.equal(params.get('issue'), 'none')
    assert.deepEqual(parseActionItemFilters(params).issues, [])
})

test('board gap, timeout, and opponent surge filters use their warning signals', () => {
    assert.deepEqual(filterActionItems(matches, { issues: ['board-gap'] }, NOW).map(match => match.matchId), ['board-gap'])
    assert.deepEqual(filterActionItems(matches, { issues: ['timeout'] }, NOW).map(match => match.matchId), ['timeout'])
    assert.deepEqual(filterActionItems(matches, { issues: ['opponent-surge'] }, NOW).map(match => match.matchId), ['surge'])
})

test('multiple issue filters use OR behavior', () => {
    assert.deepEqual(
        filterActionItems(matches, { issues: ['timeout', 'opponent-surge'] }, NOW).map(match => match.matchId),
        ['timeout', 'surge']
    )
})

test('urgency filtering selects urgent or advisory action items', () => {
    assert.deepEqual(
        filterActionItems(matches, { urgency: 'urgent' }, NOW).map(match => match.matchId),
        ['minimum', 'timeout']
    )
    assert.equal(filterActionItems(matches, { urgency: 'advisory' }, NOW).length, 4)
})

test('no filters return every match, including matches without a date', () => {
    assert.deepEqual(filterActionItems(matches, {}, NOW), matches)
})

test('invalid filter values fail safely without throwing', () => {
    const parsed = parseActionItemFilters('date=past-due&from=2026-01-15&to=2026-01-21&issue=unknown&urgency=critical')
    assert.deepEqual(parsed, DEFAULT_ACTION_ITEM_FILTERS)
    assert.deepEqual(filterActionItems(matches, { date: 'past-due' }, NOW), matches)
})

test('filter query parameters round-trip and preserve unrelated parameters', () => {
    const filters = {
        league: 'League A',
        date: 'next-14',
        issues: ['timeout', 'board-gap'],
        urgency: 'urgent',
    }
    const params = serializeActionItemFilters(filters, 'matchId=minimum&view=shared')
    assert.equal(params.get('matchId'), 'minimum')
    assert.equal(params.get('view'), 'shared')
    assert.deepEqual(parseActionItemFilters(params), filters)
})

test('explicit default filters remain distinguishable from an absent filter query', () => {
    const params = serializeActionItemFilters(DEFAULT_ACTION_ITEM_FILTERS, 'matchId=minimum', { includeDefaults: true })
    assert.equal(params.get('date'), 'all')
    assert.equal(hasActionItemFilterParams(params), true)
    assert.equal(hasActionItemFilterParams('matchId=minimum'), false)
    assert.deepEqual(parseActionItemFilters(params), DEFAULT_ACTION_ITEM_FILTERS)
})
