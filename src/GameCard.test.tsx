import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { GameCard, type OngoingGame } from './GameCard'
import type { LeaderboardEntry } from './PlayerCardDialog'
import { readFileSync } from 'node:fs'

const appCss = readFileSync('src/App.css', 'utf8')

const game: OngoingGame = {
  id: 9,
  tableNumber: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  result: null,
  blackPlayerId: 1111,
  whitePlayerId: 1222,
  blackPlayer: { id: 1111, name: 'Noir', rating: 700 },
  whitePlayer: { id: 1222, name: 'Blanca', rating: 700 },
}

const player = (id: number, name: string, currentRating = 700): LeaderboardEntry => ({
  rank: id,
  id,
  name,
  currentRating,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  lastPlayedAt: null,
})

const roster = [
  player(1111, 'Noir', 745),
  player(1222, 'Blanca', 730),
  ...Array.from({ length: 45 }, (_, index) => player(2000 + index, `Player ${index + 1}`, 700 + index)),
  player(3000, 'Zelda Knight', 812),
]

const waitingGame: OngoingGame = {
  ...game,
  blackPlayerId: null,
  blackPlayer: null,
}

function rosterResponse() {
  return new Response(JSON.stringify({ players: roster }), { status: 200 })
}

function mockGameResponse(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    input === '/api/players?gameId=9' ? rosterResponse()
      : new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (input === '/api/players?gameId=9') return rosterResponse()
    throw new Error(`Unexpected request: ${String(input)}`)
  })
})

async function openGameDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open details for Table 2' }))
}

