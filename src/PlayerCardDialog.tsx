import { useCallback, useEffect, useRef, useState } from 'react'
import { GameCard, type OngoingGame } from './GameCard'
import { ModalDialog } from './ModalDialog'
import { normalizePlayerName } from './qrPayload'

export interface LeaderboardEntry {
  rank: number
  cohort?: 'A' | 'B' | 'C' | 'D' | null
  id: number
  name: string
  currentRating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  lastPlayedAt: string | null
  checkInStatus?: 'not-checked-in' | 'waiting' | 'paired' | 'playing' | 'available' | 'checked-out'
  tableNumber?: number | null
  opponentName?: string | null
  sessionGamesPlayed?: number
  sessionWins?: number
  sessionLosses?: number
  sessionDraws?: number
  scanningIdentifier?: string | null
}

export interface RatingEvent {
  id: number
  gameId: number | null
  previousRating: number
  rating: number
  delta: number
  recordedAt: string
  reason: 'baseline' | 'game' | 'migration' | 'compensation'
  opponentName: string | null
  opponentRatingBefore: number | null
  opponentDelta: number | null
  outcome: 'win' | 'draw' | 'loss' | null
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
    blackStartingRating: playerIsBlack ? game.ratingBefore : game.opponent.rating - game.opponent.delta,
    whiteStartingRating: playerIsBlack ? game.opponent.rating - game.opponent.delta : game.ratingBefore,
    blackRatingDelta: playerIsBlack ? game.delta : game.opponent.delta,
    whiteRatingDelta: playerIsBlack ? game.opponent.delta : game.delta,
  }
}

function ratingReason(event: RatingEvent) {
  if (event.reason === 'game') {
    if (!event.opponentName || !event.outcome) return 'Game result (details unavailable)'
    const outcome = event.outcome === 'win' ? 'Win' : event.outcome === 'loss' ? 'Loss' : 'Draw'
    return <span className="rating-game-reason">
      <span>{outcome} v {event.opponentName}</span>
      {event.opponentRatingBefore == null || event.opponentDelta == null
        ? <span className="rating-opponent-elo">Opponent Elo unavailable</span>
        : <>
            <span className="rating-opponent-elo"
              aria-label={`${event.opponentName}'s pre-game Elo: ${event.opponentRatingBefore}`}>
              {event.opponentRatingBefore}
            </span>
            <span className={`rating-opponent-delta${event.opponentDelta > 0 ? ' positive' : event.opponentDelta < 0 ? ' negative' : ''}`}
              aria-label={`${event.opponentName}'s Elo change: ${event.opponentDelta > 0 ? '+' : ''}${event.opponentDelta}`}>
              {event.opponentDelta > 0 ? '+' : ''}{event.opponentDelta}
            </span>
          </>}
    </span>
  }
  if (event.reason === 'compensation') {
    return event.opponentName ? `Cancelled game v. ${event.opponentName}` : 'Cancelled game'
  }
  if (event.reason === 'migration') return 'Imported rating'
  return 'Starting rating'
}

function ordinal(value: number) {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  if (value % 10 === 1) return `${value}st`
  if (value % 10 === 2) return `${value}nd`
  if (value % 10 === 3) return `${value}rd`
  return `${value}th`
}

function displayedScanningIdentifier(player: LeaderboardEntry): string {
  const identifier = player.scanningIdentifier ?? String(player.id)
  return identifier.length > 40 ? `${identifier.slice(0, 39)}…` : identifier
}

