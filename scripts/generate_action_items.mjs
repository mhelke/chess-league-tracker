#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectActionItems, normalizeMatchId } from '../src/utils/actionItemUtils.js'

export const ACTION_ITEMS_SCHEMA_VERSION = 1

const SITE_ORIGINS = Object.freeze({
    '1dpmc': 'https://1dpmc.chessteamdata.com',
    teamusa: 'https://teamusa.chessteamdata.com',
    mn: 'https://mn.chessteamdata.com',
})

function projectWarningsForFeed(warnings = {}) {
    // The dashboard keeps the complete evaluator output in memory. The public
    // feed needs only the aggregate timeout signal, already supplied by
    // playersWithHighTimeout, rather than a roster-level player list.
    const {
        highRiskTimeoutPlayers,
        recentOpponentAdditions,
        statusLevel,
        statusReasons,
        status,
        ...feedWarnings
    } = warnings
    return {
        ...feedWarnings,
        status: status
            ? {
                level: status.level,
                label: status.label,
                reasons: status.reasons,
            }
            : null,
    }
}

function stableItemId(siteKey, match) {
    const matchId = normalizeMatchId(match.matchId || match.matchUrl)
    if (matchId) return `${siteKey}:${matchId}`

    // Match IDs are expected for live Chess.com rounds. This deterministic
    // fallback keeps a malformed historical row from colliding with another
    // feed item while leaving evaluation rules untouched.
    return `${siteKey}:round:${match.leagueName}:${match.subLeagueName}:${match.round || match.name || 'unknown'}`
}

export function projectActionItem(siteKey, match) {
    const matchId = normalizeMatchId(match.matchId || match.matchUrl) || null
    const siteOrigin = SITE_ORIGINS[siteKey]
    return {
        id: stableItemId(siteKey, match),
        siteKey,
        matchId,
        matchName: match.name || null,
        leagueName: match.leagueName,
        subLeagueName: match.subLeagueName,
        startTime: match.startTime ?? null,
        endTime: match.endTime ?? null,
        matchWebUrl: match.matchWebUrl || null,
        actionItemUrl: matchId && siteOrigin
            ? `${siteOrigin}/action-items?matchId=${encodeURIComponent(matchId)}`
            : null,
        warnings: projectWarningsForFeed(match.warnings),
    }
}

export function buildActionItemsFeed({ siteKey, leagueData, timeoutData, generatedAt = new Date().toISOString() }) {
    // This is deliberately the same evaluator used by the React dashboard.
    // The feed projects its result but never reimplements its classification.
    const actionItems = collectActionItems(leagueData, timeoutData)
        .map(match => projectActionItem(siteKey, match))

    return {
        schemaVersion: ACTION_ITEMS_SCHEMA_VERSION,
        siteKey,
        generatedAt,
        actionItems,
    }
}

export async function generateActionItemsFile({ siteKey, dataDirectory = 'public/data' }) {
    const siteDirectory = path.join(dataDirectory, siteKey)
    const [leagueContents, timeoutContents] = await Promise.all([
        readFile(path.join(siteDirectory, 'leagueData.json'), 'utf8'),
        readFile(path.join(siteDirectory, 'timeoutData.json'), 'utf8'),
    ])
    const feed = buildActionItemsFeed({
        siteKey,
        leagueData: JSON.parse(leagueContents),
        timeoutData: JSON.parse(timeoutContents),
    })
    const outputPath = path.join(siteDirectory, 'actionItems.json')
    const temporaryPath = `${outputPath}.${process.pid}.tmp`

    await writeFile(temporaryPath, `${JSON.stringify(feed, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, outputPath)
    return feed
}

function parseArguments(args) {
    const siteKeyIndex = args.indexOf('--site-key')
    const siteKey = siteKeyIndex >= 0 ? args[siteKeyIndex + 1] : null
    if (!siteKey || !/^[a-z0-9][a-z0-9_-]*$/i.test(siteKey)) {
        throw new Error('Usage: node scripts/generate_action_items.mjs --site-key <siteKey>')
    }
    return { siteKey }
}

const isMainModule = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
    try {
        const { siteKey } = parseArguments(process.argv.slice(2))
        const feed = await generateActionItemsFile({ siteKey })
        console.log(`Generated ${feed.actionItems.length} action item(s) for ${siteKey}`)
    } catch (error) {
        console.error(`Unable to generate action-item feed: ${error.message}`)
        process.exitCode = 1
    }
}
