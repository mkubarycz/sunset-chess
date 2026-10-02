import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leaderboard } from './Leaderboard'

afterEach(() => vi.unstubAllGlobals())

describe('Leaderboard', () => {
  it('renders rankings and opens an accessible history profile that closes with Escape', async () => {
    const onAddPlayer = vi.fn()
    const printSticker = vi.fn().mockResolvedValue(undefined)
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
    render(<Leaderboard refreshKey={0} onAddPlayer={onAddPlayer} printSticker={printSticker} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add player' }))
    expect(onAddPlayer).toHaveBeenCalledOnce()
    expect(await screen.findByRole('table', { name: 'Elo rankings' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Rank', 'Player', 'Elo', 'Record'])
    expect(screen.getByLabelText('Rank 1, gold')).toHaveClass('podium-1')
    expect(screen.getByLabelText('Rank 2, silver')).toHaveClass('podium-2')
    const bobName = await screen.findByRole('button', { name: 'Open player card for Bob' })
    expect(bobName).toHaveClass('leaderboard-player-name')
    fireEvent.click(bobName)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.parentElement).toBe(document.body.lastElementChild)
    expect(dialog).toHaveAccessibleName('Player card for Bob')
    expect(dialog).toHaveClass('player-edit-dialog')
    expect(screen.getByLabelText('Player name')).toHaveValue('Bob')
    expect(dialog.querySelector('.profile-summary')).toHaveTextContent(
      '716 Elo · Class Rank 1st · All Time Record 1-0-0 (1 Games)',
    )
    expect(screen.queryByRole('heading', { name: /Edit Bob/ })).not.toBeInTheDocument()
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
    expect(screen.getByRole('table', { name: 'Elo history for Bob' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Print sticker' }))
    await waitFor(() => expect(printSticker).toHaveBeenCalledWith(expect.objectContaining({
      id: 1001,
      name: 'Bob',
    })))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(bobName).toHaveFocus())
  })

  it('shows authoritative readiness, checks in available players, and adds session records', async () => {
    const onCheckIn = vi.fn().mockResolvedValue(undefined)
    const onOpenGame = vi.fn()
    const onMoveWaitingPlayer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        leaderboard: [
          {
            rank: 1, id: 1000, name: 'Alice', currentRating: 720,
            gamesPlayed: 3, wins: 2, losses: 1, draws: 0, lastPlayedAt: null,
            checkInStatus: 'not-checked-in', tableNumber: null, opponentName: null,
            sessionGamesPlayed: 1, sessionWins: 1, sessionLosses: 0, sessionDraws: 0,
          },
          {
            rank: 2, id: 1001, name: 'Bob', currentRating: 700,
            gamesPlayed: 2, wins: 1, losses: 1, draws: 0, lastPlayedAt: null,
            checkInStatus: 'waiting', tableNumber: 10, opponentName: null,
            sessionGamesPlayed: 0, sessionWins: 0, sessionLosses: 0, sessionDraws: 0,
          },
          {
            rank: 3, id: 1002, name: 'Carol', currentRating: 680,
            gamesPlayed: 4, wins: 1, losses: 2, draws: 1, lastPlayedAt: null,
            checkInStatus: 'playing', tableNumber: 4, opponentName: 'Dana',
            sessionGamesPlayed: 2, sessionWins: 0, sessionLosses: 1, sessionDraws: 1,
          },
        ],
      }),
    }))

    render(<Leaderboard refreshKey={0} eventId={4} onCheckIn={onCheckIn}
      onOpenGame={onOpenGame}
      onMoveWaitingPlayer={onMoveWaitingPlayer}
      waitingGames={[
        {
          id: 10, tableNumber: 10, createdAt: '2026-10-02T12:00:00.000Z',
          blackPlayerId: null, whitePlayerId: 1001, finishedAt: null, result: null,
          eventId: 4, blackPlayer: null, whitePlayer: { id: 1001, name: 'Bob', rating: 700 },
        },
        {
          id: 11, tableNumber: 11, createdAt: '2026-10-02T12:01:00.000Z',
          blackPlayerId: 1003, whitePlayerId: null, finishedAt: null, result: null,
          eventId: 4, blackPlayer: { id: 1003, name: 'Dana', rating: 690 }, whitePlayer: null,
        },
      ]} />)

    expect(await screen.findByText('Not checked in')).toBeVisible()
    expect(screen.getByText('Waiting at', { exact: false })).toBeVisible()
    expect(screen.getByText('Playing Dana on', { exact: false })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open Table 10 game details' }))
    expect(onOpenGame).toHaveBeenCalledWith(expect.objectContaining({ id: 1001, name: 'Bob' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Table 4 game details' }))
    expect(onOpenGame).toHaveBeenCalledWith(expect.objectContaining({ id: 1002, name: 'Carol' }))
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Rank', 'Player', 'Elo', 'Record', 'Session Record'])
    expect(screen.getByText('1-0-0')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Check in Alice' }))
    await waitFor(() => expect(onCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1000, name: 'Alice' }),
    ))
    expect(screen.queryByRole('button', { name: 'Check in Bob' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check in Carol' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move To...' }))
    const moveDialog = screen.getByRole('dialog', { name: 'Move Bob to another table' })
    expect(within(moveDialog).getByText('Table 10 will close.', { exact: false })).toBeVisible()
    fireEvent.click(within(moveDialog).getByRole('button', {
      name: 'Table 11 — waiting for Dana',
    }))
    await waitFor(() => expect(onMoveWaitingPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1001, name: 'Bob' }),
      11,
    ))
    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'Move Bob to another table',
    })).not.toBeInTheDocument())
  })
})
