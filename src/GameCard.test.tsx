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

async function openBlackSeat(user: ReturnType<typeof userEvent.setup>, players = roster) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
    JSON.stringify({ players }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
  render(<GameCard game={game} />)
  await user.click(screen.getByRole('button', { name: 'Edit Black player on Table 2' }))
  await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())
  const input = screen.getByRole('combobox', { name: 'Replacement player' })
  await user.click(input)
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
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
    expect(screen.queryByRole('button', { name: 'Manage Table 2' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit|Assign/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Cancelled 1/)).not.toBeInTheDocument()
  })

  it('hides cancellation management when a finished game is not eligible', () => {
    render(<GameCard game={{
      ...game,
      result: '1-0',
      finishedAt: '2026-01-01T01:00:00.000Z',
      canCancel: false,
    }} />)

    expect(screen.queryByRole('button', { name: 'Manage Table 2' })).not.toBeInTheDocument()
  })

  it('shows concise guidance for an eligible finished game', async () => {
    const user = userEvent.setup()
    render(<GameCard game={{
      ...game,
      result: '1-0',
      finishedAt: '2026-01-01T01:00:00.000Z',
      canCancel: true,
    }} />)

    await user.click(screen.getByRole('button', { name: 'Manage Table 2' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cancel game' }))
    expect(screen.getByText(
      'Cancellation is allowed only if this is both players’ latest game. Click “Cancel Game” to proceed.',
    )).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel Game' })).toBeVisible()
  })

  it('offers an accessible assign action on an empty active seat without adding a visible side label', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ players: roster }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    render(<GameCard game={waitingGame} unavailablePlayerIds={[2001]} />)

    expect(screen.getByText('Waiting for Black')).toBeVisible()
    expect(screen.getAllByText('Waiting for Black')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Assign Black player on Table 2' }))

    expect(screen.getByRole('dialog', { name: 'Assign Black player' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Assign player' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove player' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Empty' })).not.toBeInTheDocument()
    const input = screen.getByRole('combobox', { name: 'Replacement player' })
    await user.click(input)
    expect(screen.getByRole('option', { name: 'Zelda Knight (812 Elo)' })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Blanca/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Player 2 \(/ })).not.toBeInTheDocument()
  })

  it('assigns the selected player to the empty side and refreshes through the mutation callback', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ players: roster }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          game: {
            ...waitingGame,
            blackPlayerId: 3000,
            blackPlayer: { id: 3000, name: 'Zelda Knight', rating: 812 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    render(<GameCard game={waitingGame} onMutate={onMutate} />)
    await user.click(screen.getByRole('button', { name: 'Assign Black player on Table 2' }))
    const input = screen.getByRole('combobox', { name: 'Replacement player' })
    await user.type(input, 'zelda')
    await screen.findByRole('option', { name: 'Zelda Knight (812 Elo)' })
    await user.keyboard('{ArrowDown}{Enter}')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Assign player' }))
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ playerId: 3000 }),
    }))
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ blackPlayerId: 3000 }))
  })

  it('opens an accessible custom confirmation and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(<GameCard game={game} />)
    const gear = screen.getByRole('button', { name: 'Manage Table 2' })
    await user.click(gear)
    await user.click(screen.getByRole('menuitem', { name: 'Cancel game' }))
    expect(screen.getByRole('dialog', { name: 'Cancel Table 2?' })).toBeVisible()
    expect(screen.getByText(/frees its occupied seats/)).toBeVisible()
    await user.keyboard('{Escape}')
    expect(gear).toHaveFocus()
  })

  it('refreshes through the mutation callback only after a successful cancellation', async () => {
    const user = userEvent.setup()
    const onMutate = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ game }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    render(<GameCard game={game} onMutate={onMutate} />)
    await user.click(screen.getByRole('button', { name: 'Manage Table 2' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cancel game' }))
    await user.click(screen.getByRole('button', { name: 'Cancel Game' }))
    expect(fetchSpy).toHaveBeenCalledWith('/api/games/9', expect.objectContaining({ method: 'DELETE' }))
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 9, result: null }))
  })

  it('uses an accessible searchable listbox with authoritative Elo and excludes seated players', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)

    expect(screen.queryByRole('combobox', { name: 'Replacement player' })?.tagName).toBe('INPUT')
    expect(document.querySelector('select')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const listbox = screen.getByRole('listbox', { name: 'Replacement players' })
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(screen.getByRole('option', { name: 'Zelda Knight (812 Elo)' })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Noir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Blanca/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Empty' })).toBeVisible()
    expect(listbox).toHaveClass('replacement-listbox')
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove player' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close player assignment' })).toHaveTextContent('×')
    expect(screen.getByRole('dialog')).toHaveClass('modal-dialog')
  })

  it('selects an eligible authoritative scan without submitting and handles each scan token once', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ players: roster }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const view = render(<GameCard game={game} />)
    await user.click(screen.getByRole('button', { name: 'Edit Black player on Table 2' }))
    await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())

    view.rerender(<GameCard game={game}
      authoritativePlayerScan={{ playerId: 3000, token: 'zelda-1' }} />)

    const input = screen.getByRole('combobox', { name: 'Replacement player' })
    await waitFor(() => expect(input).toHaveValue('Zelda Knight (812 Elo)'))
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Zelda Knight selected from the scanned piece. Confirm to replace the player.',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await user.clear(input)
    await user.type(input, 'Player 3')
    view.rerender(<GameCard game={game}
      authoritativePlayerScan={{ playerId: 3000, token: 'zelda-1' }} />)
    expect(input).toHaveValue('Player 3')
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeDisabled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects scanned occupants, players at other tables, and unknown players accessibly', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ players: roster }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const view = render(<GameCard game={game} unavailablePlayerIds={[1111, 1222, 2001]} />)
    await user.click(screen.getByRole('button', { name: 'Edit Black player on Table 2' }))
    await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())

    view.rerender(<GameCard game={game} unavailablePlayerIds={[1111, 1222, 2001]}
      authoritativePlayerScan={{ playerId: 1111, token: 'current-1' }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Noir is already in this seat and cannot be selected.',
    ))

    view.rerender(<GameCard game={game} unavailablePlayerIds={[1111, 1222, 2001]}
      authoritativePlayerScan={{ playerId: 1222, token: 'opponent-1' }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Blanca is already in the opposing seat and cannot be selected.',
    ))

    view.rerender(<GameCard game={game} unavailablePlayerIds={[1111, 1222, 2001]}
      authoritativePlayerScan={{ playerId: 2001, token: 'other-game-1' }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Player 2 is seated in another ongoing game and cannot be selected.',
    ))

    view.rerender(<GameCard game={game} unavailablePlayerIds={[1111, 1222, 2001]}
      authoritativePlayerScan={{ playerId: 9999, token: 'unknown-1' }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Scanned player #9999 is not in the loaded player list.',
    ))
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeDisabled()
  })

  it('announces a scan while the roster is unloaded and requires a new scan token', async () => {
    const user = userEvent.setup()
    let resolvePlayers!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise((resolve) => { resolvePlayers = resolve }),
    )
    const view = render(<GameCard game={game} />)
    await user.click(screen.getByRole('button', { name: 'Edit Black player on Table 2' }))

    view.rerender(<GameCard game={game}
      authoritativePlayerScan={{ playerId: 3000, token: 'zelda-loading' }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'The player list is still loading. Scan the piece again when loading is complete.',
    ))

    resolvePlayers(new Response(
      JSON.stringify({ players: roster }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Replacement player' })).toHaveValue('')

    view.rerender(<GameCard game={game}
      authoritativePlayerScan={{ playerId: 3000, token: 'zelda-reentry' }} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Replacement player' }))
      .toHaveValue('Zelda Knight (812 Elo)'))
  })

  it('empties an occupied seat through the special Empty option', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)
    const fetchSpy = vi.mocked(globalThis.fetch)
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ game: { ...game, blackPlayerId: null, blackPlayer: null } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await user.click(screen.getByRole('option', { name: 'Empty' }))
    expect(input).toHaveValue('Empty')
    await user.click(screen.getByRole('button', { name: 'Replace player' }))
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ playerId: null }),
    }))
  })

  it('does not offer seat controls for a finished game', () => {
    render(<GameCard game={{ ...game, result: '1-0', finishedAt: '2026-01-01T01:00:00.000Z' }} />)
    expect(screen.queryByRole('button', { name: /Edit|Assign/ })).not.toBeInTheDocument()
  })

  it('filters a large roster case-insensitively and reports no results', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)

    await user.clear(input)
    await user.type(input, 'zELDa')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('Zelda Knight (812 Elo)')
    await user.clear(input)
    await user.type(input, 'nobody')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No replacement players found.')
  })

  it('supports keyboard navigation and submits the selected player ID', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)
    const fetchSpy = vi.mocked(globalThis.fetch)
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ game: { ...game, blackPlayerId: 3000 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await user.clear(input)
    await user.type(input, 'zelda')
    await user.keyboard('{End}{Enter}')
    expect(input).toHaveValue('Zelda Knight (812 Elo)')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Replace player' }))
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/games/9/seats/black', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ playerId: 3000 }),
    }))
  })

  it('clears a stale selected ID when the displayed query is edited', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)

    await user.clear(input)
    await user.type(input, 'zelda')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeEnabled()
    await user.type(input, 'x')
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeDisabled()
  })

  it('closes the list before the outer dialog on Escape', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)

    expect(screen.getByRole('dialog')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('announces loading and player-load errors from the combobox listbox', async () => {
    const user = userEvent.setup()
    let rejectFetch!: (reason: Error) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise((_, reject) => { rejectFetch = reject }))
    render(<GameCard game={game} />)
    await user.click(screen.getByRole('button', { name: 'Edit Black player on Table 2' }))

    const input = screen.getByRole('combobox', { name: 'Replacement player' })
    await user.click(input)
    expect(input).toHaveAttribute('aria-controls')
    expect(screen.getByRole('status')).toHaveTextContent('Loading players…')
    rejectFetch(new Error('Roster unavailable.'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Roster unavailable.')
    expect(screen.getByRole('listbox')).toBeVisible()
  })

  it('resets the query and selection after closing and reopening a seat dialog', async () => {
    const user = userEvent.setup()
    const input = await openBlackSeat(user)
    await user.clear(input)
    await user.type(input, 'zelda')
    await user.keyboard('{ArrowDown}{Enter}')
    await user.click(screen.getByRole('button', { name: 'Close player assignment' }))

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ players: roster }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    await user.click(screen.getByRole('button', { name: 'Edit White player on Table 2' }))
    const reopened = screen.getByRole('combobox', { name: 'Replacement player' })
    expect(reopened).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Replace player' })).toBeDisabled()
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
