import { useCallback, useEffect, useState } from 'react'
import type { DashboardTab } from './uiPreferences'

interface DashboardLocation {
  view: string
  error: string
}

function readDashboardLocation(fallback: DashboardTab): DashboardLocation {
  const view = new URL(window.location.href).searchParams.get('view') ?? fallback
  if (view === 'leaderboard' || view === 'recent-games' || view === 'club-sessions'
    || (/^session-[1-9]\d*$/.test(view) && Number.isSafeInteger(Number(view.slice(8))))) {
    return { view, error: '' }
  }
  return { view: 'leaderboard', error: 'The requested dashboard view is unavailable. Showing Leaderboard.' }
}

export function useDashboardNavigation(fallback: DashboardTab, sessionIds: readonly number[] | undefined) {
  const [location, setLocation] = useState(() => readDashboardLocation(fallback))

  const navigate = useCallback((view: string, mode: 'push' | 'replace' = 'push', error?: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('view', view)
    try {
      if (url.href !== window.location.href) {
        if (mode === 'push') window.history.pushState(window.history.state, '', url)
        else window.history.replaceState(window.history.state, '', url)
      }
    } catch (reason) {
      setLocation((current) => ({
        ...current,
        error: `The dashboard URL could not be updated: ${reason instanceof Error ? reason.message : String(reason)}`,
      }))
      return
    }
    setLocation((current) => {
      const nextError = error ?? (mode === 'replace' && current.view === view ? current.error : '')
      return current.view === view && current.error === nextError ? current : { view, error: nextError }
    })
  }, [])

  useEffect(() => {
    let mounted = true
    const synchronize = () => {
      const requested = readDashboardLocation(fallback)
      if (requested.view.startsWith('session-') && sessionIds !== undefined
        && !sessionIds.includes(Number(requested.view.slice(8)))) {
        navigate('leaderboard', 'replace', 'That Club Session is no longer available. Showing Leaderboard.')
      } else {
        navigate(requested.view, 'replace', requested.error || undefined)
      }
    }
    window.addEventListener('popstate', synchronize)
    void Promise.resolve().then(() => {
      if (mounted) synchronize()
    })
    return () => {
      mounted = false
      window.removeEventListener('popstate', synchronize)
    }
  }, [sessionIds, fallback, navigate])

  return { selectedView: location.view, navigationError: location.error, navigate }
}
