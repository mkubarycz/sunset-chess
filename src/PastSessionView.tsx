import { useEffect, useState } from 'react'
import { GameCard, type OngoingGame } from './GameCard'
import { Leaderboard } from './Leaderboard'
import type { ClubSession } from './SessionCard'
import { SessionHeader } from './SessionHeader'

export function PastSessionView({ session, onDelete }: { session: ClubSession; onDelete: () => Promise<void> }) {
  const [games, setGames] = useState<OngoingGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/sessions/${session.id}/games`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
        const body = await response.json() as { games?: OngoingGame[]; error?: string }
        if (!response.ok || !Array.isArray(body.games)) {
          throw new Error(body.error || 'Could not load session results.')
        }
        if (!controller.signal.aborted) setGames(body.games)
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load session results.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [session.id, retry])

  return (
    <section className="past-session-view" aria-label={`Past club session: ${session.name}`}>
      <SessionHeader session={session} onDelete={onDelete} />
      <div className="workspace-with-games">
        <Leaderboard key={session.id} refreshKey={retry} variant="rail" eventId={session.id}
          title="Session Standings" readOnly />
        <section className="recent-games-tab" aria-label="Session results" aria-busy={loading}>
          <h2>Session Results</h2>
          {loading && <p role="status">Loading session results...</p>}
          {error && <p role="alert" className="games-message error">{error}</p>}
          {error && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry session results</button>}
          {!loading && !error && games.length === 0 && <p>No games were recorded for this session.</p>}
          {!loading && !error && <div className="games-list">
            {games.map((game) => <GameCard key={game.id} game={game} management={false}
              className={` finished-game${game.result === '1/2-1/2' ? ' drawn-game' : ''}`} />)}
          </div>}
        </section>
      </div>
    </section>
  )
}
