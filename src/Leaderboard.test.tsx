import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leaderboard } from './Leaderboard'

afterEach(() => vi.unstubAllGlobals())

describe('Leaderboard', () => {
  it.each([undefined, 4])('shows W/D/L records without game counts (session=%s)', async (eventId) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ leaderboard: [{
        id: 1000, rank: 1, name: 'Alice', currentRating: 720,
        gamesPlayed: 8, wins: 5, draws: 1, losses: 2, lastPlayedAt: null,
        sessionGamesPlayed: 9, sessionWins: 2, sessionDraws: 3, sessionLosses: 4,
      }] }),
    }))
    render(<Leaderboard refreshKey={0} eventId={eventId} />)
    const table = await screen.findByRole('table')
    const record = within(table).getByRole('group', { name: '5 wins, 1 draw, 2 losses' })
    expect(record).toHaveTextContent(/^5W 1D 2L$/)
    expect(record.querySelector('.standing-record-wins')).toHaveTextContent('5W')
    expect(record.querySelector('.standing-record-draws')).toHaveTextContent('1D')
    expect(record.querySelector('.standing-record-losses')).toHaveTextContent('2L')
    expect(table.querySelectorAll('.leaderboard-record small, .leaderboard-session-record small')).toHaveLength(0)
    expect(within(table).queryByText('8g')).not.toBeInTheDocument()
    expect(within(table).queryByText('9g')).not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: /record: 5 wins, 1 draw, 2 losses/ })).toBeInTheDocument()
    if (eventId !== undefined) {
      expect(within(table).getByRole('group', { name: '2 wins, 3 draws, 4 losses' }))
        .toHaveTextContent(/^2W 3D 4L$/)
    }
  })

  it('keeps record colors above 4.5:1 contrast on normal and highlighted dark surfaces', () => {
    const css = readFileSync('src/App.css', 'utf8')
    const color = (name: string) => {
      const value = css.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1]
      if (!value) throw new Error(`Missing theme color ${name}`)
      return value
    }
    const luminance = (hex: string) => {
      const linear = [1, 3, 5].map((offset) => {
        const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const highlighted = css.match(/\.leaderboard-row:hover\s*\{[^}]*background:\s*(#[\da-f]{6})/i)?.[1]
    if (!highlighted) throw new Error('Missing highlighted leaderboard row background')
    for (const [outcome, variable] of [['wins', 'success'], ['draws', 'muted'], ['losses', 'error']]) {
      expect(css).toMatch(new RegExp(`\\.standing-record-${outcome}\\s*\\{[^}]*color:\\s*var\\(--${variable}\\)`))
      for (const background of [color('ink-950'), color('ink-900'), color('ink-850'), color('ink-800'), highlighted]) {
        const foregroundLuminance = luminance(color(variable))
        const backgroundLuminance = luminance(background)
        const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        expect(ratio, `${outcome} against ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

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
    expect(screen.getByRole('button', { name: 'Alex, cohort A, 850 Elo, record: 0 wins, 0 draws, 0 losses' })).toBeInTheDocument()
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
    expect(screen.getByRole('group', { name: '1 win, 0 draws, 0 losses' })).toHaveTextContent('1W 0D 0L')
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
describe('session attendance controls', () => {
  const entries = [
    { rank: 1, id: 1000, name: 'Alice', currentRating: 700, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      lastPlayedAt: null, checkInStatus: 'available', tableNumber: null, cohort: 'A' },
    { rank: 2, id: 1001, name: 'Bob', currentRating: 700, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      lastPlayedAt: null, checkInStatus: 'waiting', tableNumber: 2, cohort: 'A' },
    { rank: 3, id: 1002, name: 'Carol', currentRating: 700, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      lastPlayedAt: null, checkInStatus: 'checked-out', tableNumber: null, cohort: 'A' },
    { rank: 4, id: 1003, name: 'Dana', currentRating: 700, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      lastPlayedAt: null, checkInStatus: 'paired', tableNumber: 3, cohort: 'A', opponentName: 'Eve' },
    { rank: 5, id: 1004, name: 'Eve', currentRating: 700, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      lastPlayedAt: null, checkInStatus: 'playing', tableNumber: 4, cohort: 'A', opponentName: 'Frank' },
  ]

  it('keeps check-in and checkout controls off the main leaderboard even if handlers are supplied', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leaderboard: entries }) }))
    render(<Leaderboard refreshKey={0} onCheckIn={vi.fn()} onCheckOut={vi.fn()} />)
    await screen.findByRole('table', { name: 'Elo rankings' })
    expect(screen.queryByRole('button', { name: /^Check (in|out) / })).not.toBeInTheDocument()
  })

  it('shows session availability, checkout, blocked-game explanations, and explicit re-check-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leaderboard: entries }) }))
    const onCheckOut = vi.fn().mockResolvedValue(undefined)
    const onCheckIn = vi.fn().mockResolvedValue(undefined)
    render(<Leaderboard refreshKey={0} eventId={4} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />)
    const checkout = await screen.findByRole('button', { name: 'Check out Alice' })
    expect(screen.getByText('Checked in · Available for pairing')).toBeVisible()
    expect(screen.getByText('Checked out · Unavailable')).toBeVisible()
    expect(checkout).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Check out Bob' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Check out Dana' })).toBeEnabled()
    expect(screen.getByText('Paired with Eve on table 3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Check out Eve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check out Eve' }))
      .toHaveAttribute('title', 'Finish or cancel Table 4 before checking out.')
    fireEvent.click(checkout)
    await waitFor(() => expect(onCheckOut).toHaveBeenCalledWith(expect.objectContaining({ id: 1000 })))
    fireEvent.click(screen.getByRole('button', { name: 'Check out Dana' }))
    await waitFor(() => expect(onCheckOut).toHaveBeenCalledWith(expect.objectContaining({ id: 1003 })))
    fireEvent.click(screen.getByRole('button', { name: 'Check in Carol' }))
    await waitFor(() => expect(onCheckIn).toHaveBeenCalledWith(expect.objectContaining({ id: 1002 })))
    expect(screen.queryByRole('button', { name: 'Check in Alice' })).not.toBeInTheDocument()
  })

  it('reports checkout failures without hiding the player or pretending checkout succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leaderboard: entries }) }))
    render(<Leaderboard refreshKey={0} eventId={4}
      onCheckOut={vi.fn().mockRejectedValue(new Error('Finish or cancel the current game.'))} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Check out Alice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish or cancel the current game.')
    expect(screen.getByRole('button', { name: 'Check out Alice' })).toBeEnabled()
    expect(screen.getByText('Checked in · Available for pairing')).toBeVisible()
  })

  it('keeps historical attendance read-only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leaderboard: entries }) }))
    render(<Leaderboard refreshKey={0} eventId={4} readOnly onCheckIn={vi.fn()} onCheckOut={vi.fn()} />)
    await screen.findByRole('table', { name: 'Session standings' })
    expect(screen.queryByRole('button', { name: /^Check (in|out) / })).not.toBeInTheDocument()
  })
})
