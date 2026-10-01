import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { DashboardTab } from './uiPreferences'

const tabs: Array<{ id: DashboardTab; label: string }> = [
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'recent-games', label: 'Recent Games' },
]

export function DashboardTabs({
  selected,
  onSelect,
  children,
}: {
  selected: DashboardTab
  onSelect: (tab: DashboardTab) => void
  children: Record<DashboardTab, ReactNode>
}) {
  const refs = useRef(new Map<DashboardTab, HTMLButtonElement>())
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex(({ id }) => id === selected)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onSelect(tabs[next].id)
    refs.current.get(tabs[next].id)?.focus()
  }
  return (
    <section className="tabbed-workspace">
      <div role="tablist" aria-label="Dashboard views" className="dashboard-tabs">
        {tabs.map(({ id, label }) => (
          <button
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={selected === id}
            aria-controls={`panel-${id}`}
            tabIndex={selected === id ? 0 : -1}
            key={id}
            ref={(node) => { if (node) refs.current.set(id, node); else refs.current.delete(id) }}
            onClick={() => onSelect(id)}
            onKeyDown={onKeyDown}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map(({ id }) => (
        <div
          role="tabpanel"
          id={`panel-${id}`}
          aria-labelledby={`tab-${id}`}
          hidden={selected !== id}
          tabIndex={0}
          className={`dashboard-tab-panel panel-${id}`}
          key={id}
        >
          {selected === id ? children[id] : null}
        </div>
      ))}
    </section>
  )
}
