import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
