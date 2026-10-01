import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { normalizePlayerName } from './qrPayload'
import { printRoundPlayerSticker } from './playerSticker'
import type { LeaderboardEntry, PlayerProfile } from './Leaderboard'

async function responseBody(response: Response) {
  return response.json() as Promise<{
    player?: unknown
    players?: LeaderboardEntry[]
    profile?: PlayerProfile
    error?: string
  }>
}

function ProfileGameCard({ game }: { game: PlayerProfile['recentGames'][number] }) {
  const delta = `${game.delta >= 0 ? '+' : ''}${game.delta}`
  return (
    <article className={`profile-game-card outcome-${game.outcome.toLowerCase()}`} tabIndex={0}
      aria-label={`${game.outcome === 'W' ? 'Win' : game.outcome === 'L' ? 'Loss' : 'Draw'} against ${game.opponent.name}`}>
      <div className="profile-game-card-heading">
        <strong>{game.outcome === 'W' ? 'Win' : game.outcome === 'L' ? 'Loss' : 'Draw'}</strong>
        <span>{game.result}</span>
      </div>
      <div className={`player-side ${game.color}-side`}>
        <span className="side-label">{game.color}</span>
        <strong>{game.opponent.name}</strong>
        <span className="player-rating">Opponent · #{game.opponent.id}</span>
      </div>
      <div className="profile-game-meta">
        <span>Table {game.tableNumber}</span>
        <span>{game.ratingBefore} → {game.ratingAfter} ({delta})</span>
        <time dateTime={game.finishedAt}>{new Date(game.finishedAt).toLocaleString()}</time>
      </div>
    </article>
  )
}

