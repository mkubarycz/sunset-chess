import { useCallback, useEffect, useRef, useState } from 'react'
import { GameCard, type OngoingGame } from './GameCard'
import { ModalDialog } from './ModalDialog'
import { printRoundPlayerSticker } from './playerSticker'
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

function ratingReason(reason: RatingEvent['reason']) {
  if (reason === 'game') return 'Game result'
  if (reason === 'compensation') return 'Cancelled game'
  if (reason === 'migration') return 'Imported rating'
  return 'Starting rating'
}

export function PlayerCardDialog({
  player,
  onClose,
  onMutate,
  confirmDeleteInitially = false,
  printSticker = printRoundPlayerSticker,
}: {
  player: LeaderboardEntry
  onClose: () => void
  onMutate: () => void | Promise<void>
  confirmDeleteInitially?: boolean
  printSticker?: (player: LeaderboardEntry) => Promise<void>
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [editName, setEditName] = useState(player.name)
  const [confirmDelete, setConfirmDelete] = useState(confirmDeleteInitially)
  const [busy, setBusy] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const savedNameRef = useRef(player.name)
  const savePromiseRef = useRef<Promise<boolean> | null>(null)

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/players/${player.id}/profile?recentLimit=10`, {
      signal,
      headers: { accept: 'application/json' },
    })
    const body = await responseBody(response)
    if (!response.ok || !body.profile) throw new Error(body.error || 'Could not load player profile.')
    setProfile(body.profile)
    setEditName(body.profile.name)
    savedNameRef.current = body.profile.name
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
    return () => controller.abort()
  }, [confirmDeleteInitially, loadProfile, player.name])

  const saveName = () => {
    if (savePromiseRef.current) return savePromiseRef.current
    let name: string
    try {
      name = normalizePlayerName(editName)
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not rename player.')
      return Promise.resolve(false)
    }
    if (name === savedNameRef.current) {
      if (editName !== name) setEditName(name)
      return Promise.resolve(true)
    }
    const operation = (async () => {
      setSavingName(true)
      setProfileError('')
      try {
        const response = await fetch(`/api/players/${player.id}`, {
          method: 'PATCH',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        const body = await responseBody(response)
        if (!response.ok) throw new Error(body.error || `Rename failed (${response.status}).`)
        await onMutate()
        await loadProfile()
        return true
      } catch (reason) {
        setProfileError(reason instanceof Error ? reason.message : 'Could not rename player.')
        return false
      } finally {
        setSavingName(false)
      }
    })()
    savePromiseRef.current = operation
    void operation.finally(() => {
      if (savePromiseRef.current === operation) savePromiseRef.current = null
    })
    return operation
  }

  const closeAfterSave = async () => {
    if (await saveName()) onClose()
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

  const print = async () => {
    setBusy(true)
    setProfileError('')
    try {
      if (!await saveName()) return
      await printSticker({ ...player, name: savedNameRef.current })
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not generate the round sticker.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalDialog className=" profile-dialog player-edit-dialog"
      ariaLabel={`Player card for ${profile?.name ?? player.name}`}
      closeLabel="Close player card" initialFocusRef={nameInputRef} onClose={closeAfterSave}>
      <div aria-busy={busy || savingName}>
        <div className="player-card-identity">
          <form className="player-edit-form"
            onSubmit={(event) => { event.preventDefault(); void saveName() }}>
          <input id="edit-player-name" ref={nameInputRef} maxLength={80} value={editName}
              aria-label="Player name" onChange={(event) => setEditName(event.target.value)}
              onBlur={() => void saveName()} />
          </form>
          <p className="player-card-meta">
            <span>#{player.id}</span>
            <strong>{profile?.currentRating ?? player.currentRating} Elo</strong>
          </p>
        </div>
        {savingName && <p className="player-save-status" role="status">Saving name…</p>}
        {profileError && <p className="games-message error" role="alert">{profileError}</p>}
        {!profile && !profileError && <p role="status">Loading player profile…</p>}
        {profile && <>
          <p className="profile-summary">Rank #{profile.rank} ·
            {' '}{profile.wins}-{profile.losses}-{profile.draws} ({profile.gamesPlayed} games)</p>
          {profile.ongoingGames.length > 0 && <>
            <section className="player-card-section">
              <h3>Ongoing games</h3>
              <div className="profile-game-strip" role="region" aria-label={`Ongoing games for ${profile.name}`} tabIndex={0}>
                {profile.ongoingGames.map((game) => (
                  <GameCard key={game.id} game={game} management={false} />
                ))}
              </div>
            </section>
          </>}
          <section className="player-card-section player-card-recent">
            <h3>Recent games</h3>
            {profile.recentGames.length === 0
              ? <p>No completed games yet. Baseline Elo is 700.</p>
              : <div className="profile-game-strip" role="region" aria-label={`Recent games for ${profile.name}`} tabIndex={0}>
                  {profile.recentGames.slice(0, 10).map((game) => (
                    <GameCard key={game.id} game={profileGameToGameCard(profile, game)} management={false} />
                  ))}
                </div>
            }
          </section>
          <section className="player-card-section player-card-history">
            <h3>Elo history</h3>
            {profile.ratingHistory.length === 0
              ? <p>No Elo history is available.</p>
              : <div className="rating-history">
                  <div className="rating-history-table-wrap">
                    <table aria-label={`Elo history for ${profile.name}`}>
                      <thead><tr><th>Date</th><th>Reason</th><th>Change</th><th>Elo</th></tr></thead>
                      <tbody>{[...profile.ratingHistory].reverse().map((event) => (
                        <tr key={event.id}>
                          <td><time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleDateString()}</time></td>
                          <td>{ratingReason(event.reason)}{event.gameId ? ` #${event.gameId}` : ''}</td>
                          <td className={event.delta > 0 ? 'positive' : event.delta < 0 ? 'negative' : ''}>
                            {event.delta > 0 ? '+' : ''}{event.delta}
                          </td>
                          <td>{event.rating}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>}
          </section>
        </>}
        <div className="player-delete-zone">
          {!confirmDelete
            ? <div className="player-card-actions">
                <button type="button" className="secondary" disabled={busy || savingName}
                  onClick={() => void print()}>
                  Print sticker
                </button>
                <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
                  Delete player
                </button>
              </div>
            : <>
                <p><strong>Delete {profile?.name ?? player.name}?</strong> Only players with no game references and baseline-only rating history can be deleted.</p>
                <div className="player-card-actions">
                  <button type="button" className="danger" disabled={busy || savingName}
                    onClick={() => void remove()}>Confirm delete</button>
                  <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>Cancel delete</button>
                </div>
              </>}
        </div>
      </div>
    </ModalDialog>
  )
}