export function PlayerCardDialog({
  player,
  refreshKey = 0,
  onClose,
  onMutate,
  confirmDeleteInitially = false,
  onScanCode,
}: {
  player: LeaderboardEntry
  refreshKey?: number
  onClose: () => void
  onMutate: () => void | Promise<void>
  confirmDeleteInitially?: boolean
  onScanCode?: (player: LeaderboardEntry) => void
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [editName, setEditName] = useState(player.name)
  const [confirmDelete, setConfirmDelete] = useState(confirmDeleteInitially)
  const [busy, setBusy] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [openedGame, setOpenedGame] = useState<OngoingGame | null>(null)
  const [openingGame, setOpeningGame] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const savedNameRef = useRef(player.name)
  const savePromiseRef = useRef<Promise<boolean> | null>(null)
  const gameRequestRef = useRef<AbortController | null>(null)

  useEffect(() => () => gameRequestRef.current?.abort(), [])

  const loadProfile = useCallback(async (signal?: AbortSignal, preserveDraft = false) => {
    if (preserveDraft && savePromiseRef.current) return
    const response = await fetch(`/api/players/${player.id}/profile?recentLimit=10`, {
      signal,
      headers: { accept: 'application/json' },
    })
    const body = await responseBody(response)
    if (signal?.aborted || (preserveDraft && savePromiseRef.current)) return body.profile
    if (!response.ok || !body.profile) throw new Error(body.error || 'Could not load player profile.')
    const nextProfile = body.profile
    const previousName = savedNameRef.current
    setProfile(nextProfile)
    setEditName((current) => preserveDraft && current !== previousName ? current : nextProfile.name)
    savedNameRef.current = nextProfile.name
    setProfileError('')
    return body.profile
  }, [player.id])

  useEffect(() => {
    if (openedGame) return
    const controller = new AbortController()
    void Promise.resolve().then(() => loadProfile(controller.signal, true)).catch((reason) => {
      if (!controller.signal.aborted) {
        setProfileError(reason instanceof Error ? reason.message : 'Could not load player profile.')
      }
    })
    return () => controller.abort()
  }, [confirmDeleteInitially, loadProfile, openedGame, player.name, refreshKey])

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

  const scanCode = async () => {
    setBusy(true)
    setProfileError('')
    try {
      if (!await saveName()) return
      onScanCode?.({ ...player, name: savedNameRef.current })
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not open the code scanner.')
    } finally {
      setBusy(false)
    }
  }

  const openGame = async (gameId: number) => {
    if (gameRequestRef.current) return
    const controller = new AbortController()
    gameRequestRef.current = controller
    setOpeningGame(true)
    setProfileError('')
    try {
      if (!await saveName() || controller.signal.aborted) return
      const response = await fetch(`/api/games/${gameId}`, {
        signal: controller.signal, headers: { accept: 'application/json' },
      })
      const body = await response.json() as { game?: OngoingGame; error?: string }
      if (controller.signal.aborted) return
      if (!response.ok || !body.game || body.game.id !== gameId) {
        throw new Error(body.error || `Could not open game (${response.status}).`)
      }
      setOpenedGame(body.game)
    } catch (reason) {
      if (!controller.signal.aborted) {
        setProfileError(reason instanceof Error ? reason.message : 'Could not open game.')
      }
    } finally {
      if (gameRequestRef.current === controller) gameRequestRef.current = null
      if (!controller.signal.aborted) setOpeningGame(false)
    }
  }

  if (openedGame) {
    return <GameCard key={openedGame.id} game={openedGame} mode="dialog" onClose={onClose}
      onMutate={async (game) => {
        await onMutate()
        setOpenedGame((current) => current ? { ...current, ...game } : current)
      }} />
  }

  return (
    <ModalDialog className=" profile-dialog player-edit-dialog"
      ariaLabel={`Player card for ${profile?.name ?? player.name}`}
      closeLabel="Close player card" initialFocusRef={nameInputRef} onClose={closeAfterSave}>
      <div aria-busy={busy || savingName || openingGame}>
        <div className="player-card-identity">
          <form className="player-edit-form"
            onSubmit={(event) => { event.preventDefault(); void saveName() }}>
          <input id="edit-player-name" ref={nameInputRef} maxLength={80} value={editName}
              disabled={busy || openingGame}
              aria-label="Player name" onChange={(event) => setEditName(event.target.value)}
              onBlur={() => void saveName()} />
          </form>
          <p className="player-card-meta">
            <span>#{player.id}</span>
            <span title={profile?.scanningIdentifier ?? player.scanningIdentifier ?? String(player.id)}>
              Scan code: {displayedScanningIdentifier(profile ?? player)}
            </span>
          </p>
        </div>
        {savingName && <p className="player-save-status" role="status">Saving name…</p>}
        {openingGame && <p role="status">Opening game...</p>}
        {profileError && <p className="games-message error" role="alert">{profileError}</p>}
        {!profile && !profileError && <p role="status">Loading player profile…</p>}
        {profile && <>
          <p className="profile-summary">
            <strong>{profile.currentRating} Elo</strong>
            <span aria-hidden="true"> · </span>
            Class Rank {ordinal(profile.rank)}
            <span aria-hidden="true"> · </span>
            All Time Record {profile.wins}-{profile.losses}-{profile.draws} ({profile.gamesPlayed} Games)
          </p>
          {profile.ongoingGames.length > 0 && <>
            <section className="player-card-section">
              <h3>Ongoing games</h3>
              <div className="profile-game-strip" role="region" aria-label={`Ongoing games for ${profile.name}`} tabIndex={0}>
                {profile.ongoingGames.map((game) => (
                  <GameCard key={game.id} game={game} management={false}
                    onOpenDetails={() => void openGame(game.id)} />
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
                    <GameCard key={game.id} game={profileGameToGameCard(profile, game)}
                      management={false} onOpenDetails={() => void openGame(game.id)} />
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
                          <td>{event.gameId !== null
                            ? <button type="button" className="rating-game-link" disabled={openingGame}
                              aria-label={`Open game ${event.gameId} from ${new Date(event.recordedAt).toLocaleDateString()}`}
                              onClick={() => { if (event.gameId !== null) void openGame(event.gameId) }}>
                                <time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleDateString()}</time>
                              </button>
                            : <time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleDateString()}</time>}
                          </td>
                          <td>{ratingReason(event)}</td>
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
                  onClick={() => void scanCode()}>
                  Scan Code
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