export function PlayersPanel({
  refreshKey,
  onMutate,
  printSticker = printRoundPlayerSticker,
}: {
  refreshKey: number
  onMutate: () => void
  printSticker?: (player: LeaderboardEntry) => Promise<void>
}) {
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menuPlayer, setMenuPlayer] = useState<LeaderboardEntry | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 })
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
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

  const loadProfile = useCallback(async (id: number, signal?: AbortSignal) => {
    const response = await fetch(`/api/players/${id}/profile?recentLimit=10`, {
      signal,
      headers: { accept: 'application/json' },
    })
    const body = await responseBody(response)
    if (!response.ok || !body.profile) throw new Error(body.error || 'Could not load player profile.')
    setProfile(body.profile)
    setEditName(body.profile.name)
    setProfileError('')
    return body.profile
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => refresh(controller.signal)).catch((reason) => {
      if (!controller.signal.aborted) setListError(reason instanceof Error ? reason.message : 'Could not load players.')
    })
    return () => controller.abort()
  }, [refresh, refreshKey])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    void Promise.resolve().then(() => loadProfile(selected.id, controller.signal)).catch((reason) => {
      if (!controller.signal.aborted) {
        setProfileError(reason instanceof Error ? reason.message : 'Could not load player profile.')
      }
    })
    window.requestAnimationFrame(() => {
      if (nameInputRef.current) nameInputRef.current.focus()
      else dialogRef.current?.focus()
    })
    return () => controller.abort()
  }, [loadProfile, selected])

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
    setProfile(null)
    setProfileError('')
    setConfirmDelete(deleting)
    setEditName(player.name)
    setSelected(player)
  }

  const closeEditor = () => {
    setSelected(null)
    setProfile(null)
    setProfileError('')
    setConfirmDelete(false)
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  const rename = async () => {
    if (!selected) return
    setBusy(true)
    setProfileError('')
    try {
      const name = normalizePlayerName(editName)
      const response = await fetch(`/api/players/${selected.id}`, {
        method: 'PATCH',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error || `Rename failed (${response.status}).`)
      await refresh()
      await loadProfile(selected.id)
      onMutate()
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not rename player.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selected) return
    setBusy(true)
    setProfileError('')
    try {
      const response = await fetch(`/api/players/${selected.id}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error || `Delete failed (${response.status}).`)
      await refresh()
      onMutate()
      closeEditor()
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not delete player.')
    } finally {
      setBusy(false)
    }
  }

  const doPrint = async (player: LeaderboardEntry) => {
    closeMenu()
    setListError('')
    try {
      await printSticker(player)
    } catch (reason) {
      setListError(reason instanceof Error ? reason.message : 'Could not generate the round sticker.')
    }
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
    <section className="players-panel" aria-labelledby="players-heading" aria-busy={busy}>
      <div><p className="eyebrow">Club roster</p><h2 id="players-heading">Players</h2></div>
      {listError && <p className="games-message error" role="alert">{listError}</p>}
      <div className="players-table-wrap">
        <table className="players-table" aria-label="All players">
          <thead><tr>
            <th className="numeric-column">ID</th><th>Player</th><th className="numeric-column">Elo</th>
            <th className="numeric-column">W/L/D</th><th className="actions-column" aria-label="Actions" />
          </tr></thead>
          <tbody>{players.map((player) => (
            <tr key={player.id}>
              <td className="numeric-column">#{player.id}</td>
              <td><button type="button" className="player-name-button" onClick={(event) => openEditor(player, event.currentTarget)}>
                {player.name}
              </button></td>
              <td className="numeric-column">{player.currentRating}</td>
              <td className="numeric-column">{player.wins}/{player.losses}/{player.draws}</td>
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
          <button type="button" role="menuitem" onClick={() => void doPrint(menuPlayer)}>Print sticker</button>
          <button type="button" role="menuitem" className="danger"
            onClick={(event) => openEditor(menuPlayer, menuTriggerRefs.current.get(menuPlayer.id) ?? event.currentTarget, true)}>Delete</button>
        </div>,
        document.body,
      )}
      {selected && createPortal(
        <div className="profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor() }}>
          <div className="profile-dialog player-edit-dialog" role="dialog" aria-modal="true"
            aria-labelledby="player-edit-title" tabIndex={-1} ref={dialogRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeEditor()
                return
              }
              if (event.key !== 'Tab') return
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ))
              const first = focusable[0]
              const last = focusable.at(-1)
              if (!first || !last) return
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus()
              }
            }}>
            <button type="button" className="profile-close" onClick={closeEditor} aria-label="Close player editor">×</button>
            <p className="eyebrow">Player #{selected.id}</p>
            <h2 id="player-edit-title">Edit {profile?.name ?? selected.name}</h2>
            <form className="player-edit-form" onSubmit={(event) => { event.preventDefault(); void rename() }}>
              <label htmlFor="edit-player-name">Player name</label>
              <div><input id="edit-player-name" ref={nameInputRef} maxLength={80} value={editName}
                onChange={(event) => setEditName(event.target.value)} />
                <button type="submit" disabled={busy}>Save name</button></div>
            </form>
            {profileError && <p className="games-message error" role="alert">{profileError}</p>}
            {!profile && !profileError && <p role="status">Loading player profile…</p>}
            {profile && <>
              <p className="profile-summary"><strong>{profile.currentRating} Elo</strong> · Rank #{profile.rank} ·
                {' '}{profile.wins}-{profile.losses}-{profile.draws} ({profile.gamesPlayed} games)</p>
              <h3>Recent games</h3>
              {profile.recentGames.length === 0
                ? <p>No completed games yet. Baseline Elo is 700.</p>
                : <div className="profile-game-strip" role="region" aria-label={`Recent games for ${profile.name}`} tabIndex={0}>
                    {profile.recentGames.map((game) => <ProfileGameCard key={game.id} game={game} />)}
                  </div>}
            </>}
            <div className="player-delete-zone">
              {!confirmDelete
                ? <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete player</button>
                : <>
                    <p><strong>Delete {profile?.name ?? selected.name}?</strong> Only players with no game references and baseline-only rating history can be deleted.</p>
                    <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Confirm delete</button>
                    <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>Cancel delete</button>
                  </>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
