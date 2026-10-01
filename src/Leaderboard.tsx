import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  reason: 'baseline' | 'game' | 'migration'
}

export interface PlayerProfile extends LeaderboardEntry {
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

function Sparkline({ events, name }: { events: RatingEvent[]; name: string }) {
  const values = events.map((event) => event.rating)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const points = values.map((rating, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100
    const y = maximum === minimum ? 20 : 38 - ((rating - minimum) / (maximum - minimum)) * 36
    return `${x},${y}`
  }).join(' ')
  return (
    <svg className="rating-sparkline" viewBox="0 0 100 40" role="img"
      aria-label={`${name} Elo history from ${values[0]} to ${values.at(-1)}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Leaderboard({ refreshKey, variant = 'default' }: {
  refreshKey: number
  variant?: 'default' | 'rail'
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setLoading(true)
      return fetch('/api/leaderboard', { signal: controller.signal, headers: { accept: 'application/json' } })
    })
      .then(async (response) => {
        const body = await response.json() as { leaderboard?: LeaderboardEntry[]; error?: string }
        if (!response.ok || !body.leaderboard) throw new Error(body.error || 'Could not load leaderboard.')
        setEntries(body.leaderboard)
        setError('')
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load leaderboard.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refreshKey])

  useEffect(() => {
    if (selectedId === null) return
    const controller = new AbortController()
    void fetch(`/api/players/${selectedId}/profile`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    }).then(async (response) => {
      const body = await response.json() as { profile?: PlayerProfile; error?: string }
      if (!response.ok || !body.profile) throw new Error(body.error || 'Could not load player profile.')
      setProfile(body.profile)
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setProfileError(reason instanceof Error ? reason.message : 'Could not load player profile.')
      }
    })
    window.requestAnimationFrame(() => dialogRef.current?.focus())
    return () => controller.abort()
  }, [selectedId])

  const close = () => {
    setSelectedId(null)
    setProfile(null)
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  return (
    <>
      <section className={`leaderboard leaderboard-${variant}`} aria-labelledby="leaderboard-heading" aria-busy={loading}>
        <div>
          <p className="eyebrow">Ratings</p>
          <h2 id="leaderboard-heading">Elo Leaderboard</h2>
          <p className="leaderboard-intro">Current club standings</p>
        </div>
        <div aria-live="polite">
          {loading && entries.length === 0 && <p>Loading leaderboard…</p>}
          {error && <p className="games-message error">{error}</p>}
        </div>
        {!loading && !error && entries.length === 0 && <p>No players yet. New players begin at 700 Elo.</p>}
        {entries.length > 0 && (
          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table" aria-label="Elo rankings">
              <thead><tr><th>Rank</th><th>Player</th><th>Elo</th><th>Record</th></tr></thead>
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
                  <td className="leaderboard-player"><strong>{entry.name}</strong></td>
                  <td className="leaderboard-elo">{entry.currentRating}</td>
                  <td className="leaderboard-record">
                    <span>{entry.wins}-{entry.losses}-{entry.draws}</span>
                    <small>{entry.gamesPlayed}g</small>
                    <button type="button" className="leaderboard-row-hit" onClick={(event) => {
                      returnFocusRef.current = event.currentTarget
                      setProfile(null)
                      setProfileError('')
                      setSelectedId(entry.id)
                    }} aria-label={`${entry.name}, rank ${entry.rank}, ${entry.currentRating} Elo, ${entry.wins}-${entry.losses}-${entry.draws} record`}>
                      <span className="visually-hidden">View {entry.name} profile</span>
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {selectedId !== null && createPortal(
        <div className="profile-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close()
        }}>
          <div className="profile-dialog" role="dialog" aria-modal="true"
            aria-labelledby={profile ? 'profile-title' : undefined}
            aria-label={profile ? undefined : 'Player profile'}
            tabIndex={-1} ref={dialogRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close()
              if (event.key !== 'Tab') return
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ))
              if (focusable.length === 0) {
                event.preventDefault()
                event.currentTarget.focus()
                return
              }
              const first = focusable[0]
              const last = focusable.at(-1) as HTMLElement
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
              }
            }}>
            <button type="button" className="profile-close" onClick={close} aria-label="Close player profile">×</button>
            {!profile && !profileError && <p role="status">Loading player profile…</p>}
            {profileError && <p role="alert">{profileError}</p>}
            {profile && (
              <>
                <p className="eyebrow">Player #{profile.id}</p>
                <h2 id="profile-title">{profile.name}</h2>
                <p className="profile-summary"><strong>{profile.currentRating} Elo</strong> · Rank #{profile.rank} ·
                  {' '}{profile.wins}-{profile.losses}-{profile.draws} ({profile.gamesPlayed} games)</p>
                <h3>Recent games</h3>
                {profile.recentGames.length === 0 ? <p>No completed games yet. Baseline Elo is 700.</p> : (
                  <div className="profile-table-wrap"><table>
                    <thead><tr><th>Outcome</th><th>Opponent</th><th>Color</th><th>Elo</th><th>Played</th></tr></thead>
                    <tbody>{profile.recentGames.map((game) => <tr key={game.id}>
                      <td>{game.outcome} ({game.result})</td><td>{game.opponent.name}</td>
                      <td>{game.color}</td>
                      <td>{game.ratingBefore}→{game.ratingAfter} ({game.delta >= 0 ? '+' : ''}{game.delta})</td>
                      <td>Table {game.tableNumber}<br /><time dateTime={game.finishedAt}>{new Date(game.finishedAt).toLocaleString()}</time></td>
                    </tr>)}</tbody>
                  </table></div>
                )}
                <h3>Elo history</h3>
                <Sparkline events={profile.ratingHistory} name={profile.name} />
                <table>
                  <thead><tr><th>When</th><th>Reason</th><th>Game</th><th>Elo</th></tr></thead>
                  <tbody>{profile.ratingHistory.map((event) => <tr key={event.id}>
                    <td><time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleString()}</time></td>
                    <td>{event.reason}</td><td>{event.gameId ?? '—'}</td>
                    <td>{event.previousRating}→{event.rating} ({event.delta >= 0 ? '+' : ''}{event.delta})</td>
                  </tr>)}</tbody>
                </table>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
