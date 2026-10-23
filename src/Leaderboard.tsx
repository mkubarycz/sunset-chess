import { useCallback, useEffect, useRef, useState } from 'react'
import type { OngoingGame } from './GameCard'
import { ModalDialog } from './ModalDialog'
import { PlayerCardDialog, type LeaderboardEntry } from './PlayerCardDialog'

function recordLabel(wins: number, draws: number, losses: number) {
  return `${wins} ${wins === 1 ? 'win' : 'wins'}, ${draws} ${draws === 1 ? 'draw' : 'draws'}, ${losses} ${losses === 1 ? 'loss' : 'losses'}`
}

function StandingRecord({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  return (
    <span className="standing-record" role="group" aria-label={recordLabel(wins, draws, losses)}>
      <span className="standing-record-wins" aria-hidden="true">{wins}W</span>{' '}
      <span className="standing-record-draws" aria-hidden="true">{draws}D</span>{' '}
      <span className="standing-record-losses" aria-hidden="true">{losses}L</span>
    </span>
  )
}

export function Leaderboard({
  refreshKey,
  variant = 'default',
  onAddPlayer,
  addPlayerLabel = 'Add player',
  onScanCode,
  onCheckIn,
  onCheckOut,
  onOpenGame,
  onMoveWaitingPlayer,
  waitingGames = [],
  eventId,
  title = 'Current Club Standings',
  readOnly = false,
}: {
  refreshKey: number
  variant?: 'default' | 'rail'
  onAddPlayer?: (trigger: HTMLButtonElement) => void
  addPlayerLabel?: string
  onScanCode?: (player: LeaderboardEntry) => void
  onCheckIn?: (player: LeaderboardEntry) => Promise<void>
  onCheckOut?: (player: LeaderboardEntry) => Promise<void>
  onOpenGame?: (player: LeaderboardEntry) => void
  onMoveWaitingPlayer?: (player: LeaderboardEntry, destinationGameId: number, overrideStarted?: boolean) => Promise<void>
  waitingGames?: readonly OngoingGame[]
  eventId?: number
  title?: string
  readOnly?: boolean
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  const [checkingInId, setCheckingInId] = useState<number | null>(null)
  const [checkingOutId, setCheckingOutId] = useState<number | null>(null)
  const [movingPlayer, setMovingPlayer] = useState<LeaderboardEntry | null>(null)
  const [movingToGameId, setMovingToGameId] = useState<number | null>(null)
  const [moveError, setMoveError] = useState('')
  const [pendingMoveId, setPendingMoveId] = useState<number | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const moveReturnFocusRef = useRef<HTMLElement | null>(null)
  const sessionStandings = eventId !== undefined

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

  const checkOut = async (entry: LeaderboardEntry) => {
    if (!onCheckOut || checkingOutId !== null) return
    setCheckingOutId(entry.id)
    setError('')
    try {
      await onCheckOut(entry)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check out this player.')
    } finally {
      setCheckingOutId(null)
    }
  }

  const statusContent = (entry: LeaderboardEntry) => {
    if (entry.checkInStatus === 'checked-out') return 'Checked out · Unavailable'
    if (entry.checkInStatus === 'available') return 'Checked in · Available for pairing'
    if (entry.checkInStatus === 'waiting' && entry.tableNumber !== null) {
      return <>Waiting at {onOpenGame ? tableLink(entry) : `table ${entry.tableNumber}`}</>
    }
    if (['paired', 'playing'].includes(entry.checkInStatus ?? '') && entry.tableNumber !== null) {
      return <>{entry.checkInStatus === 'paired' ? 'Paired with' : 'Playing'} {entry.opponentName ?? 'an opponent'} on{' '}
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

  const movePlayer = async (destinationGameId: number, overrideStarted = false) => {
    if (!movingPlayer || !onMoveWaitingPlayer || movingToGameId !== null) return
    const destination = moveTargets.find((candidate) => candidate.id === destinationGameId)
    if (!overrideStarted && (sourceGame?.startedAt || destination?.startedAt)) {
      setPendingMoveId(destinationGameId)
      return
    }
    setMovingToGameId(destinationGameId)
    setMoveError('')
    try {
      if (overrideStarted) await onMoveWaitingPlayer(movingPlayer, destinationGameId, true)
      else await onMoveWaitingPlayer(movingPlayer, destinationGameId)
      setMovingPlayer(null)
      setPendingMoveId(null)
    } catch (reason) {
      setMoveError(reason instanceof Error ? reason.message : 'Could not move this player.')
      if (reason instanceof Error && 'requiresStartedOverride' in reason && reason.requiresStartedOverride === true) {
        setPendingMoveId(destinationGameId)
      }
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
            {sessionStandings && <p className="leaderboard-intro">
              Session cohorts A-D are fixed. Automatic pairing only matches players within the same cohort.
            </p>}
          </div>
          {onAddPlayer && <button type="button"
            onClick={(event) => onAddPlayer(event.currentTarget)}>{addPlayerLabel}</button>}
        </div>
        <div aria-live="polite">
          {loading && entries.length === 0 && <p>Loading leaderboard…</p>}
          {error && <p role="alert" className="games-message error">{error}</p>}
        </div>
        {!loading && !error && entries.length === 0 && <p>No players yet. New players begin at 700 Elo.</p>}
        {entries.length > 0 && (
          <div className="leaderboard-table-wrap">
            <table className={`leaderboard-table${eventId === undefined ? '' : ' session-leaderboard-table'}`}
              aria-label={sessionStandings ? 'Session standings' : 'Elo rankings'}>
              <thead><tr>
                <th>{sessionStandings ? 'Cohort' : 'Rank'}</th><th>Player</th><th>Elo</th><th>Record</th>
                {eventId !== undefined && <th>Session Record</th>}
              </tr></thead>
              <tbody>{entries.map((entry) => (
                <tr className={`leaderboard-row${sessionStandings ? '' : ` rank-${entry.rank}`}`} key={entry.id}>
                  {sessionStandings ? <td>
                    <span className={`leaderboard-cohort cohort-${entry.cohort ?? 'unassigned'}`}
                      aria-label={entry.cohort ? `Cohort ${entry.cohort}` : 'No cohort assigned'}>
                      {entry.cohort ?? '-'}
                    </span>
                  </td> : <td>
                    <span
                      className={`leaderboard-rank${entry.rank <= 3 ? ` podium podium-${entry.rank}` : ''}`}
                      aria-label={entry.rank === 1 ? 'Rank 1, gold' : entry.rank === 2
                        ? 'Rank 2, silver' : entry.rank === 3 ? 'Rank 3, bronze' : `Rank ${entry.rank}`}
                    >
                      {entry.rank}
                    </span>
                  </td>}
                  <td className="leaderboard-player">
                    <div className="leaderboard-player-content">
                      {readOnly ? <strong>{entry.name}</strong> : <button type="button" className="leaderboard-player-name"
                        aria-label={`Open player card for ${entry.name}`}
                        onClick={(event) => openPlayerCard(entry, event.currentTarget)}>
                        {entry.name}
                      </button>}
                      {!readOnly && <span className={`leaderboard-player-status status-${entry.checkInStatus ?? 'not-checked-in'}`}>
                        {statusContent(entry)}
                      </span>}
                      {onMoveWaitingPlayer && entry.checkInStatus === 'waiting' && (
                        <button type="button" className="leaderboard-move-player"
                          onClick={(event) => {
                            moveReturnFocusRef.current = event.currentTarget
                            setMoveError('')
                            setPendingMoveId(null)
                            setMovingPlayer(entry)
                          }}>
                          Move To...
                        </button>
                      )}
                      {sessionStandings && !readOnly && onCheckOut
                        && ['waiting', 'paired', 'playing', 'available'].includes(entry.checkInStatus ?? '') && (
                        <button type="button" className="leaderboard-check-out secondary"
                          aria-label={`Check out ${entry.name}`}
                          disabled={checkingOutId !== null || checkingInId !== null || entry.checkInStatus === 'playing'}
                          title={entry.checkInStatus === 'playing'
                            ? `Finish or cancel Table ${entry.tableNumber} before checking out.`
                            : `Check ${entry.name} out of this session`}
                          onClick={() => void checkOut(entry)}>
                          {checkingOutId === entry.id ? 'Checking out…' : 'Check out'}
                        </button>
                      )}
                      {sessionStandings && !readOnly && onCheckIn
                        && ['not-checked-in', 'checked-out'].includes(entry.checkInStatus ?? 'not-checked-in') && (
                        <button type="button" className="leaderboard-check-in"
                          disabled={checkingInId !== null || checkingOutId !== null}
                          aria-label={`Check in ${entry.name}`}
                          onClick={() => void checkIn(entry)}>
                          {checkingInId === entry.id ? 'Checking in…' : 'Check in'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="leaderboard-elo">{entry.currentRating}</td>
                  <td className="leaderboard-record">
                    <StandingRecord wins={entry.wins} draws={entry.draws} losses={entry.losses} />
                    {!readOnly && <button type="button" className="leaderboard-row-hit" onClick={(event) => {
                      openPlayerCard(entry, event.currentTarget)
                    }} aria-label={`${entry.name}, ${sessionStandings
                      ? entry.cohort ? `cohort ${entry.cohort}` : 'no cohort assigned'
                      : `rank ${entry.rank}`}, ${entry.currentRating} Elo, record: ${recordLabel(entry.wins, entry.draws, entry.losses)}`}>
                      <span className="visually-hidden">View {entry.name} profile</span>
                    </button>}
                  </td>
                  {eventId !== undefined && (
                    <td className="leaderboard-session-record">
                      <StandingRecord wins={entry.sessionWins ?? 0}
                        draws={entry.sessionDraws ?? 0} losses={entry.sessionLosses ?? 0} />
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {selected && <PlayerCardDialog key={selected.id} player={selected} refreshKey={refreshKey} onClose={close}
        onMutate={() => refresh()} onScanCode={onScanCode} />}
      {movingPlayer && (
        <ModalDialog title={`Move ${movingPlayer.name} to another table`}
          className=" move-player-dialog"
          closeLabel="Close move player dialog"
          returnFocusRef={moveReturnFocusRef}
          onClose={() => setMovingPlayer(null)}>
          <p>Select a table that is waiting for a player. Table {movingPlayer.tableNumber} will close.</p>
          {pendingMoveId !== null ? (
            <section aria-label="Confirm Started game move">
              <p role="alert">This game has already started. Moving this player requires your explicit override.</p>
              <div className="dialog-actions">
                <button type="button" className="secondary" disabled={movingToGameId !== null}
                  onClick={() => setPendingMoveId(null)}>Keep games unchanged</button>
                <button type="button" disabled={movingToGameId !== null}
                  onClick={() => void movePlayer(pendingMoveId, true)}>Override and move</button>
              </div>
            </section>
          ) : moveTargets.length === 0 ? (
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
