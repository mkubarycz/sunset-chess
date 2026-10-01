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
          ongoingGames: [{
            id: 2, tableNumber: 3, createdAt: '2026-01-03T12:00:00.000Z',
            blackPlayerId: 1001, whitePlayerId: null, finishedAt: null, result: null,
            blackPlayer: { id: 1001, name: 'Bob', rating: 716 }, whitePlayer: null,
          }],
          recentGames: [{
            id: 1, tableNumber: 1, opponent: { id: 1000, name: 'Alice', rating: 684, delta: -16 },
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
    expect(dialog).toHaveAccessibleName('Edit Bob')
    expect(dialog).toHaveClass('player-edit-dialog')
    expect(screen.getByLabelText('Player name')).toHaveValue('Bob')
    const ongoingGames = screen.getByRole('region', { name: 'Ongoing games for Bob' })
    expect(ongoingGames.querySelectorAll('.game-card')).toHaveLength(1)
    expect(screen.getByRole('article', {
      name: 'Table 3: Bob plays black, waiting for White',
    })).toBeVisible()
    const recentGames = screen.getByRole('region', { name: 'Recent games for Bob' })
    expect(recentGames.querySelectorAll('.game-card')).toHaveLength(1)
    expect(screen.getByRole('article', {
      name: 'Table 1: Alice plays black, Bob plays white',
    })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Bob Elo history from 700 to 716' })).toBeVisible()
    expect(screen.getByRole('table', { name: 'Elo history for Bob' })).toBeVisible()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(bob).toHaveFocus()
  })
})
