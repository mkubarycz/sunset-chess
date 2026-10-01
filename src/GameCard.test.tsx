import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { GameCard, type OngoingGame } from './GameCard'

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
    expect(screen.getByText('-12')).toHaveClass('negative')
    expect(screen.getByText('+12')).toHaveClass('positive')
    expect(screen.queryByText(/White player|Black player/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Cancelled')).toBeVisible()
    expect(screen.getByText('Draw')).toHaveClass('cancelled-result')
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage Table 2' })).not.toBeInTheDocument()
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
      JSON.stringify({ game: { ...game, cancelledAt: '2026-01-02T00:00:00.000Z' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    render(<GameCard game={game} onMutate={onMutate} />)
    await user.click(screen.getByRole('button', { name: 'Manage Table 2' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cancel game' }))
    await user.click(screen.getByRole('button', { name: 'Cancel game' }))
    expect(fetchSpy).toHaveBeenCalledWith('/api/games/9', expect.objectContaining({ method: 'DELETE' }))
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({
      id: 9,
      cancelledAt: '2026-01-02T00:00:00.000Z',
    }))
    fetchSpy.mockRestore()
  })
})
