import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leaderboard } from './Leaderboard'

afterEach(() => vi.unstubAllGlobals())

describe('Leaderboard', () => {
  it('shows colored saved cohorts in a column without grouping players or restoring ranks', async () => {
    const players = [
      { id: 1000, rank: 1, name: 'Dora', currentRating: 900, cohort: 'D' },
      { id: 1001, rank: 2, name: 'Bea', currentRating: 880, cohort: 'B' },
      { id: 1002, rank: 3, name: 'Alex', currentRating: 850, cohort: 'A' },
      { id: 1003, rank: 4, name: 'Chris', currentRating: 800, cohort: 'C' },
      { id: 1004, rank: 5, name: 'Avery', currentRating: 750, cohort: 'A' },
      { id: 1005, rank: 6, name: 'Unknown', currentRating: 700, cohort: null },
    ].map((entry) => ({
      ...entry, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, lastPlayedAt: null,
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ leaderboard: players }),
    }))
    render(<Leaderboard refreshKey={0} eventId={4} />)
    const table = await screen.findByRole('table', { name: 'Session standings' })
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Cohort', 'Player', 'Elo', 'Record', 'Session Record'])
    expect(table.querySelectorAll('tbody')).toHaveLength(1)
    expect(table.querySelector('.leaderboard-cohort-heading')).toBeNull()
    expect(within(table).queryByRole('rowheader')).not.toBeInTheDocument()
    expect(within(table).getAllByRole('button', { name: /Open player card for/ })
      .map((button) => button.textContent)).toEqual(players.map((player) => player.name))
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(players.length)
    for (const [index, player] of players.entries()) {
      const cell = within(rows[index]).getAllByRole('cell')[0]
      const badge = within(cell).getByLabelText(player.cohort ? `Cohort ${player.cohort}` : 'No cohort assigned')
      expect(badge).toHaveTextContent(player.cohort ?? '-')
      expect(badge).toHaveClass('leaderboard-cohort', `cohort-${player.cohort ?? 'unassigned'}`)
    }
    expect(table.querySelector('.leaderboard-rank, .podium, [class*="rank-"]')).toBeNull()
    expect(table.querySelector('[aria-label*="rank "]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Alex, cohort A, 850 Elo, 0-0-0 record' })).toBeInTheDocument()
    expect(screen.getByText(/Automatic pairing only matches players within the same cohort/)).toBeVisible()
    const style = document.createElement('style')
    style.textContent = readFileSync('src/App.css', 'utf8')
    document.head.append(style)
    try {
      const colors = ['A', 'B', 'C', 'D'].map((cohort) =>
        getComputedStyle(screen.getAllByLabelText(`Cohort ${cohort}`)[0]).color)
      expect(colors.every((color) => color !== '' && color !== 'rgba(0, 0, 0, 0)')).toBe(true)
      expect(new Set(colors).size).toBe(4)
      expect(new Set(screen.getAllByLabelText('Cohort A').map((badge) => getComputedStyle(badge).color)).size)
        .toBe(1)
    } finally {
      style.remove()
    }
  })

  it('asks for explicit consent before moving a waiting player involving a Started table', async () => {
    const onMoveWaitingPlayer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ leaderboard: [{
        rank: 1, id: 1000, name: 'Alice', currentRating: 700,
        gamesPlayed: 0, wins: 0, losses: 0, draws: 0, lastPlayedAt: null,
        checkInStatus: 'waiting', tableNumber: 1,
      }] }),
    }))
    render(<Leaderboard refreshKey={0} onMoveWaitingPlayer={onMoveWaitingPlayer} waitingGames={[
      { id: 1, tableNumber: 1, createdAt: '2026-10-18T16:00:00.000Z',
        startedAt: '2026-10-18T16:01:00.000Z', blackPlayerId: 1000, whitePlayerId: null,
        blackPlayer: { id: 1000, name: 'Alice', rating: 700 }, whitePlayer: null,
        finishedAt: null, result: null },
      { id: 2, tableNumber: 2, createdAt: '2026-10-18T16:00:00.000Z',
        blackPlayerId: 1001, whitePlayerId: null, blackPlayer: { id: 1001, name: 'Bob', rating: 700 },
        whitePlayer: null, finishedAt: null, result: null },
    ]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move To...' }))
    fireEvent.click(screen.getByRole('button', { name: 'Table 2 — waiting for Bob' }))
    expect(screen.getByRole('alert')).toHaveTextContent('already started')
    expect(onMoveWaitingPlayer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep games unchanged' }))
    fireEvent.click(screen.getByRole('button', { name: 'Table 2 — waiting for Bob' }))
    fireEvent.click(screen.getByRole('button', { name: 'Override and move' }))
    await waitFor(() => expect(onMoveWaitingPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1000 }), 2, true,
    ))
  })

  it('refreshes an open player card without resetting history scrolling, focus, or a name draft', async () => {
    const player = {
      rank: 1, id: 1001, name: 'Bob', currentRating: 716,
      gamesPlayed: 10, wins: 10, losses: 0, draws: 0, lastPlayedAt: null,
    }
    const recentGames = Array.from({ length: 10 }, (_, index) => ({
      id: 10 - index, tableNumber: index + 1,
      opponent: { id: 1000, name: 'Alice', rating: 684, delta: -16 },
      color: 'white', result: '1-0', outcome: 'W',
      finishedAt: '2026-01-02T12:00:00.000Z',
      ratingBefore: 700, ratingAfter: 716, delta: 16,
    }))
    let rating = 716
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.includes('/profile')
        ? { profile: { ...player, currentRating: rating, ongoingGames: [], recentGames, ratingHistory: [] } }
        : { leaderboard: [{ ...player, currentRating: rating }] }),
    }))
    vi.stubGlobal('fetch', fetch)
    const view = render(<Leaderboard refreshKey={0} eventId={4} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open player card for Bob' }))
    const strip = await screen.findByRole('region', { name: 'Recent games for Bob' })
    const dialog = screen.getByRole('dialog')
    const name = screen.getByRole('textbox', { name: 'Player name' })
    await waitFor(() => expect(name).toHaveFocus())
    strip.focus()
    fireEvent.change(name, { target: { value: 'Bobby' } })
    strip.scrollLeft = 735
    dialog.scrollTop = 220
    const oldestGame = within(strip).getByRole('article', { name: /Table 10:/ })

    for (const refreshKey of [1, 2]) {
      rating += 1
      view.rerender(<Leaderboard refreshKey={refreshKey} eventId={4} />)
      await waitFor(() => expect(dialog.querySelector('.profile-summary')).toHaveTextContent(`${rating} Elo`))
      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(screen.getByRole('region', { name: 'Recent games for Bob' })).toBe(strip)
      expect(strip.scrollLeft).toBe(735)
      expect(dialog.scrollTop).toBe(220)
      expect(strip).toHaveFocus()
      expect(name).toHaveValue('Bobby')
      expect(within(strip).getByRole('article', { name: /Table 10:/ })).toBe(oldestGame)
      expect(fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'PATCH' }))
    }
  })

  it('renders rankings and opens an accessible history profile that closes with Escape', async () => {
    const onAddPlayer = vi.fn()
    const onScanCode = vi.fn()
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
    render(<Leaderboard refreshKey={0} onAddPlayer={onAddPlayer} onScanCode={onScanCode} />)
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
    fireEvent.click(screen.getByRole('button', { name: 'Scan Code' }))
    await waitFor(() => expect(onScanCode).toHaveBeenCalledWith(expect.objectContaining({
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
            cohort: 'A',
            gamesPlayed: 3, wins: 2, losses: 1, draws: 0, lastPlayedAt: null,
            checkInStatus: 'not-checked-in', tableNumber: null, opponentName: null,
            sessionGamesPlayed: 1, sessionWins: 1, sessionLosses: 0, sessionDraws: 0,
          },
          {
            rank: 2, id: 1001, name: 'Bob', currentRating: 700,
            cohort: 'A',
            gamesPlayed: 2, wins: 1, losses: 1, draws: 0, lastPlayedAt: null,
            checkInStatus: 'waiting', tableNumber: 10, opponentName: null,
            sessionGamesPlayed: 0, sessionWins: 0, sessionLosses: 0, sessionDraws: 0,
          },
          {
            rank: 3, id: 1002, name: 'Carol', currentRating: 680,
            cohort: 'B',
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
      .toEqual(['Cohort', 'Player', 'Elo', 'Record', 'Session Record'])
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
