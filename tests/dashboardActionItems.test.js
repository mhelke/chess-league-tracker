import assert from 'node:assert/strict'
import test from 'node:test'
import { filterDashboardActionItems } from '../src/utils/dashboardActionItems.js'

const matches = [
    { id: 'advisory-1', warnings: { status: { level: 'advisory' } } },
    { id: 'urgent-1', warnings: { status: { level: 'urgent' } } },
    { id: 'secure-1', warnings: { status: { level: 'secure' } } },
    { id: 'urgent-2', warnings: { status: { level: 'urgent' } } },
]

test('all mode preserves the existing action item order', () => {
    assert.deepEqual(
        filterDashboardActionItems(matches, 'all').map(match => match.id),
        ['advisory-1', 'urgent-1', 'secure-1', 'urgent-2']
    )
})

test('urgent-only mode removes other statuses without reordering urgent items', () => {
    assert.deepEqual(
        filterDashboardActionItems(matches, 'urgent').map(match => match.id),
        ['urgent-1', 'urgent-2']
    )
})

test('urgent-only mode returns an empty list when no urgent items exist', () => {
    assert.deepEqual(
        filterDashboardActionItems([
            { id: 'advisory-1', warnings: { status: { level: 'advisory' } } },
        ], 'urgent'),
        []
    )
})