async function openBlackSeat(user: ReturnType<typeof userEvent.setup>, players = roster, displayedGame = game) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
    JSON.stringify({ players }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
  render(<GameCard game={displayedGame} />)
  await openGameDetails(user)
  const input = screen.getByRole('combobox', { name: 'Black player' })
  await user.click(input)
  await screen.findByRole('option', { name: /^Zelda Knight 812/ })
  return input
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GameCard', () => {
  it('suggests the opposing session cohort and shows candidate-perspective all-time history', async () => {
    const players = [
      { ...player(1111, 'Noir'), cohort: 'A' as const },
      { ...player(1222, 'Blanca'), cohort: 'B' as const },
      { ...player(2000, 'Suggested Player'), cohort: 'B' as const, checkedIn: false,
        headToHead: [
          { opponentId: 1222, wins: 2, losses: 1, draws: 1, lastPlayedAt: '2026-10-01T12:00:00.000Z' },
        ] },
      { ...player(2001, 'Other Player'), cohort: 'D' as const,
        headToHead: [{ opponentId: 1222, wins: 0, losses: 0, draws: 0, lastPlayedAt: null }] },
      { ...player(2002, 'Other Event'), cohort: 'B' as const,
        assignedGame: { id: 10, tableNumber: 3, eventId: 99, startedAt: null } },
      { ...player(2003, 'Noir Cohort'), cohort: 'A' as const,
        headToHead: [{ opponentId: 1111, wins: 1, losses: 3, draws: 0, lastPlayedAt: null }] },
      { ...player(3000, 'Zelda Knight', 812), cohort: 'B' as const },
    ]
    const user = userEvent.setup()
    const input = await openBlackSeat(user, players, { ...game, eventId: 4 })
    const suggested = screen.getByRole('group', { name: 'Suggested players, Cohort B' })
    expect(within(suggested).getAllByRole('option')).toHaveLength(2)
    const candidate = within(suggested).getByRole('option', { name: /Suggested Player/ })
    expect(candidate.firstElementChild).toHaveTextContent(/^Suggested Player 700 \(vs\. Blanca 2-1-1\)$/)
    expect(candidate.querySelector('.player-rating')).toHaveTextContent(/^700$/)
    expect(candidate).not.toHaveTextContent('ELO')
    expect(candidate.querySelectorAll('.seat-player-context')).toHaveLength(1)
    expect(candidate).toHaveAttribute('title', 'Not checked in · Checks in when selected')
    expect(candidate.querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T12:00:00.000Z')
    expect(candidate).toHaveTextContent(`Last Played: ${new Date('2026-10-01T12:00:00.000Z').toLocaleDateString()}`)
    const other = screen.getByRole('group', { name: 'Other players' })
    expect(within(other).queryByRole('option', { name: /Suggested Player/ })).not.toBeInTheDocument()
    expect(within(other).getByRole('option', { name: /Other Player/ }))
      .toHaveTextContent('Other Player 700 (vs. Blanca 0-0-0)')
    expect(within(other).getByRole('option', { name: /Other Player/ })).toHaveTextContent('Last Played: Never')
    expect(within(other).getByRole('option', { name: /Other Event/ })).toHaveAttribute('aria-disabled', 'true')
    expect(within(suggested).queryByRole('option', { name: /Other Event/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^(Noir|Blanca) \d+/ })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Home' })
    expect(screen.getByRole('option', { name: 'Empty' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(candidate).toHaveAttribute('aria-selected', 'true')
    await user.clear(input)
    await user.type(input, 'sUgGeStEd')
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
    await user.click(screen.getByRole('combobox', { name: 'White player' }))
    const whiteSuggestions = screen.getByRole('group', { name: 'Suggested players, Cohort A' })
    expect(within(whiteSuggestions).getByRole('option', { name: /Noir Cohort/ }))
      .toHaveTextContent('Noir Cohort 700 (vs. Noir 1-3-0)')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { startedAt: null, opponent: { id: 4000, name: 'Jackson' }, text: 'Playing Jackson · not started' },
    { startedAt: '2026-10-18T16:00:00.000Z', opponent: { id: 4000, name: 'Jackson' }, text: 'Playing Jackson · started 10 minutes ago' },
    { startedAt: '2026-10-18T16:09:00.000Z', opponent: { id: 4000, name: 'Jackson' }, text: 'Playing Jackson · started 1 minute ago' },
    { startedAt: '2026-10-18T16:09:45.000Z', opponent: { id: 4000, name: 'Jackson' }, text: 'Playing Jackson · started just now' },
    { startedAt: null, opponent: null, text: 'Playing at Table 3 · not started' },
  ])('shows the current opponent and start time beside Last Played: $text', async ({ startedAt, opponent, text }) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T16:10:00.000Z'))
    const players = roster.map((entry) => ({
      ...entry,
      headToHead: [{ opponentId: 1222, wins: 0, losses: 0, draws: 0, lastPlayedAt: null }],
      lastResult: { opponentId: 5000, opponentName: 'Previous Opponent', outcome: 'loss' as const,
        finishedAt: '2026-10-17T12:00:00.000Z' },
      assignedGame: entry.id === 3000 ? { id: 10, tableNumber: 3, eventId: null, startedAt, opponent } : null,
    }))
    await openBlackSeat(userEvent.setup(), players)
    const option = screen.getByRole('option', { name: /^Zelda Knight/ })
    expect(option.querySelector('.seat-player-context')).toHaveTextContent(`Last Played: Never · ${text}`)
    expect(option).not.toHaveTextContent('Last Result:')
    const style = document.createElement('style')
    style.textContent = appCss
    document.head.append(style)
    try {
      expect(getComputedStyle(option.querySelector('.seat-player-summary')!).alignItems).toBe('center')
      expect(getComputedStyle(option.querySelector('.player-rating')!).fontSize).toBe('0.72em')
    } finally {
      style.remove()
    }
  })

  it.each([
    { outcome: 'win' as const, text: 'Won against Jackson' },
    { outcome: 'loss' as const, text: 'Lost to Jackson' },
    { outcome: 'draw' as const, text: 'Drew with Jackson' },
    { outcome: null, text: 'No completed games' },
  ])('shows the latest result for an unseated candidate: $text', async ({ outcome, text }) => {
    const players = roster.map((entry) => ({
      ...entry, assignedGame: null,
      headToHead: [{ opponentId: 1222, wins: 0, losses: 0, draws: 0, lastPlayedAt: null }],
      lastResult: outcome === null ? null : { opponentId: 4000, opponentName: 'Jackson', outcome,
        finishedAt: '2026-10-17T12:00:00.000Z' },
    }))
    await openBlackSeat(userEvent.setup(), players)
    expect(screen.getByRole('option', { name: /^Zelda Knight/ }).querySelector('.seat-player-context'))
      .toHaveTextContent(`Last Played: Never · Last Result: ${text}`)
  })

  it('shows activity without an opposing player selected', async () => {
    const players = roster.map((entry) => ({
      ...entry, assignedGame: null, lastResult: {
        opponentId: 4000, opponentName: 'Jackson', outcome: 'loss' as const,
        finishedAt: '2026-10-17T12:00:00.000Z',
      },
    }))
    await openBlackSeat(userEvent.setup(), players, { ...game, whitePlayerId: null, whitePlayer: null })
    const option = screen.getByRole('option', { name: /^Zelda Knight/ })
    expect(option).toHaveTextContent('Last Result: Lost to Jackson')
    expect(option).not.toHaveTextContent('Last Played:')
  })

  it.each([
    { ...game, eventId: 4, whitePlayerId: null, whitePlayer: null },
    { ...game, eventId: null },
  ])('does not suggest cohorts without a session and an opposing player ($eventId, $whitePlayerId)', async (displayedGame) => {
    const user = userEvent.setup()
    const players = roster.map((entry) => ({ ...entry, cohort: 'B' as const }))
    await openBlackSeat(user, players, displayedGame)
    expect(screen.queryByRole('group', { name: /Suggested players/ })).not.toBeInTheDocument()
  })

  it('reloads suggestion and head-to-head context when the opposite seated player changes', async () => {
    const players = roster.map((entry) => ({
      ...entry, cohort: entry.id === 1222 ? 'A' as const : 'B' as const,
      headToHead: [{ opponentId: 1222, wins: 0, losses: 0, draws: 0, lastPlayedAt: null }],
    }))
    const updatedPlayers = [...players, { ...player(1333, 'New Opponent'), cohort: 'B' as const, headToHead: [] }]
      .map((entry) => ({ ...entry, headToHead: [
        ...entry.headToHead,
        { opponentId: 1333, wins: 3, losses: 0, draws: 1, lastPlayedAt: '2026-10-02T12:00:00.000Z' },
      ] }))
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ players }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ players: updatedPlayers }), { status: 200 }))
    const user = userEvent.setup()
    const view = render(<GameCard game={{ ...game, eventId: 4 }} />)
    await openGameDetails(user)
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    expect(await screen.findByRole('group', { name: 'Suggested players, Cohort A' })).toBeVisible()
    view.rerender(<GameCard game={{ ...game, eventId: 4, whitePlayerId: 1333,
      whitePlayer: { id: 1333, name: 'New Opponent', rating: 700 } }} />)
    const suggested = await screen.findByRole('group', { name: 'Suggested players, Cohort B' })
    expect(within(suggested).getByRole('option', { name: /^Zelda Knight/ }))
      .toHaveTextContent('Zelda Knight 812 (vs. New Opponent 3-0-1)')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('assigns a suggested player with the keyboard through the existing seat endpoint', async () => {
    const players = roster.map((entry) => ({ ...entry, cohort: 'B' as const }))
    const user = userEvent.setup()
    const input = await openBlackSeat(user, players, { ...game, eventId: 4 })
    const fetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ game: { ...game, blackPlayerId: 2000 } }), { status: 200 },
    ))
    fireEvent.keyDown(input, { key: 'Home' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ playerId: 2000 }),
    })))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Player 1 is now in the Black spot'))
  })

  it('floats player options below the input without putting them in the table layout', async () => {
    const style = document.createElement('style')
    style.textContent = appCss
    document.head.append(style)
    try {
      const user = userEvent.setup()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 200, top: 200, bottom: 244, left: 100, right: 360,
        width: 260, height: 44, toJSON: () => ({}),
      })
      const input = await openBlackSeat(user)
      const options = screen.getByRole('listbox', { name: 'Black player options' })
      expect(input.parentElement).toContainElement(options)
      expect(getComputedStyle(input.parentElement!).position).toBe('relative')
      const optionStyle = getComputedStyle(options)
      expect(optionStyle.position).toBe('fixed')
      expect(optionStyle.top).toBe('248px')
      expect(optionStyle.left).toBe('100px')
      expect(optionStyle.width).toBe('260px')
      expect(optionStyle.maxHeight).toBe('340px')
      expect(Number(optionStyle.zIndex)).toBeGreaterThan(0)
      expect(optionStyle.overflowY).toBe('auto')
      expect(screen.getByRole('group', { name: 'Declare game result' })).toBeVisible()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeVisible()
    } finally {
      style.remove()
    }
  })

  it('reanchors options on scroll and opens above a field near the viewport bottom', async () => {
    const user = userEvent.setup()
    let top = 200
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 100, y: top, top, bottom: top + 44, left: 100, right: 360,
      width: 260, height: 44, toJSON: () => ({}),
    }))
    await openBlackSeat(user)
    const options = screen.getByRole('listbox', { name: 'Black player options' })
    top = 160
    fireEvent.scroll(screen.getByRole('dialog'))
    expect(options.style.top).toBe('208px')
    top = window.innerHeight - 70
    fireEvent.resize(window)
    expect(options.style.top).toBe('auto')
    expect(options.style.bottom).toBe('74px')
    expect(options.style.maxHeight).toBe('340px')
    await user.keyboard('{Escape}')
    const calls = rect.mock.calls.length
    fireEvent.resize(window)
    expect(rect.mock.calls).toHaveLength(calls)
  })

  it('keeps the dropdown within a narrow visual viewport as the mobile keyboard opens', async () => {
    const viewport = Object.assign(new EventTarget(), {
      width: 320, height: 360, offsetTop: 40, offsetLeft: 0,
    })
    vi.stubGlobal('visualViewport', viewport)
    try {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 290, y: 160, top: 160, bottom: 204, left: 290, right: 690,
        width: 400, height: 44, toJSON: () => ({}),
      })
      const user = userEvent.setup()
      await openBlackSeat(user)
      const options = screen.getByRole('listbox', { name: 'Black player options' })
      expect(options.style.left).toBe('8px')
      expect(options.style.width).toBe('304px')
      expect(options.style.top).toBe('208px')
      expect(options.style.maxHeight).toBe('184px')
      act(() => {
        viewport.height = 200
        viewport.dispatchEvent(new Event('resize'))
      })
      expect(options.style.top).toBe('auto')
      expect(options.style.bottom).toBe(`${window.innerHeight - 156}px`)
      expect(options.style.maxHeight).toBe('108px')
      await user.keyboard('{Escape}')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('puts seat and result controls above a left audit panel and compact right-hand card', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} />)
    await openGameDetails(user)
    const dialog = screen.getByRole('dialog')
    const editors = dialog.querySelector('.game-detail-seat-editors')!
    const results = screen.getByRole('group', { name: 'Declare game result' })
    const overview = dialog.querySelector('.game-detail-overview')!
    const audit = dialog.querySelector('.game-detail-audit')!
    const summary = dialog.querySelector('.game-detail-summary')!
    expect(editors.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(results.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(overview.firstElementChild).toBe(audit)
    expect(overview.lastElementChild).toBe(summary)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    expect(audit).toContainElement(status)
    expect(status).toHaveValue('ongoing')
    expect(within(status).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Paired', 'Playing', 'Cancelled'])
    expect(screen.queryByRole('button', { name: 'Start Game' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Game' })).not.toBeInTheDocument()
    expect(dialog.querySelector('.game-detail-actions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close game details' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers Paired and cancellation from Playing without duplicate actions', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{ ...game, startedAt: '2026-10-18T16:00:00.000Z' }} />)
    await openGameDetails(user)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    expect(status).toHaveValue('started')
    expect(within(status).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Paired', 'Playing', 'Cancelled'])
    expect(screen.queryByRole('button', { name: 'Start Game' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Game' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('.game-detail-actions')).toBeNull()
  })

  it('starts a fully seated game from the status dropdown and displays a lock beside the table number', async () => {
    const user = userEvent.setup()
    const started = { ...game, startedAt: '2026-10-18T16:00:00.000Z' }
    const onMutate = vi.fn()
    const fetch = mockGameResponse({ game: started })
    const view = render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'started')
    expect(fetch).toHaveBeenCalledWith('/api/games/9/start', { method: 'POST' })
    await waitFor(() => expect(onMutate).toHaveBeenCalledWith(started))
    view.rerender(<GameCard game={started} onMutate={onMutate} />)
    const lock = screen.getByRole('img', { name: 'Locked: game has started' })
    expect(lock.parentElement).toHaveClass('game-table-badge')
    expect(lock.parentElement).toHaveTextContent('Table 2')
    expect(screen.getByRole('article').querySelector('.game-started-badge')).toBeNull()
    await openGameDetails(user)
    expect(screen.getByRole('combobox', { name: 'Game status' })).toHaveValue('started')
    expect(screen.getAllByRole('option', { name: 'Playing' })).toHaveLength(1)
  })

  it('returns Playing to Paired and removes the lock without changing the players', async () => {
    const user = userEvent.setup()
    const fetch = mockGameResponse({ game: { ...game, startedAt: null } })
    const onMutate = vi.fn((updated: OngoingGame): void => {
      view.rerender(<GameCard game={updated} onMutate={onMutate} />)
    })
    const view = render(<GameCard game={{ ...game, startedAt: '2026-10-18T16:00:00.000Z' }} onMutate={onMutate} />)
    await openGameDetails(user)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    expect(within(status).queryByRole('option', { name: 'Completed' })).not.toBeInTheDocument()
    await user.selectOptions(status, 'ongoing')
    expect(fetch).toHaveBeenCalledWith('/api/games/9/start', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ start: false }),
    }))
    await waitFor(() => expect(onMutate).toHaveBeenCalledWith({ ...game, startedAt: null }))
    expect(screen.queryByRole('img', { name: 'Locked: game has started' })).not.toBeInTheDocument()
    await openGameDetails(user)
    const paired = screen.getByRole('combobox', { name: 'Game status' })
    expect(paired).toHaveValue('ongoing')
    expect(within(paired).getByRole('option', { selected: true })).toHaveTextContent('Paired')
    expect(screen.getByRole('combobox', { name: 'Black player' })).toHaveValue('Noir (700 Elo)')
    expect(screen.getByRole('combobox', { name: 'White player' })).toHaveValue('Blanca (700 Elo)')
  })

  it('keeps Playing and reports failure if a return to Paired is rejected', async () => {
    const user = userEvent.setup()
    mockGameResponse({ error: 'A completed game cannot return to Paired.' }, 409)
    render(<GameCard game={{ ...game, startedAt: '2026-10-18T16:00:00.000Z' }} />)
    await openGameDetails(user)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    await user.selectOptions(status, 'ongoing')
    expect(await screen.findByRole('alert')).toHaveTextContent('A completed game cannot return to Paired.')
    expect(status).toHaveValue('started')
    expect(status).toBeEnabled()
  })

  it.each(['1-0', '0-1', '1/2-1/2'] as const)('shows Completed only after a recorded result (%s)', async (result) => {
    const user = userEvent.setup()
    render(<GameCard game={{ ...game, result, finishedAt: '2026-10-18T17:00:00.000Z' }} />)
    await openGameDetails(user)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    expect(within(status).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Completed', 'Cancelled'])
    expect(within(status).getByRole('option', { selected: true })).toHaveTextContent('Completed')
    expect(screen.getByText('Result')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Black Wins' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'White Wins' })).not.toBeInTheDocument()
  })

  it('switches both players in one request and keeps the rich summaries current', async () => {
    const user = userEvent.setup()
    const switched = { ...game, blackPlayerId: 1222, whitePlayerId: 1111,
      blackPlayer: game.whitePlayer, whitePlayer: game.blackPlayer }
    const fetch = mockGameResponse({ game: switched })
    const onMutate = vi.fn((updated: OngoingGame): void => {
      view.rerender(<GameCard game={updated} onMutate={onMutate} />)
    })
    const view = render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    const button = screen.getByRole('button', { name: 'Switch white and black players' })
    const editors = button.parentElement!
    expect(editors.children[0]).toHaveTextContent('Black player')
    expect(editors.children[1]).toBe(button)
    expect(editors.children[2]).toHaveTextContent('White player')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(button).toHaveAttribute('title', 'Switch white and black players')
    const style = document.createElement('style')
    style.textContent = appCss
    document.head.append(style)
    try {
      for (const label of editors.querySelectorAll('label')) {
        expect(getComputedStyle(label).textAlign).toBe('center')
      }
    } finally {
      style.remove()
    }
    await user.click(button)
    expect(fetch).toHaveBeenCalledWith('/api/games/9/switch-sides', expect.objectContaining({
      method: 'POST', body: '{}',
    }))
    await waitFor(() => expect(onMutate).toHaveBeenCalledWith(switched))
    expect(screen.getByRole('combobox', { name: 'Black player' })).toHaveValue('Blanca (700 Elo)')
    expect(screen.getByRole('combobox', { name: 'White player' })).toHaveValue('Noir (700 Elo)')
    expect(screen.getByRole('combobox', { name: 'Black player' }).parentElement?.querySelector('.seat-player-display'))
      .toHaveTextContent(/Blanca.*Playing Noir/)
    expect(screen.getByRole('status')).toHaveTextContent('White and black players switched.')
  })

  it.each([false, true])('requires confirmation to switch a Started game, including a stale view (%s)', async (alreadyStarted) => {
    const user = userEvent.setup()
    const startedAt = '2026-10-18T16:00:00.000Z'
    const switched = { ...game, startedAt, blackPlayerId: 1222, whitePlayerId: 1111,
      blackPlayer: game.whitePlayer, whitePlayer: game.blackPlayer }
    const fetch = mockGameResponse({ game: switched })
    const onMutate = vi.fn()
    render(<GameCard game={{ ...game, startedAt: alreadyStarted ? startedAt : null }} onMutate={onMutate} />)
    await openGameDetails(user)
    if (!alreadyStarted) fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'This game has already started.', requiresStartedOverride: true,
    }), { status: 409 }))
    await user.click(screen.getByRole('button', { name: 'Switch white and black players' }))
    expect(await screen.findByRole('region', { name: 'Confirm Started game switch' })).toBeVisible()
    expect(onMutate).not.toHaveBeenCalled()
    if (alreadyStarted) expect(fetch).not.toHaveBeenCalledWith('/api/games/9/switch-sides', expect.anything())
    expect(screen.getByRole('combobox', { name: 'Black player' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'White Wins' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Game status' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Keep players unchanged' }))
    expect(screen.queryByRole('region', { name: 'Confirm Started game switch' })).not.toBeInTheDocument()
    expect(onMutate).not.toHaveBeenCalled()
    if (!alreadyStarted) fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'This game has already started.', requiresStartedOverride: true,
    }), { status: 409 }))
    await user.click(screen.getByRole('button', { name: 'Switch white and black players' }))
    await screen.findByRole('button', { name: 'Override and switch' })
    await user.click(screen.getByRole('button', { name: 'Override and switch' }))
    expect(fetch).toHaveBeenCalledWith('/api/games/9/switch-sides', expect.objectContaining({
      body: JSON.stringify({ overrideStarted: true }),
    }))
    await waitFor(() => expect(onMutate).toHaveBeenCalledWith(switched))
  })

  it('reports a failed switch without changing either player', async () => {
    const user = userEvent.setup()
    mockGameResponse({ error: 'The game can no longer switch sides.' }, 409)
    const onMutate = vi.fn()
    render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    await user.click(screen.getByRole('button', { name: 'Switch white and black players' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The game can no longer switch sides.')
    expect(onMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Black player' })).toHaveValue('Noir (700 Elo)')
    expect(screen.getByRole('button', { name: 'Switch white and black players' })).toBeEnabled()
  })

  it('disables switching when both seats are empty', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{ ...waitingGame, whitePlayerId: null, whitePlayer: null }} />)
    await openGameDetails(user)
    expect(screen.getByRole('button', { name: 'Switch white and black players' })).toBeDisabled()
  })

  it('keeps the current status and reports an unsuccessful status change', async () => {
    const user = userEvent.setup()
    const fetch = mockGameResponse({ error: 'The game can no longer be started.' }, 409)
    render(<GameCard game={game} />)
    await openGameDetails(user)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    await user.selectOptions(status, 'ongoing')
    expect(fetch).toHaveBeenCalledTimes(1)
    await user.selectOptions(status, 'started')
    expect(await screen.findByRole('alert')).toHaveTextContent('The game can no longer be started.')
    expect(status).toHaveValue('ongoing')
    expect(status).toBeEnabled()
  })

  it('disables the status dropdown while a change is being saved', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => {}))
    render(<GameCard game={game} />)
    await openGameDetails(user)
    const status = screen.getByRole('combobox', { name: 'Game status' })
    await user.selectOptions(status, 'started')
    expect(status).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Updating game')
  })

  it.each([null, '2026-10-18T16:00:00.000Z'])('keeps the recorded result when cancellation is declined ($0)', async (startedAt) => {
    const user = userEvent.setup()
    const fetch = mockGameResponse({ game })
    render(<GameCard game={{ ...game, startedAt, result: '1-0', finishedAt: '2026-10-18T17:00:00.000Z' }} />)
    await openGameDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'cancelled')
    expect(screen.getByRole('dialog', { name: 'Cancel Table 2?' })).toBeVisible()
    expect(fetch).not.toHaveBeenCalledWith('/api/games/9', expect.anything())
    await user.click(screen.getByRole('button', { name: 'Keep game' }))
    await openGameDetails(user)
    expect(screen.getByRole('combobox', { name: 'Game status' })).toHaveValue('finished')
    expect(fetch).not.toHaveBeenCalledWith('/api/games/9', expect.anything())
  })

  it.each([
    { ...game },
    { ...game, startedAt: '2026-10-18T16:00:00.000Z', result: '1-0' as const },
    { ...game, startedAt: '2026-10-18T16:00:00.000Z', cancelledAt: '2026-10-18T17:00:00.000Z' },
  ])('does not show a lock for an unstarted or resolved game ($result, $cancelledAt)', (displayedGame) => {
    render(<GameCard game={displayedGame} />)
    expect(screen.queryByRole('img', { name: 'Locked: game has started' })).not.toBeInTheDocument()
  })

  it.each(['source', 'destination'] as const)('requires explicit override for a Started %s and can leave games unchanged', async (affected) => {
    const user = userEvent.setup()
    const startedAt = '2026-10-18T16:00:00.000Z'
    const candidate = {
      ...player(1333, 'New Player', 712), checkedIn: false,
      assignedGame: { id: 10, tableNumber: 3, eventId: null, startedAt: affected === 'source' ? startedAt : null },
    }
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ players: [candidate] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: { ...game, blackPlayerId: 1333 } }), { status: 200 }))
    render(<GameCard game={{ ...game, startedAt: affected === 'destination' ? startedAt : null }} />)
    await openGameDetails(user)
    const input = screen.getByRole('combobox', { name: 'Black player' })
    await user.click(input)
    await user.click(await screen.findByRole('option', { name: /New Player/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('This game has already started')
    expect(screen.getByText(/Their seat at Table 3 will be left empty/)).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Keep games unchanged' }))
    expect(fetch).toHaveBeenCalledTimes(1)
    await user.click(input)
    await user.click(screen.getByRole('option', { name: /New Player/ }))
    await user.click(screen.getByRole('button', { name: 'Override and assign' }))
    expect(fetch).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      body: JSON.stringify({ playerId: 1333, overrideStarted: true }),
    }))
  })

  it('offers an unchecked player and assigns them without a separate automatic check-in request', async () => {
    const user = userEvent.setup()
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        players: [{ ...player(1333, 'New Player'), checkedIn: false, assignedGame: null }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: { ...game, blackPlayerId: 1333 } }), { status: 200 }))
    render(<GameCard game={waitingGame} />)
    await openGameDetails(user)
    expect(screen.queryByRole('option', { name: 'Playing' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    await user.click(await screen.findByRole('option', { name: /New Player.*Not checked in/ }))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      body: JSON.stringify({ playerId: 1333 }),
    }))
  })

  it('handles a game starting after roster load without silently overriding it', async () => {
    const user = userEvent.setup()
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ players: [player(1333, 'New Player')] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'This game has already started (Table 3).', requiresStartedOverride: true,
      }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: { ...game, blackPlayerId: 1333 } }), { status: 200 }))
    render(<GameCard game={game} />)
    await openGameDetails(user)
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    await user.click(await screen.findByRole('option', { name: /New Player/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already started')
    expect(fetch).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Override and assign' }))
    expect(fetch).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      body: JSON.stringify({ playerId: 1333, overrideStarted: true }),
    }))
  })

  it('applies the same Started confirmation when a player is selected by a qualified scan', async () => {
    const user = userEvent.setup()
    const candidate = {
      ...player(1333, 'Scanned Player'),
      assignedGame: { id: 10, tableNumber: 3, eventId: null, startedAt: '2026-10-18T16:00:00.000Z' },
    }
    const onSeatScanTargetChange = vi.fn()
    const onSeatScanFeedback = vi.fn()
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ players: [candidate] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ game: { ...game, blackPlayerId: 1333 } }), { status: 200 }))
    const view = render(<GameCard game={game} onSeatScanTargetChange={onSeatScanTargetChange}
      onSeatScanFeedback={onSeatScanFeedback} />)
    await openGameDetails(user)
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    await screen.findByRole('option', { name: /Scanned Player/ })
    view.rerender(<GameCard game={game} onSeatScanTargetChange={onSeatScanTargetChange}
      onSeatScanFeedback={onSeatScanFeedback} authoritativePlayerScan={{ playerId: 1333, token: 'scan-1' }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('already started')
    expect(onSeatScanTargetChange).toHaveBeenLastCalledWith(null)
    expect(fetch).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Override and assign' }))
    expect(fetch).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      body: JSON.stringify({ playerId: 1333, overrideStarted: true }),
    }))
    await waitFor(() => expect(onSeatScanFeedback).toHaveBeenLastCalledWith(expect.objectContaining({
      playerId: 1333, status: 'success',
    })))
  })

  it.each([
    game,
    waitingGame,
    { ...waitingGame, whitePlayerId: null, whitePlayer: null },
    { ...game, startedAt: '2026-10-18T16:00:00.000Z' },
  ])('immediately cancels without confirmation when no result is recorded ($startedAt, $blackPlayerId, $whitePlayerId)', async (displayedGame) => {
    const user = userEvent.setup()
    const fetch = mockGameResponse({ game })
    const onMutate = vi.fn()
    render(<GameCard game={displayedGame} onMutate={onMutate} />)
    await openGameDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'cancelled')
    expect(screen.queryByRole('dialog', { name: 'Cancel Table 2?' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/games/9', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ overrideStarted: true, unfinishedOnly: true }),
    }))
    expect(fetch.mock.calls.filter(([url]) => url === '/api/games/9')).toHaveLength(1)
    await waitFor(() => expect(onMutate).toHaveBeenCalledWith(game))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('disables status changes while immediate cancellation is pending', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} />)
    await openGameDetails(user)
    vi.mocked(globalThis.fetch).mockReturnValueOnce(new Promise<Response>(() => {}))
    const status = screen.getByRole('combobox', { name: 'Game status' })
    await user.selectOptions(status, 'cancelled')
    expect(status).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Updating game')
    expect(screen.queryByRole('dialog', { name: 'Cancel Table 2?' })).not.toBeInTheDocument()
  })

  it('reports cancellation failure and keeps the error visible if a result arrives meanwhile', async () => {
    const user = userEvent.setup()
    const message = 'A result has been recorded for this game. Review it before confirming cancellation.'
    mockGameResponse({ error: message }, 409)
    const onMutate = vi.fn()
    const view = render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'cancelled')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Game status' })).toHaveValue('ongoing')
    expect(screen.getByRole('combobox', { name: 'Game status' })).toBeEnabled()
    view.rerender(<GameCard game={{ ...game, result: '1-0', finishedAt: '2026-10-18T17:00:00.000Z' }} onMutate={onMutate} />)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'cancelled')
    expect(screen.getByRole('dialog', { name: 'Cancel Table 2?' })).toBeVisible()
  })

  it('accepts standard responsive CSS width and height values', () => {
    render(<GameCard game={game} width="clamp(150px, 30vw, 280px)" height="42vh" />)
    const card = screen.getByRole('article')
    expect(card).toHaveStyle({
      width: 'clamp(150px, 30vw, 280px)',
      height: '42vh',
    })
  })

  it('leaves dimensions unset for compact rail layout', () => {
    render(<GameCard game={game} />)
    const card = screen.getByRole('article')
    expect(card.style.width).toBe('')
    expect(card.style.height).toBe('')
  })

  it('opens read-only details for non-management thumbnails', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} management={false} />)

    await openGameDetails(user)

    expect(screen.getByRole('dialog', { name: 'Table 2 game details' })).toBeVisible()
    expect(screen.getByText('Paired')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Edit|Assign|Cancel game/ })).not.toBeInTheDocument()
  })

  it('renders authoritative signed deltas with neutral zero styling', () => {
    render(<GameCard game={{
      ...game,
      result: '1-0',
      finishedAt: '2026-01-01T01:00:00.000Z',
      blackRatingDelta: -12,
      whiteRatingDelta: 12,
    }} />)
    expect(screen.getByText('L -12')).toHaveClass('negative')
    expect(screen.getByText('W +12')).toHaveClass('positive')
    expect(screen.queryByText(/wins/i)).not.toBeInTheDocument()
    expect(screen.queryByText('1-0')).not.toBeInTheDocument()
    expect(screen.queryByText(/winner/i)).not.toBeInTheDocument()
    expect(screen.getByText('Table 2')).toHaveClass('game-table-badge')
    expect(screen.queryByText(/White player|Black player/)).not.toBeInTheDocument()
  })

  it('presents both players equally in green for a draw', () => {
    render(<GameCard game={{
      ...game,
      result: '1/2-1/2',
      finishedAt: '2026-01-01T01:00:00.000Z',
      blackRatingDelta: 2,
      whiteRatingDelta: -2,
    }} />)

    expect(screen.getByText('D +2')).toHaveClass('draw')
    expect(screen.getByText('D -2')).toHaveClass('draw')
    expect(screen.getByLabelText('Black player: Noir, rating 700')).toHaveClass('draw')
    expect(screen.getByLabelText('White player: Blanca, rating 700')).toHaveClass('draw')
  })

  it('displays each player rating from the beginning of the game', () => {
    render(<GameCard game={{
      ...game,
      result: '1-0',
      finishedAt: '2026-01-01T01:00:00.000Z',
      blackPlayer: { ...game.blackPlayer!, rating: 688 },
      whitePlayer: { ...game.whitePlayer!, rating: 712 },
      blackStartingRating: 700,
      whiteStartingRating: 700,
      blackRatingDelta: -12,
      whiteRatingDelta: 12,
    }} />)

    expect(screen.getAllByText('700')).toHaveLength(2)
    expect(screen.queryByText('688')).not.toBeInTheDocument()
    expect(screen.queryByText('712')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Black player: Noir, rating 700')).toBeVisible()
    expect(screen.getByLabelText('White player: Blanca, rating 700')).toBeVisible()
  })

  it('labels a finished draw as Draw in the detail status', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{
      ...game,
      result: '1/2-1/2',
      finishedAt: '2026-01-01T01:00:00.000Z',
    }} />)

    await openGameDetails(user)
    expect(screen.getByText('Draw')).toBeVisible()
    expect(screen.queryByText(/Finished ·|1\/2-1\/2/)).not.toBeInTheDocument()
  })

  it.each([
    ['1-0' as const, 'Blanca (730) DEF Noir (745)'],
    ['0-1' as const, 'Noir (745) DEF Blanca (730)'],
  ])('formats a %s result with winner, starting ratings, and loser', async (result, expected) => {
    const user = userEvent.setup()
    render(<GameCard game={{
      ...game,
      result,
      finishedAt: '2026-01-01T01:00:00.000Z',
      blackStartingRating: 745,
      whiteStartingRating: 730,
    }} />)

    await openGameDetails(user)
    expect(screen.getByText(expected)).toBeVisible()
  })

  it('shows cancelled audit details without a misleading delta or management menu', () => {
    render(<GameCard game={{
      ...game,
      result: '1/2-1/2',
      finishedAt: '2026-01-01T01:00:00.000Z',
      cancelledAt: '2026-01-02T01:00:00.000Z',
      blackRatingDelta: 0,
      whiteRatingDelta: 0,
    }} />)
    expect(screen.getByText('Table 2 - Cancelled')).toHaveClass('game-table-badge', 'cancelled')
    expect(screen.queryByText('Draw')).not.toBeInTheDocument()
    expect(screen.queryByText('1/2-1/2')).not.toBeInTheDocument()
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open details for Table 2' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Edit|Assign/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Cancelled 1/)).not.toBeInTheDocument()
  })

  it('hides cancellation management when a finished game is not eligible', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{
      ...game,
      result: '1-0',
      finishedAt: '2026-01-01T01:00:00.000Z',
      canCancel: false,
    }} />)

    await openGameDetails(user)
    expect(screen.queryByRole('combobox', { name: 'Game status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Game' })).not.toBeInTheDocument()
  })

  it('shows concise guidance for an eligible finished game', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{
      ...game,
      result: '1-0',
      finishedAt: '2026-01-01T01:00:00.000Z',
      canCancel: true,
    }} />)

    await openGameDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'cancelled')
    expect(screen.getByText(
      'Cancellation is allowed only if this is both players’ latest game. Click “Cancel Game” to proceed.',
    )).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel Game' })).toBeVisible()
  })

  it('shows prefilled inline seat fields in the first-level detail dialog', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} />)
    await openGameDetails(user)

    expect(screen.getByRole('dialog', { name: 'Table 2 game details' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Black player' })).toHaveValue('Noir (700 Elo)')
    expect(screen.getByRole('combobox', { name: 'White player' })).toHaveValue('Blanca (700 Elo)')
    expect(screen.queryByRole('button', { name: /Edit|Assign/ })).not.toBeInTheDocument()
  })

  it('shows reusable matchup summaries in both closed selectors before either field is activated', async () => {
    const user = userEvent.setup()
    const onSeatScanTargetChange = vi.fn()
    const players = roster.map((entry) => ({
      ...entry, headToHead: [
        { opponentId: 1222, wins: 2, losses: 1, draws: 0, lastPlayedAt: '2026-10-01T12:00:00.000Z' },
        { opponentId: 1111, wins: 1, losses: 2, draws: 0, lastPlayedAt: '2026-10-01T12:00:00.000Z' },
      ],
    }))
    const fetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ players }), { status: 200 },
    ))
    render(<GameCard game={game} onSeatScanTargetChange={onSeatScanTargetChange} />)
    await openGameDetails(user)
    const black = screen.getByRole('combobox', { name: 'Black player' })
    const white = screen.getByRole('combobox', { name: 'White player' })
    await waitFor(() => expect(black.parentElement?.querySelector('.seat-player-display'))
      .toHaveTextContent('Noir 745 (vs. Blanca 2-1-0)'))
    expect(white.parentElement?.querySelector('.seat-player-display'))
      .toHaveTextContent('Blanca 730 (vs. Noir 1-2-0)')
    expect(black).toHaveAccessibleDescription(/Last Played:.*Playing Blanca · not started/)
    expect(white).toHaveAccessibleDescription(/Last Played:.*Playing Noir · not started/)
    expect(black).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onSeatScanTargetChange).not.toHaveBeenCalled()
    await user.click(black)
    expect(black.parentElement?.querySelector('.seat-player-display')).toBeNull()
    expect(screen.getByRole('listbox', { name: 'Black player options' })).toBeVisible()
    await user.clear(black)
    await user.type(black, 'Zelda')
    await user.keyboard('{Escape}')
    expect(black.parentElement?.querySelector('.seat-player-display'))
      .toHaveTextContent('Noir 745 (vs. Blanca 2-1-0)')
    expect(black).toHaveValue('Noir (700 Elo)')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(black).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(47)
    await user.tab()
    expect(black.parentElement?.querySelector('.seat-player-display')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Switch white and black players' })).toHaveFocus()
    await user.tab()
    expect(white).toHaveFocus()
    await user.click(screen.getByRole('combobox', { name: 'Game status' }))
    expect(white.parentElement?.querySelector('.seat-player-display')).not.toBeNull()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports failure to load closed-selector metadata without inventing history', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'Player metadata unavailable.' }), { status: 503 },
    ))
    const user = userEvent.setup()
    render(<GameCard game={game} />)
    await openGameDetails(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Player metadata unavailable.')
    const display = screen.getByRole('combobox', { name: 'Black player' })
      .parentElement?.querySelector('.seat-player-display')
    expect(display).toHaveTextContent('Noir 700')
    expect(display).not.toHaveTextContent('Last Played:')
    expect(display).not.toHaveTextContent('0-0-0')
  })

  it('keeps the status dropdown available and closes with Escape without a footer link', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} />)

    await openGameDetails(user)
    expect(screen.getByRole('combobox', { name: 'Game status' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Table 2 game details' })).not.toBeInTheDocument()
  })

  it('offers result actions only when both ongoing-game seats are filled', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = mockGameResponse({
      game: { ...game, result: '0-1', finishedAt: '2026-01-01T01:00:00.000Z' },
    })
    render(<GameCard game={game} onMutate={onMutate} />)

    await openGameDetails(user)
    expect(screen.queryByText('Select a player field, then search for a player or scan their piece.'))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draw' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'White Wins' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Black Wins' }))

    expect(fetchSpy).toHaveBeenCalledWith('/api/games/9/result', {
      method: 'PATCH',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ result: '0-1' }),
    })
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ result: '0-1' }))
  })

  it('hides result actions until both players are selected', async () => {
    const user = userEvent.setup()
    render(<GameCard game={waitingGame} />)

    await openGameDetails(user)
    expect(screen.queryByRole('group', { name: 'Declare game result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Draw' })).not.toBeInTheDocument()
  })

  it('shows an empty inline field for a waiting seat', async () => {
    const user = userEvent.setup()
    render(<GameCard game={waitingGame} />)
    await openGameDetails(user)
    expect(screen.getByRole('combobox', { name: 'Black player' })).toHaveValue('')
  })

  it('loads options on opening details and excludes unavailable occupants on field activation', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)

    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(screen.getByRole('listbox', { name: 'Black player options' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Zelda Knight 812' })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Noir|Blanca/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Empty' })).toBeVisible()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/players?gameId=9', expect.objectContaining({
      headers: { accept: 'application/json' },
    }))
  })

  it('reloads player history after closing and reopening the table popup', async () => {
    const user = userEvent.setup()
    await openBlackSeat(user)
    const updated = roster.map((entry) => entry.id === 3000 ? {
      ...entry,
      headToHead: [{ opponentId: 1222, wins: 1, losses: 0, draws: 0, lastPlayedAt: '2026-10-18T12:00:00.000Z' }],
    } : entry)
    const fetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ players: updated }), { status: 200 },
    ))
    await user.click(screen.getByRole('button', { name: 'Close game details' }))
    await openGameDetails(user)
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    const option = await screen.findByRole('option', { name: /^Zelda Knight 812/ })
    expect(option.querySelector('.seat-player-summary')).toHaveTextContent(/^Zelda Knight 812 \(vs\. Blanca 1-0-0\)$/)
    expect(option.querySelector('time')).toHaveAttribute('dateTime', '2026-10-18T12:00:00.000Z')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('immediately replaces a seat after selecting a search result', async () => {
    const user = userEvent.setup()
    const updatedGame = { ...game, blackPlayerId: 3000,
      blackPlayer: { id: 3000, name: 'Zelda Knight', rating: 812 } }
    const onMutate = vi.fn((updated: OngoingGame): void => {
      view.rerender(<GameCard game={updated} onMutate={onMutate} />)
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ players: roster }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ game: updatedGame }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    const view = render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    const input = screen.getByRole('combobox', { name: 'Black player' })
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'zelda')
    await user.click(await screen.findByRole('option', { name: 'Zelda Knight 812' }))

    expect(fetchSpy).toHaveBeenCalledWith('/api/games/9/seats/black', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ playerId: 3000 }),
    }))
    await waitFor(() => expect(onMutate).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent(
      'Zelda Knight is now in the Black spot on Table 2.',
    )
    expect(input.parentElement?.querySelector('.seat-player-display')).toHaveTextContent('Zelda Knight 812')
    expect(input).toHaveValue('Zelda Knight (812 Elo)')
  })

  it('immediately empties an occupied seat', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn((updated: OngoingGame): void => {
      view.rerender(<GameCard game={updated} onMutate={onMutate} />)
    })
    const view = render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    const input = screen.getByRole('combobox', { name: 'Black player' })
    await user.click(input)
    await screen.findByRole('option', { name: 'Empty' })
    const fetchSpy = vi.mocked(globalThis.fetch)
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ game: { ...game, blackPlayerId: null, blackPlayer: null } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await user.click(screen.getByRole('option', { name: 'Empty' }))
    expect(fetchSpy).toHaveBeenCalledWith('/api/games/9/seats/black', expect.objectContaining({
      body: JSON.stringify({ playerId: null }),
    }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Black spot on Table 2 is now empty.',
    ))
    expect(input).toHaveValue('')
    expect(input.parentElement?.querySelector('.seat-player-display')).toBeNull()
  })

  it('assigns a zone-qualified scanned player to the active field', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const onSeatScanTargetChange = vi.fn()
    const onSeatScanFeedback = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ players: roster }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ game: { ...game, blackPlayerId: 3000 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    const view = render(<GameCard
      game={game}
      onMutate={onMutate}
      onSeatScanTargetChange={onSeatScanTargetChange}
      onSeatScanFeedback={onSeatScanFeedback}
    />)
    await openGameDetails(user)
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())
    expect(onSeatScanTargetChange).toHaveBeenLastCalledWith({
      gameId: 9,
      tableNumber: 2,
      side: 'black',
    })

    view.rerender(<GameCard game={game} onMutate={onMutate}
      authoritativePlayerScan={{ playerId: 3000, token: 'zelda-1' }}
      onSeatScanTargetChange={onSeatScanTargetChange}
      onSeatScanFeedback={onSeatScanFeedback} />)

    await waitFor(() => expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/games/9/seats/black',
      expect.objectContaining({ body: JSON.stringify({ playerId: 3000 }) }),
    ))
    expect(onSeatScanFeedback).toHaveBeenLastCalledWith(expect.objectContaining({
      playerId: 3000,
      playerName: 'Zelda Knight',
      side: 'black',
      status: 'success',
      message: 'Zelda Knight checked into the Black spot on Table 2.',
    }))
    expect(screen.queryByText('Zelda Knight is now in the Black spot on Table 2.'))
      .not.toBeInTheDocument()
  })

  it('rejects a scanned occupant in the active seat', async () => {
    const user = userEvent.setup()
    const onSeatScanFeedback = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ players: roster }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const view = render(<GameCard game={game} onSeatScanFeedback={onSeatScanFeedback} />)
    await openGameDetails(user)
    await user.click(screen.getByRole('combobox', { name: 'Black player' }))
    await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())

    view.rerender(<GameCard game={game}
      authoritativePlayerScan={{ playerId: 1111, token: 'current-1' }}
      onSeatScanFeedback={onSeatScanFeedback} />)
    await waitFor(() => expect(onSeatScanFeedback).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 1111,
      playerName: 'Noir',
      status: 'error',
      message: 'Noir is already in this seat and cannot be selected.',
    })))
    expect(screen.queryByText('Noir is already in this seat and cannot be selected.'))
      .not.toBeInTheDocument()
  })

  it('filters inline options case-insensitively and closes the list before the dialog', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)
    await user.clear(input)
    await user.type(input, 'zELDa')
    expect(within(screen.getByRole('listbox', { name: 'Black player options' })).getAllByRole('option'))
      .toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not offer seat fields for a finished game', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{ ...game, result: '1-0', finishedAt: '2026-01-01T01:00:00.000Z' }} />)
    await openGameDetails(user)
    expect(screen.queryByRole('combobox', { name: 'Black player' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'White player' })).not.toBeInTheDocument()
  })

  it('preserves confirmation before cancelling a recorded result', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = mockGameResponse({ game })
    render(<GameCard game={{ ...game, result: '1-0', finishedAt: '2026-10-18T17:00:00.000Z' }} onMutate={onMutate} />)
    await openGameDetails(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Game status' }), 'cancelled')
    expect(screen.getByRole('dialog', { name: 'Cancel Table 2?' })).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/games/9', expect.anything())
    await user.click(screen.getByRole('button', { name: 'Cancel Game' }))
    expect(fetchSpy).toHaveBeenCalledWith('/api/games/9', expect.objectContaining({ method: 'DELETE' }))
    expect(onMutate).toHaveBeenCalled()
  })

  it('scrolls the active option into view while navigating', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const user = userEvent.setup()
    const input = await openBlackSeat(user)
    fireEvent.keyDown(input, { key: 'End' })
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
