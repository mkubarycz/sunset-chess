import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { GameCard, type OngoingGame } from './GameCard'
import type { LeaderboardEntry } from './PlayerCardDialog'

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

async function openGameDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open details for Table 2' }))
}

async function openBlackSeat(user: ReturnType<typeof userEvent.setup>, players = roster) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
    JSON.stringify({ players }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
  render(<GameCard game={game} />)
  await openGameDetails(user)
  const input = screen.getByRole('combobox', { name: 'Black player' })
  await user.click(input)
  await screen.findByRole('option', { name: 'Zelda Knight (812 Elo)' })
  return input
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GameCard', () => {
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
    expect(screen.getByText('Ongoing')).toBeVisible()
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
    await user.click(screen.getByRole('button', { name: 'Cancel Game' }))
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

  it('centers secondary detail actions and closes from the footer link', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} />)

    await openGameDetails(user)
    expect(screen.getByRole('button', { name: 'Cancel Game' })).toHaveClass('game-detail-action', 'cancel')
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveClass('game-detail-action', 'close')
    await user.click(close)
    expect(screen.queryByRole('dialog', { name: 'Table 2 game details' })).not.toBeInTheDocument()
  })

  it('offers result actions only when both ongoing-game seats are filled', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ game: { ...game, result: '0-1', finishedAt: '2026-01-01T01:00:00.000Z' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    render(<GameCard game={game} onMutate={onMutate} />)

    await openGameDetails(user)
    expect(screen.queryByText('Select a player field, then search for a player or scan their piece.'))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draw' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Declare White Winner' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Declare Black Winner' }))

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

  it('loads searchable options on field activation and excludes unavailable occupants', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)

    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(screen.getByRole('listbox', { name: 'Black player options' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Zelda Knight (812 Elo)' })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Noir|Blanca/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Empty' })).toBeVisible()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/players?gameId=9', expect.objectContaining({
      headers: { accept: 'application/json' },
    }))
  })

  it('immediately replaces a seat after selecting a search result', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ players: roster }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ game: { ...game, blackPlayerId: 3000 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    const input = screen.getByRole('combobox', { name: 'Black player' })
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'zelda')
    await user.click(await screen.findByRole('option', { name: 'Zelda Knight (812 Elo)' }))

    expect(fetchSpy).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ playerId: 3000 }),
    }))
    await waitFor(() => expect(onMutate).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent(
      'Zelda Knight is now in the Black spot on Table 2.',
    )
  })

  it('immediately empties an occupied seat', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)
    const fetchSpy = vi.mocked(globalThis.fetch)
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ game: { ...game, blackPlayerId: null, blackPlayer: null } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await user.click(screen.getByRole('option', { name: 'Empty' }))
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      body: JSON.stringify({ playerId: null }),
    }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Black spot on Table 2 is now empty.',
    ))
    expect(input).toHaveValue('Empty')
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
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not offer seat fields for a finished game', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{ ...game, result: '1-0', finishedAt: '2026-01-01T01:00:00.000Z' }} />)
    await openGameDetails(user)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('preserves cancellation confirmation and mutation behavior', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ game }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    render(<GameCard game={game} onMutate={onMutate} />)
    await openGameDetails(user)
    await user.click(screen.getByRole('button', { name: 'Cancel Game' }))
    expect(screen.getByRole('dialog', { name: 'Cancel Table 2?' })).toBeVisible()
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
