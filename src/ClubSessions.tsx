import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { ClubSession } from './SessionCard'

function newestFirst(sessions: readonly ClubSession[]) {
  return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
}

function SessionDate({ session }: { session: ClubSession }) {
  return <time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleString()}</time>
}

export function ClubSessionsMenu({
  sessions, loaded, error, creating, onCreate, onSelect, onFindPast,
}: {
  sessions: readonly ClubSession[]
  loaded: boolean
  error: string
  creating: boolean
  onCreate: () => void
  onSelect: (id: number) => void
  onFindPast: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const activeSession = sessions.find((session) => session.active)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const choose = (action: () => void) => {
    setOpen(false)
    triggerRef.current?.focus()
    action()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const current = items.findIndex((item) => item === document.activeElement)
    let next: number
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <div className="club-sessions-root" ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}>
      <button type="button" className="club-sessions-trigger secondary"
        ref={triggerRef} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}>
        Club Sessions
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div id={menuId} role="menu" aria-label="Club Sessions"
        className="club-sessions-menu" ref={menuRef} onKeyDown={onKeyDown}>
        <button type="button" role="menuitem" className="session-menu-action"
          disabled={!loaded || Boolean(error) || creating || Boolean(activeSession)}
          onClick={() => choose(onCreate)}>
          <span aria-hidden="true">+</span>
          {creating ? 'Creating Session...' : 'Create New Session'}
        </button>
        {activeSession && <p className="session-menu-hint">Close the active session before creating another.</p>}
        <div role="separator" className="session-menu-divider" />
        <p className="session-menu-label">Recent sessions</p>
        {!loaded && !error && <p className="session-menu-hint">Loading club sessions...</p>}
        {error && <p className="session-menu-hint">Sessions unavailable. Use Retry club sessions below.</p>}
        {loaded && !error && sessions.length === 0 && <p className="session-menu-hint">No club sessions yet.</p>}
        {newestFirst(sessions).slice(0, 5).map((session) => (
          <button type="button" role="menuitem" className="session-menu-item"
            key={session.id} onClick={() => choose(() => onSelect(session.id))}>
            <span className="session-menu-title">
              <strong>{session.name}</strong>
              {session.active && <span className="session-status active">Active</span>}
            </span>
            <small>#{session.id} · <SessionDate session={session} /></small>
          </button>
        ))}
        <div role="separator" className="session-menu-divider" />
        <button type="button" role="menuitem" className="session-menu-action"
          onClick={() => choose(onFindPast)}>
          Find Past Sessions
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>}
    </div>
  )
}

export function ClubSessionsView({
  sessions, loaded, error, onSelect,
}: {
  sessions: readonly ClubSession[]
  loaded: boolean
  error: string
  onSelect: (id: number) => void
}) {
  return (
    <section className="club-sessions-view" aria-labelledby="club-sessions-heading" aria-busy={!loaded && !error}>
      <header className="section-heading">
        <div>
          <p className="eyebrow">Session archive</p>
          <h2 id="club-sessions-heading">All Club Sessions</h2>
          <p className="club-sessions-intro">Select a session to open its standings, details, and results.</p>
        </div>
        {loaded && <span className="session-list-count">{sessions.length} sessions</span>}
      </header>
      {!loaded && !error && <p role="status">Loading club sessions...</p>}
      {error && <p>Sessions could not be loaded. Use Retry club sessions below.</p>}
      {loaded && !error && !sessions.some((session) => !session.active) && <p>No past club sessions yet.</p>}
      {sessions.length > 0 && <ul className="club-sessions-list">
        {newestFirst(sessions).map((session) => (
          <li key={session.id}>
            <button type="button" className="session-list-item" onClick={() => onSelect(session.id)}>
              <span className="session-list-identity">
                <strong>{session.name}</strong>
                <span>#{session.id} · <SessionDate session={session} /></span>
              </span>
              <span className="session-list-details">
                <span className={`session-status${session.active ? ' active' : ''}`}>
                  {session.active ? 'Active' : 'Closed'}
                </span>
                <small>{session.playerCount} players · {session.gameCount} games</small>
              </span>
              <span aria-hidden="true" className="session-list-arrow">&rarr;</span>
            </button>
          </li>
        ))}
      </ul>}
    </section>
  )
}
