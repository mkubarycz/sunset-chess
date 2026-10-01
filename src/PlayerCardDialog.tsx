import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GameCard, type OngoingGame } from './GameCard'
import { normalizePlayerName } from './qrPayload'

export interface LeaderboardEntry {
  rank: number
  id: number
  name: string
  currentRating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  lastPlayedAt: string | null
}

export interface RatingEvent {
  id: number
  gameId: number | null
  previousRating: number
  rating: number
  delta: number
  recordedAt: string
  reason: 'baseline' | 'game' | 'migration' | 'compensation'
}

export interface PlayerProfile extends LeaderboardEntry {
  ongoingGames: OngoingGame[]
  recentGames: Array<{
    id: number
    tableNumber: number
    opponent: { id: number; name: string; rating: number; delta: number }
    color: 'black' | 'white'
    result: '1-0' | '0-1' | '1/2-1/2'
    outcome: 'W' | 'L' | 'D'
    finishedAt: string
    ratingBefore: number
    ratingAfter: number
    delta: number
  }>
  ratingHistory: RatingEvent[]
}

async function responseBody(response: Response) {
  return response.json() as Promise<{ player?: unknown; profile?: PlayerProfile; error?: string }>
}

function profileGameToGameCard(
  profile: PlayerProfile,
  game: PlayerProfile['recentGames'][number],
): OngoingGame {
  const player = { id: profile.id, name: profile.name, rating: game.ratingAfter }
  const opponent = { id: game.opponent.id, name: game.opponent.name, rating: game.opponent.rating }
  const playerIsBlack = game.color === 'black'
  return {
    id: game.id,
    tableNumber: game.tableNumber,
    createdAt: game.finishedAt,
    finishedAt: game.finishedAt,
    result: game.result,
    blackPlayerId: playerIsBlack ? player.id : opponent.id,
    whitePlayerId: playerIsBlack ? opponent.id : player.id,
    blackPlayer: playerIsBlack ? player : opponent,
    whitePlayer: playerIsBlack ? opponent : player,
    blackRatingDelta: playerIsBlack ? game.delta : game.opponent.delta,
    whiteRatingDelta: playerIsBlack ? game.opponent.delta : game.delta,
  }
}

export function PlayerCardDialog({
  player,
  onClose,
  onMutate,
  confirmDeleteInitially = false,
}: {
  player: LeaderboardEntry
  onClose: () => void
  onMutate: () => void | Promise<void>
  confirmDeleteInitially?: boolean
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [editName, setEditName] = useState(player.name)
  const [confirmDelete, setConfirmDelete] = useState(confirmDeleteInitially)
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/players/${player.id}/profile?recentLimit=10`, {
      signal,
      headers: { accept: 'application/json' },
    })
    const body = await responseBody(response)
    if (!response.ok || !body.profile) throw new Error(body.error || 'Could not load player profile.')
    setProfile(body.profile)
    setEditName(body.profile.name)
    setProfileError('')
    return body.profile
  }, [player.id])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => loadProfile(controller.signal)).catch((reason) => {
      if (!controller.signal.aborted) {
        setProfileError(reason instanceof Error ? reason.message : 'Could not load player profile.')
      }
    })
    window.requestAnimationFrame(() => {
      if (nameInputRef.current) nameInputRef.current.focus()
      else dialogRef.current?.focus()
    })
    return () => controller.abort()
  }, [confirmDeleteInitially, loadProfile, player.name])

  const rename = async () => {
    setBusy(true)
    setProfileError('')
    try {
      const name = normalizePlayerName(editName)
      const response = await fetch(`/api/players/${player.id}`, {
        method: 'PATCH',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error || `Rename failed (${response.status}).`)
      await onMutate()
      await loadProfile()
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not rename player.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setProfileError('')
    try {
      const response = await fetch(`/api/players/${player.id}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error || `Delete failed (${response.status}).`)
      await onMutate()
      onClose()
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not delete player.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="profile-dialog player-edit-dialog" role="dialog" aria-modal="true"
        aria-labelledby="player-card-title" aria-busy={busy} tabIndex={-1} ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
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
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}>
        <button type="button" className="profile-close" onClick={onClose} aria-label="Close player card">×</button>
        <p className="eyebrow">Player #{player.id}</p>
        <h2 id="player-card-title">Edit {profile?.name ?? player.name}</h2>
        <form className="player-edit-form" onSubmit={(event) => { event.preventDefault(); void rename() }}>
          <label htmlFor="edit-player-name">Player name</label>
          <div>
            <input id="edit-player-name" ref={nameInputRef} maxLength={80} value={editName}
              onChange={(event) => setEditName(event.target.value)} />
            <button type="submit" disabled={busy}>Save name</button>
          </div>
        </form>
        {profileError && <p className="games-message error" role="alert">{profileError}</p>}
        {!profile && !profileError && <p role="status">Loading player profile…</p>}
        {profile && <>
          <p className="profile-summary"><strong>{profile.currentRating} Elo</strong> · Rank #{profile.rank} ·
            {' '}{profile.wins}-{profile.losses}-{profile.draws} ({profile.gamesPlayed} games)</p>
          {profile.ongoingGames.length > 0 && <>
            <h3>Ongoing games</h3>
            <div className="profile-game-strip" role="region" aria-label={`Ongoing games for ${profile.name}`} tabIndex={0}>
              {profile.ongoingGames.map((game) => (
                <GameCard key={game.id} game={game} management={false} />
              ))}
            </div>
          </>}
          <h3>Recent games</h3>
          {profile.recentGames.length === 0
            ? <p>No completed games yet. Baseline Elo is 700.</p>
            : <div className="profile-game-strip" role="region" aria-label={`Recent games for ${profile.name}`} tabIndex={0}>
                {profile.recentGames.slice(0, 10).map((game) => (
                  <GameCard key={game.id} game={profileGameToGameCard(profile, game)} management={false} />
                ))}
              </div>}
        </>}
        <div className="player-delete-zone">
          {!confirmDelete
            ? <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete player</button>
            : <>
                <p><strong>Delete {profile?.name ?? player.name}?</strong> Only players with no game references and baseline-only rating history can be deleted.</p>
                <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Confirm delete</button>
                <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>Cancel delete</button>
              </>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
