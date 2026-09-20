import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { collectActionItems } from '../utils/actionItemUtils'

const DashboardDataContext = createContext(null)

export function DashboardDataProvider({ children }) {
    const loadPromiseRef = useRef(null)
    const [state, setState] = useState({
        leagueData: null,
        timeoutData: null,
        loading: true,
        error: null,
    })

    useEffect(() => {
        let active = true

        if (!loadPromiseRef.current) {
            loadPromiseRef.current = Promise.all([
                fetch('/data/leagueData.json').then(response => {
                    if (!response.ok) throw new Error('Failed to load league data')
                    return response.json()
                }),
                fetch('/data/timeoutData.json').then(response => response.json()).catch(() => null),
            ])
        }

        loadPromiseRef.current
            .then(([leagueData, timeoutData]) => {
                if (!active) return
                setState({ leagueData, timeoutData, loading: false, error: null })
            })
            .catch(error => {
                if (!active) return
                setState({
                    leagueData: null,
                    timeoutData: null,
                    loading: false,
                    error: error.message || 'Failed to load league data',
                })
            })

        return () => {
            active = false
        }
    }, [])

    const actionItems = useMemo(
        () => collectActionItems(state.leagueData, state.timeoutData),
        [state.leagueData, state.timeoutData]
    )

    const value = useMemo(
        () => ({ ...state, actionItems }),
        [state, actionItems]
    )

    return (
        <DashboardDataContext.Provider value={value}>
            {children}
        </DashboardDataContext.Provider>
    )
}

export function useDashboardData() {
    const context = useContext(DashboardDataContext)
    if (!context) throw new Error('useDashboardData must be used within DashboardDataProvider')
    return context
}
