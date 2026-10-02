import { useCallback, useEffect, useRef, useState } from 'react'
import type { OngoingGame } from './GameCard'
import { ModalDialog } from './ModalDialog'
import { PlayerCardDialog, type LeaderboardEntry } from './PlayerCardDialog'

export function Leaderboard({
  refreshKey,
  variant = 'default',
  onAddPlayer,
  addPlayerLabel = 'Add player',
  printSticker,
  onCheckIn,
  onOpenGame,
  onMoveWaitingPlayer,
  waitingGames = [],
  eventId,
  title = 'Current Club Standings',
}: {
  refreshKey: number
  variant?: 'default' | 'rail'
  onAddPlayer?: (trigger: HTMLButtonElement) => void
  addPlayerLabel?: string
  printSticker?: (player: LeaderboardEntry) => Promise<void>
  onCheckIn?: (player: LeaderboardEntry) => Promise<void>
  onOpenGame?: (player: LeaderboardEntry) => void
  onMoveWaitingPlayer?: (player: LeaderboardEntry, destinationGameId: number) => Promise<void>
  waitingGames?: readonly OngoingGame[]
  eventId?: number
  title?: string
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  const [checkingInId, setCheckingInId] = useState<number | null>(null)
  const [movingPlayer, setMovingPlayer] = useState<LeaderboardEntry | null>(null)
  const [movingToGameId, setMovingToGameId] = useState<number | null>(null)
  const [moveError, setMoveError] = useState('')
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const moveReturnFocusRef = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!signal?.aborted) setLoading(true)
    try {
      const query = eventId === undefined ? '' : `?eventId=${eventId}`
      const response = await fetch(`/api/leaderboard${query}`, {
        signal,
        headers: { accept: 'application/json' },
      })
      const body = await response.json() as { leaderboard?: LeaderboardEntry[]; error?: string }
      if (!response.ok || !body.leaderboard) throw new Error(body.error || 'Could not load leaderboard.')
      setEntries(body.leaderboard)
      setError('')
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Could not load leaderboard.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => refresh(controller.signal))
    return () => controller.abort()
  }, [refresh, refreshKey])

  const close = () => {
    setSelected(null)
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  const openPlayerCard = (entry: LeaderboardEntry, trigger: HTMLElement) => {
    returnFocusRef.current = trigger
    setSelected(entry)
  }

  const checkIn = async (entry: LeaderboardEntry) => {
    if (!onCheckIn || checkingInId !== null) return
    setCheckingInId(entry.id)
    setError('')
    try {
      await onCheckIn(entry)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check in this player.')
    } finally {
      setCheckingInId(null)
    }
  }

  const tableLink = (entry: LeaderboardEntry) => (
    <button type="button" className="leaderboard-table-link"
      aria-label={`Open Table ${entry.tableNumber} game details`}
      onClick={() => onOpenGame?.(entry)}>
      table {entry.tableNumber}
    </button>
  )

  const statusContent = (entry: LeaderboardEntry) => {
    if (entry.checkInStatus === 'waiting' && entry.tableNumber !== null) {
      return <>Waiting at {onOpenGame ? tableLink(entry) : `table ${entry.tableNumber}`}</>
    }
    if (entry.checkInStatus === 'playing' && entry.tableNumber !== null) {
      return <>Playing {entry.opponentName ?? 'an opponent'} on{' '}
        {onOpenGame ? tableLink(entry) : `table ${entry.tableNumber}`}</>
    }
    return 'Not checked in'
  }

  const sourceGame = movingPlayer
    ? waitingGames.find((game) =>
      game.result === null && !game.cancelledAt
      && (game.blackPlayerId === movingPlayer.id || game.whitePlayerId === movingPlayer.id))
    : undefined
  const moveTargets = sourceGame
    ? waitingGames.filter((game) =>
      game.id !== sourceGame.id
      && game.result === null
      && !game.cancelledAt
      && (game.blackPlayerId === null) !== (game.whitePlayerId === null)
      && (game.eventId ?? null) === (sourceGame.eventId ?? null))
    : []

  const movePlayer = async (destinationGameId: number) => {
    if (!movingPlayer || !onMoveWaitingPlayer || movingToGameId !== null) return
    setMovingToGameId(destinationGameId)
    setMoveError('')
    try {
      await onMoveWaitingPlayer(movingPlayer, destinationGameId)
      setMovingPlayer(null)
    } catch (reason) {
      setMoveError(reason instanceof Error ? reason.message : 'Could not move this player.')
    } finally {
      setMovingToGameId(null)
    }
  }

  return (
    <>
      <section className={`leaderboard leaderboard-${variant}`} aria-labelledby="leaderboard-heading" aria-busy={loading}>
        <div className="section-heading leaderboard-heading">
          <div>
            <h2 id="leaderboard-heading">{title}</h2>
          </div>
          {onAddPlayer && <button type="button"
            onClick={(event) => onAddPlayer(event.currentTarget)}>{addPlayerLabel}</button>}
        </div>
        <div aria-live="polite">
          {loading && entries.length === 0 && <p>Loading leaderboard…</p>}
          {error && <p className="games-message error">{error}</p>}
        </div>
        {!loading && !error && entries.length === 0 && <p>No players yet. New players begin at 700 Elo.</p>}
        {entries.length > 0 && (
          <div className="leaderboard-table-wrap">
            <table className={`leaderboard-table${eventId === undefined ? '' : ' session-leaderboard-table'}`}
              aria-label="Elo rankings">
              <thead><tr>
                <th>Rank</th><th>Player</th><th>Elo</th><th>Record</th>
                {eventId !== undefined && <th>Session Record</th>}
              </tr></thead>
              <tbody>{entries.map((entry) => (
                <tr className={`leaderboard-row rank-${entry.rank}`} key={entry.id}>
                  <td>
                    <span
                      className={`leaderboard-rank${entry.rank <= 3 ? ` podium podium-${entry.rank}` : ''}`}
                      aria-label={entry.rank === 1 ? 'Rank 1, gold' : entry.rank === 2
                        ? 'Rank 2, silver' : entry.rank === 3 ? 'Rank 3, bronze' : `Rank ${entry.rank}`}
                    >
                      {entry.rank}
                    </span>
                  </td>
                  <td className="leaderboard-player">
                    <div className="leaderboard-player-content">
                      <button type="button" className="leaderboard-player-name"
                        aria-label={`Open player card for ${entry.name}`}
                        onClick={(event) => openPlayerCard(entry, event.currentTarget)}>
                        {entry.name}
                      </button>
                      <span className={`leaderboard-player-status status-${entry.checkInStatus ?? 'not-checked-in'}`}>
                        {statusContent(entry)}
                      </span>
                      {onMoveWaitingPlayer && entry.checkInStatus === 'waiting' && (
                        <button type="button" className="leaderboard-move-player"
                          onClick={(event) => {
                            moveReturnFocusRef.current = event.currentTarget
                            setMoveError('')
                            setMovingPlayer(entry)
                          }}>
                          Move To...
                        </button>
                      )}
                      {onCheckIn && (entry.checkInStatus ?? 'not-checked-in') === 'not-checked-in' && (
                        <button type="button" className="leaderboard-check-in"
                          disabled={checkingInId !== null}
                          aria-label={`Check in ${entry.name}`}
                          onClick={() => void checkIn(entry)}>
                          {checkingInId === entry.id ? 'Checking in…' : 'Check in'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="leaderboard-elo">{entry.currentRating}</td>
                  <td className="leaderboard-record">
                    <span>{entry.wins}-{entry.losses}-{entry.draws}</span>
                    <small>{entry.gamesPlayed}g</small>
                    <button type="button" className="leaderboard-row-hit" onClick={(event) => {
                      openPlayerCard(entry, event.currentTarget)
                    }} aria-label={`${entry.name}, rank ${entry.rank}, ${entry.currentRating} Elo, ${entry.wins}-${entry.losses}-${entry.draws} record`}>
                      <span className="visually-hidden">View {entry.name} profile</span>
                    </button>
                  </td>
                  {eventId !== undefined && (
                    <td className="leaderboard-session-record">
                      <span>{entry.sessionWins ?? 0}-{entry.sessionLosses ?? 0}-{entry.sessionDraws ?? 0}</span>
                      <small>{entry.sessionGamesPlayed ?? 0}g</small>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {selected && <PlayerCardDialog key={selected.id} player={selected} onClose={close}
        onMutate={() => refresh()} printSticker={printSticker} />}
      {movingPlayer && (
        <ModalDialog title={`Move ${movingPlayer.name} to another table`}
          className=" move-player-dialog"
          closeLabel="Close move player dialog"
          returnFocusRef={moveReturnFocusRef}
          onClose={() => setMovingPlayer(null)}>
          <p>Select a table that is waiting for a player. Table {movingPlayer.tableNumber} will close.</p>
          {moveTargets.length === 0 ? (
            <p className="games-message">No other tables are waiting for a player.</p>
          ) : (
            <div className="move-player-options">
              {moveTargets.map((game) => {
                const opponent = game.blackPlayer ?? game.whitePlayer
                return (
                  <button type="button" key={game.id}
                    disabled={movingToGameId !== null}
                    onClick={() => void movePlayer(game.id)}>
                    {movingToGameId === game.id
                      ? `Moving to Table ${game.tableNumber}…`
                      : `Table ${game.tableNumber} — waiting for ${opponent?.name ?? 'a player'}`}
                  </button>
                )
              })}
            </div>
          )}
          {moveError && <p className="games-message error">{moveError}</p>}
        </ModalDialog>
      )}
    </>
  )
}
