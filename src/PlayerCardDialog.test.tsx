import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerCardDialog, type PlayerProfile } from './PlayerCardDialog'
import type { OngoingGame } from './GameCard'

afterEach(() => vi.unstubAllGlobals())

const profile: PlayerProfile = {
  id: 1000, name: 'Alice', rank: 1, currentRating: 716,
  wins: 1, losses: 0, draws: 0, gamesPlayed: 1, lastPlayedAt: '2026-01-02T12:00:00.000Z',
  ongoingGames: [],
  recentGames: [{
    id: 9, tableNumber: 2, opponent: { id: 1001, name: 'Bob', rating: 684, delta: -16 },
    color: 'white', result: '1-0', outcome: 'W',
    finishedAt: '2026-01-02T12:00:00.000Z', ratingBefore: 700, ratingAfter: 716, delta: 16,
  }],
  ratingHistory: [
    { id: 1, gameId: null, previousRating: 700, rating: 700, delta: 0,
      recordedAt: '2026-01-01T12:00:00.000Z', reason: 'baseline', opponentName: null,
      opponentRatingBefore: null, opponentDelta: null, outcome: null },
    { id: 2, gameId: 9, previousRating: 700, rating: 716, delta: 16,
      recordedAt: '2026-01-02T12:00:00.000Z', reason: 'game', opponentName: 'Bob',
      opponentRatingBefore: 700, opponentDelta: -16, outcome: 'win' },
  ],
}

const game: OngoingGame = {
  id: 9, tableNumber: 2, createdAt: '2026-01-01T15:30:00.000Z',
  startedAt: '2026-01-01T15:40:00.000Z', finishedAt: '2026-01-02T12:00:00.000Z',
  result: '1-0', cancelledAt: null, cancellationReason: null, canCancel: false,
  blackPlayerId: 1001, whitePlayerId: 1000,
  blackPlayer: { id: 1001, name: 'Bob', rating: 684 },
  whitePlayer: { id: 1000, name: 'Alice', rating: 716 },
  blackStartingRating: 700, whiteStartingRating: 700, blackRatingDelta: -16, whiteRatingDelta: 16,
}

