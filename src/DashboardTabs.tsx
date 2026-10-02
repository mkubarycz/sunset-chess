import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

interface DashboardTab {
  id: string
  label: string
  action?: {
    label: string
    onClick: () => void
    buttonRef?: RefObject<HTMLButtonElement | null>
  }
}

export function DashboardTabs({
  selected,
  onSelect,
  tabs,
  createLabel,
  onCreate,
  children,
}: {
  selected: string
  onSelect: (tab: string) => void
  tabs: DashboardTab[]
  createLabel?: string
  onCreate?: () => void
  children: Record<string, ReactNode>
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
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
        {tabs.map(({ id, label, action }) => (
          <div className={`dashboard-tab-item${action ? ' has-action' : ''}`}
            data-selected={selected === id} key={id}>
            <button
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={selected === id}
              aria-controls={`panel-${id}`}
              tabIndex={selected === id ? 0 : -1}
              ref={(node) => { if (node) refs.current.set(id, node); else refs.current.delete(id) }}
              onClick={() => onSelect(id)}
              onKeyDown={onKeyDown}
            >
              {label}
            </button>
            {action && (
              <button type="button" className="dashboard-tab-config"
                ref={action.buttonRef}
                aria-label={action.label}
                onClick={action.onClick}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3.25" />
                  <path d="M12 2.75v3M12 18.25v3M2.75 12h3M18.25 12h3M5.46 5.46l2.12 2.12M16.42 16.42l2.12 2.12M18.54 5.46l-2.12 2.12M7.58 16.42l-2.12 2.12" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {createLabel && onCreate && (
          <button type="button" className="create-session-tab" onClick={onCreate}>
            {createLabel}
          </button>
        )}
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
