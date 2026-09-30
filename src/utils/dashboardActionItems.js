export const DASHBOARD_ACTION_ITEM_FILTERS = {
    ALL: 'all',
    URGENT: 'urgent',
}

export function filterDashboardActionItems(matches = [], filter = DASHBOARD_ACTION_ITEM_FILTERS.ALL) {
    if (filter !== DASHBOARD_ACTION_ITEM_FILTERS.URGENT) return matches

    return matches.filter(match => match?.warnings?.status?.level === DASHBOARD_ACTION_ITEM_FILTERS.URGENT)
}
