import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PastSessionView } from './PastSessionView'
import type { ClubSession } from './SessionCard'
import type { OngoingGame } from './GameCard'

const session: ClubSession = {
  id: 2, type: 'club-session', name: 'October Club Night',
  createdAt: '2026-10-02T13:00:00.000Z', closedAt: '2026-10-02T15:00:00.000Z',
  active: false, playerCount: 2, gameCount: 25, activeGameCount: 0,
  pairingMode: 'club-session-pairing-1',
}
const game: OngoingGame = {
  id: 1, tableNumber: 1, eventId: 2, createdAt: session.createdAt,
  finishedAt: session.closedAt, result: '1-0',
  blackPlayerId: 1000, whitePlayerId: 1001,
  blackPlayer: { id: 1000, name: 'Alice', rating: 690 },
  whitePlayer: { id: 1001, name: 'Bob', rating: 710 },
  blackStartingRating: 700, whiteStartingRating: 700,
  blackRatingDelta: -10, whiteRatingDelta: 10, canCancel: true,
}
const entry = {
  id: 1000, name: 'Alice', rank: 1, cohort: 'A', currentRating: 690,
  gamesPlayed: 25, wins: 0, losses: 25, draws: 0,
  sessionGamesPlayed: 25, sessionWins: 0, sessionLosses: 25, sessionDraws: 0,
}

describe('PastSessionView', () => {
  it('loads scoped standings and all recorded results, with read-only game details', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new Response(JSON.stringify(String(input).includes('/leaderboard')
        ? { leaderboard: [entry] }
        : { games: Array.from({ length: 25 }, (_, index) => ({
          ...game, id: index + 1, tableNumber: index + 1,
        })) })))
    render(<PastSessionView session={session} onDelete={vi.fn()} />)
    expect(await screen.findByRole('table', { name: 'Session standings' })).toHaveTextContent('Alice')
    expect(fetch).toHaveBeenCalledWith('/api/leaderboard?eventId=2', expect.any(Object))
    expect(fetch).toHaveBeenCalledWith('/api/sessions/2/games', expect.any(Object))
    const results = screen.getByRole('region', { name: 'Session results' })
    expect(await within(results).findByText('Table 25')).toBeVisible()
    expect(within(results).getAllByRole('article')[0]).toHaveClass('game-card', 'finished-game')
    expect(within(results).getAllByText('W +10')).toHaveLength(25)
    expect(within(screen.getByRole('table')).getAllByRole('group', { name: '0 wins, 0 draws, 25 losses' }))
      .toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument()
    await userEvent.click(within(results).getByRole('button', { name: 'Open details for Table 25' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Bob (700) DEF Alice (700)')
    expect(within(dialog).queryByRole('button', { name: /Cancel game/i })).not.toBeInTheDocument()
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })

  it('distinguishes an empty session from failed loading and allows retry', async () => {
    let fail = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/leaderboard')) return new Response(JSON.stringify({ leaderboard: [] }))
      if (fail) return new Response(JSON.stringify({ error: 'Results offline' }), { status: 503 })
      return new Response(JSON.stringify({ games: [] }))
    })
    render(<PastSessionView session={session} onDelete={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Results offline')
    expect(screen.queryByText('No games were recorded for this session.')).not.toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry session results' }))
    expect(await screen.findByText('No games were recorded for this session.')).toBeVisible()
  })
})
