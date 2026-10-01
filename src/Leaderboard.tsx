import { useCallback, useEffect, useRef, useState } from 'react'
import { PlayerCardDialog, type LeaderboardEntry } from './PlayerCardDialog'

export function Leaderboard({ refreshKey, variant = 'default', onAddPlayer, printSticker }: {
  refreshKey: number
  variant?: 'default' | 'rail'
  onAddPlayer?: () => void
  printSticker?: (player: LeaderboardEntry) => Promise<void>
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!signal?.aborted) setLoading(true)
    try {
      const response = await fetch('/api/leaderboard', { signal, headers: { accept: 'application/json' } })
      const body = await response.json() as { leaderboard?: LeaderboardEntry[]; error?: string }
      if (!response.ok || !body.leaderboard) throw new Error(body.error || 'Could not load leaderboard.')
      setEntries(body.leaderboard)
      setError('')
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Could not load leaderboard.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => refresh(controller.signal))
    return () => controller.abort()
  }, [refresh, refreshKey])

  const close = () => {
    setSelected(null)
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  return (
    <>
      <section className={`leaderboard leaderboard-${variant}`} aria-labelledby="leaderboard-heading" aria-busy={loading}>
        <div className="section-heading leaderboard-heading">
          <div>
            <p className="eyebrow">Ratings</p>
            <h2 id="leaderboard-heading">Elo Leaderboard</h2>
            <p className="leaderboard-intro">Current club standings</p>
          </div>
          {onAddPlayer && <button type="button" onClick={onAddPlayer}>Add player</button>}
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
                      setSelected(entry)
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
      {selected && <PlayerCardDialog key={selected.id} player={selected} onClose={close}
        onMutate={() => refresh()} printSticker={printSticker} />}
    </>
  )
}