function stubRequests(currentProfile = profile, gameResponse = new Response(JSON.stringify({ game }))) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    if (input === '/api/players/1000/profile?recentLimit=10') {
      return new Response(JSON.stringify({ profile: currentProfile }))
    }
    if (input === '/api/games/9') return gameResponse
    if (input === '/api/players?gameId=9') return new Response(JSON.stringify({ players: [] }))
    throw new Error(`Unexpected request: ${String(input)}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function expectGameHandoff() {
  const details = await screen.findByRole('dialog', { name: 'Table 2 game details' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.queryByRole('dialog', { name: 'Player card for Alice' })).not.toBeInTheDocument()
  expect(details.querySelector(`time[datetime="${game.createdAt}"]`)).toBeInTheDocument()
  expect(details.querySelector(`time[datetime="${game.startedAt}"]`)).toBeInTheDocument()
  expect(within(details).queryByRole('option', { name: 'Cancelled' })).not.toBeInTheDocument()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  return details
}

describe('PlayerCardDialog game history', () => {
  it('labels outcomes and opponents from history, including draws with nonzero Elo changes and older games', async () => {
    stubRequests({
      ...profile,
      ratingHistory: [
        ...profile.ratingHistory,
        { ...profile.ratingHistory[1], id: 3, gameId: 10, opponentName: 'Joey Fatone', outcome: 'loss', delta: -16 },
        { ...profile.ratingHistory[1], id: 4, gameId: 11, opponentName: 'Justin Timberlake', outcome: 'draw', delta: 1 },
        { ...profile.ratingHistory[1], id: 5, gameId: 12, opponentName: 'Chris', outcome: 'draw', delta: -1 },
        { ...profile.ratingHistory[1], id: 6, reason: 'compensation', delta: -16 },
        { ...profile.ratingHistory[0], id: 7, reason: 'migration' },
      ],
    })
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    const table = await screen.findByRole('table', { name: 'Elo history for Alice' })
    for (const reason of ['Win v Bob', 'Loss v Joey Fatone', 'Draw v Justin Timberlake',
      'Draw v Chris', 'Cancelled game v. Bob', 'Starting rating', 'Imported rating']) {
      expect(within(table).getByText(reason)).toBeInTheDocument()
    }
    expect(within(table).getAllByRole('button')).toHaveLength(5)
    expect(within(table).getByRole('button', { name: /Open game 10 from/ })).toBeVisible()
  })

  it.each([
    { outcome: 'win', ownDelta: 16, opponentDelta: -16, label: 'Win', change: '-16', color: 'negative' },
    { outcome: 'loss', ownDelta: -16, opponentDelta: 16, label: 'Loss', change: '+16', color: 'positive' },
    { outcome: 'draw', ownDelta: 1, opponentDelta: -1, label: 'Draw', change: '-1', color: 'negative' },
    { outcome: 'draw', ownDelta: -1, opponentDelta: 1, label: 'Draw', change: '+1', color: 'positive' },
    { outcome: 'draw', ownDelta: 0, opponentDelta: 0, label: 'Draw', change: '0', color: null },
  ] as const)('shows the opponent pre-game Elo and their signed change for $label ($change)', async (example) => {
    stubRequests({ ...profile, ratingHistory: [{
      ...profile.ratingHistory[1], opponentRatingBefore: 812, opponentDelta: example.opponentDelta,
      delta: example.ownDelta, outcome: example.outcome,
    }] })
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    const reason = (await screen.findByText(`${example.label} v Bob`)).closest('td')!
    expect(reason).toHaveTextContent(`${example.label} v Bob812${example.change}`)
    const rating = within(reason).getByLabelText("Bob's pre-game Elo: 812")
    expect(rating).toHaveTextContent('812')
    expect(rating).toHaveClass('rating-opponent-elo')
    const delta = within(reason).getByLabelText(`Bob's Elo change: ${example.change}`)
    expect(delta).toHaveTextContent(example.change)
    if (example.color) expect(delta).toHaveClass(example.color)
    else expect(delta).not.toHaveClass('positive', 'negative')
  })

  it('explicitly marks unavailable opponent Elo instead of substituting a current rating or zero', async () => {
    stubRequests({ ...profile, ratingHistory: [{
      ...profile.ratingHistory[1], opponentRatingBefore: null, opponentDelta: null,
    }] })
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    expect(await screen.findByText('Opponent Elo unavailable')).toBeVisible()
    expect(screen.queryByLabelText(/Bob's pre-game Elo/)).not.toBeInTheDocument()
  })

  it.each(['history date', 'recent game'])('replaces the player card with authoritative game details from a %s', async (target) => {
    const fetch = stubRequests()
    const onClose = vi.fn()
    render(<PlayerCardDialog player={profile} onClose={onClose} onMutate={vi.fn()} />)
    await screen.findByText('Win v Bob')
    await userEvent.click(screen.getByRole('button', {
      name: target === 'history date' ? /Open game 9 from/ : 'Open details for Table 2',
    }))
    await expectGameHandoff()
    expect(fetch).toHaveBeenCalledWith('/api/games/9', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    await userEvent.click(screen.getByRole('button', { name: 'Close game details' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens ongoing games without stacking dialogs', async () => {
    const currentGame = { ...game, result: null, finishedAt: null, canCancel: true }
    stubRequests({ ...profile, ongoingGames: [currentGame] },
      new Response(JSON.stringify({ game: currentGame })))
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    const ongoing = await screen.findByRole('region', { name: 'Ongoing games for Alice' })
    await userEvent.click(within(ongoing).getByRole('button', { name: 'Open details for Table 2' }))
    expect(await screen.findByRole('dialog', { name: 'Table 2 game details' })).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('opens older and cancelled games from history without relying on the recent games strip', async () => {
    stubRequests({ ...profile, recentGames: [], ratingHistory: [
      { ...profile.ratingHistory[1], reason: 'compensation' },
    ] }, new Response(JSON.stringify({ game: {
      ...game, cancelledAt: '2026-01-03T12:00:00.000Z', cancellationReason: 'Incorrect result',
    } })))
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Open game 9 from/ }))
    const details = await screen.findByRole('dialog', { name: 'Table 2 game details' })
    expect(within(details).getByText('Incorrect result')).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it.each([404, 500])('keeps the player card open and reports a failed game lookup (%s)', async (status) => {
    stubRequests(profile, new Response(JSON.stringify({ error: 'Game unavailable.' }), { status }))
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Open game 9 from/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Game unavailable.')
    expect(screen.getByRole('dialog', { name: 'Player card for Alice' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Open game 9 from/ })).toBeEnabled()
  })

  it('saves a pending player-name edit before requesting game details', async () => {
    const fetch = stubRequests()
    let releaseSave!: () => void
    let saved = false
    const save = new Promise<void>((resolve) => { releaseSave = resolve })
    fetch.mockImplementation(async (input) => {
      if (input === '/api/players/1000') {
        await save
        saved = true
        return new Response(JSON.stringify({ player: { ...profile, name: 'Alice Smith' } }))
      }
      if (input === '/api/players/1000/profile?recentLimit=10') {
        return new Response(JSON.stringify({ profile: { ...profile, name: saved ? 'Alice Smith' : 'Alice' } }))
      }
      if (input === '/api/games/9') return new Response(JSON.stringify({ game }))
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    await screen.findByText('Win v Bob')
    fireEvent.change(screen.getByRole('textbox', { name: 'Player name' }), { target: { value: 'Alice Smith' } })
    await userEvent.click(screen.getByRole('button', { name: /Open game 9 from/ }))
    expect(fetch.mock.calls.some(([url]) => url === '/api/games/9')).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Player name' })).toBeDisabled()
    await act(async () => { releaseSave(); await save })
    await expectGameHandoff()
    const calls = fetch.mock.calls.map(([url]) => url)
    expect(calls.indexOf('/api/players/1000')).toBeLessThan(calls.indexOf('/api/games/9'))
  })

  it('does not open a game if the player-name save fails', async () => {
    const fetch = stubRequests()
    fetch.mockImplementation(async (input) => {
      if (input === '/api/players/1000') return new Response(JSON.stringify({ error: 'Name save failed.' }), { status: 500 })
      if (input === '/api/players/1000/profile?recentLimit=10') return new Response(JSON.stringify({ profile }))
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    await screen.findByText('Win v Bob')
    fireEvent.change(screen.getByRole('textbox', { name: 'Player name' }), { target: { value: 'Alice Smith' } })
    await userEvent.click(screen.getByRole('button', { name: /Open game 9 from/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name save failed.')
    expect(fetch.mock.calls.some(([url]) => url === '/api/games/9')).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Player card for Alice' })).toBeVisible()
  })

  it('aborts a pending game request when the player card closes', async () => {
    const fetch = stubRequests()
    let signal: AbortSignal | undefined
    fetch.mockImplementation(async (input, init) => {
      if (input === '/api/games/9') {
        signal = init?.signal ?? undefined
        return new Promise<Response>(() => {})
      }
      return new Response(JSON.stringify({ profile }))
    })
    const { unmount } = render(<PlayerCardDialog player={profile} onClose={vi.fn()} onMutate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Open game 9 from/ }))
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
