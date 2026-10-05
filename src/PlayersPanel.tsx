import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { PlayerCardDialog, type LeaderboardEntry } from './PlayerCardDialog'

async function responseBody(response: Response) {
  return response.json() as Promise<{
    player?: unknown
    players?: LeaderboardEntry[]
    error?: string
  }>
}

export function PlayersPanel({
  refreshKey,
  onMutate,
  onScanCode,
}: {
  refreshKey: number
  onMutate: () => void
  onScanCode?: (player: LeaderboardEntry) => void
}) {
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  const [confirmDeleteInitially, setConfirmDeleteInitially] = useState(false)
  const [menuPlayer, setMenuPlayer] = useState<LeaderboardEntry | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const menuTriggerRefs = useRef(new Map<number, HTMLButtonElement>())
  const menuReturnFocusRef = useRef<HTMLButtonElement | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/players', { signal, headers: { accept: 'application/json' } })
    const body = await responseBody(response)
    if (!response.ok || !body.players) throw new Error(body.error || 'Could not load players.')
    setPlayers(body.players)
    setListError('')
    return body.players
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => refresh(controller.signal)).catch((reason) => {
      if (!controller.signal.aborted) setListError(reason instanceof Error ? reason.message : 'Could not load players.')
    })
    return () => controller.abort()
  }, [refresh, refreshKey])

  const closeMenu = useCallback((restoreFocus = true) => {
    const trigger = menuPlayer ? menuTriggerRefs.current.get(menuPlayer.id) : null
    menuReturnFocusRef.current = restoreFocus ? trigger ?? null : null
    setMenuPlayer(null)
  }, [menuPlayer])

  useEffect(() => {
    if (menuPlayer || !menuReturnFocusRef.current) return
    const trigger = menuReturnFocusRef.current
    menuReturnFocusRef.current = null
    window.requestAnimationFrame(() => trigger.focus())
  }, [menuPlayer])

  useEffect(() => {
    if (!menuPlayer) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !menuTriggerRefs.current.get(menuPlayer.id)?.contains(target)) {
        closeMenu(false)
      }
    }
    const reposition = () => {
      const rect = menuTriggerRefs.current.get(menuPlayer.id)?.getBoundingClientRect()
      if (!rect) return
      setMenuPosition({
        top: Math.min(rect.bottom + 4, window.innerHeight - 148),
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
    reposition()
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [closeMenu, menuPlayer])

  const openEditor = (player: LeaderboardEntry, returnFocus: HTMLElement, deleting = false) => {
    closeMenu(false)
    returnFocusRef.current = returnFocus
    setConfirmDeleteInitially(deleting)
    setSelected(player)
  }

  const closeEditor = () => {
    setSelected(null)
    setConfirmDeleteInitially(false)
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  const scanCode = (player: LeaderboardEntry) => {
    closeMenu()
    setListError('')
    onScanCode?.(player)
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      return
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next = index
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <section className="players-panel" aria-labelledby="players-heading">
      <div className="players-panel-header">
        <div><p className="eyebrow">Club roster</p><h2 id="players-heading">Players</h2></div>
        <p className="players-count">{players.length} registered</p>
      </div>
      {listError && <p className="games-message error" role="alert">{listError}</p>}
      <div className="players-table-wrap">
        <table className="players-table" aria-label="All players">
          <colgroup>
            <col className="player-id-col" />
            <col className="player-name-col" />
            <col className="player-rating-col" />
            <col className="player-record-col" />
            <col className="player-actions-col" />
          </colgroup>
          <thead><tr>
            <th className="numeric-column">ID</th><th>Player</th><th className="numeric-column">Elo</th>
            <th className="numeric-column">W/L/D</th><th className="actions-column" aria-label="Actions" />
          </tr></thead>
          <tbody>{players.map((player) => (
            <tr key={player.id}>
              <td className="numeric-column player-id-cell" data-label="ID">#{player.id}</td>
              <td className="player-name-cell"><button type="button" className="player-name-button" onClick={(event) => openEditor(player, event.currentTarget)}>
                {player.name}
              </button></td>
              <td className="numeric-column player-rating-cell" data-label="Elo">{player.currentRating}</td>
              <td className="numeric-column player-record-cell"
                aria-label={`${player.wins} wins, ${player.losses} losses, ${player.draws} draws`}>
                <span><strong>{player.wins}</strong><small>W</small></span>
                <span><strong>{player.losses}</strong><small>L</small></span>
                <span><strong>{player.draws}</strong><small>D</small></span>
              </td>
              <td className="actions-column">
                <button type="button" className="player-menu-trigger secondary" aria-label={`Actions for ${player.name}`}
                  aria-haspopup="menu" aria-expanded={menuPlayer?.id === player.id}
                  ref={(node) => { if (node) menuTriggerRefs.current.set(player.id, node); else menuTriggerRefs.current.delete(player.id) }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setMenuPosition({
                      top: Math.min(rect.bottom + 4, window.innerHeight - 148),
                      right: Math.max(8, window.innerWidth - rect.right),
                    })
                    setMenuPlayer((current) => current?.id === player.id ? null : player)
                  }}>⚙</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {menuPlayer && createPortal(
        <div className="player-action-menu" role="menu" aria-label={`Actions for ${menuPlayer.name}`}
          ref={menuRef} style={menuPosition} onKeyDown={onMenuKeyDown}>
          <button type="button" role="menuitem" onClick={(event) => openEditor(menuPlayer, menuTriggerRefs.current.get(menuPlayer.id) ?? event.currentTarget)}>Edit</button>
          <button type="button" role="menuitem" onClick={() => scanCode(menuPlayer)}>Scan Code</button>
          <button type="button" role="menuitem" className="danger"
            onClick={(event) => openEditor(menuPlayer, menuTriggerRefs.current.get(menuPlayer.id) ?? event.currentTarget, true)}>Delete</button>
        </div>,
        document.body,
      )}
      {selected && <PlayerCardDialog key={selected.id} player={selected} onClose={closeEditor}
        confirmDeleteInitially={confirmDeleteInitially}
        onScanCode={onScanCode}
        onMutate={async () => {
          await refresh()
          onMutate()
        }} />}
    </section>
  )
}
