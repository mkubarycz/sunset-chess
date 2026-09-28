import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leaderboard } from './Leaderboard'

afterEach(() => vi.unstubAllGlobals())

describe('Leaderboard', () => {
  it('renders rankings and opens an accessible history profile that closes with Escape', async () => {
    const responses = [
      {
        leaderboard: [
          { rank: 1, id: 1001, name: 'Bob', currentRating: 716, gamesPlayed: 1, wins: 1, losses: 0, draws: 0, lastPlayedAt: '2026-01-02T12:00:00.000Z' },
          { rank: 2, id: 1000, name: 'Alice', currentRating: 684, gamesPlayed: 1, wins: 0, losses: 1, draws: 0, lastPlayedAt: '2026-01-02T12:00:00.000Z' },
        ],
      },
      {
        profile: {
          rank: 1, id: 1001, name: 'Bob', currentRating: 716,
          gamesPlayed: 1, wins: 1, losses: 0, draws: 0, lastPlayedAt: '2026-01-02T12:00:00.000Z',
          recentGames: [{
            id: 1, tableNumber: 1, opponent: { id: 1000, name: 'Alice' },
            color: 'white', result: '1-0', outcome: 'W',
            finishedAt: '2026-01-02T12:00:00.000Z',
            ratingBefore: 700, ratingAfter: 716, delta: 16,
          }],
          ratingHistory: [
            { id: 1, gameId: null, previousRating: 700, rating: 700, delta: 0, recordedAt: '2026-01-01T12:00:00.000Z', reason: 'baseline' },
            { id: 2, gameId: 1, previousRating: 700, rating: 716, delta: 16, recordedAt: '2026-01-02T12:00:00.000Z', reason: 'game' },
          ],
        },
      },
    ]
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(responses.shift()),
    })))
    render(<Leaderboard refreshKey={0} />)
    expect(await screen.findByRole('table', { name: 'Elo rankings' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Rank', 'Player', 'Elo', 'Record'])
    expect(screen.getByLabelText('Rank 1, gold')).toHaveClass('podium-1')
    expect(screen.getByLabelText('Rank 2, silver')).toHaveClass('podium-2')
    const bob = await screen.findByRole('button', { name: /Bob.*716 Elo.*1-0-0/i })
    expect(bob).toBeInTheDocument()
    fireEvent.click(bob)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.parentElement).toBe(document.body.lastElementChild)
    expect(dialog).toHaveAccessibleName('Bob')
    expect(screen.getAllByText(/700→716/)).toHaveLength(2)
    expect(screen.getByRole('img', { name: /Bob Elo history from 700 to 716/ })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(bob).toHaveFocus()
  })
})
