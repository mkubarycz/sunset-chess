import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlayerMatchupSummary, type MatchupPlayer } from './PlayerMatchupSummary'

const player: MatchupPlayer = {
  id: 1000, name: 'Jackson', currentRating: 744,
  headToHead: [{ opponentId: 1001, wins: 0, losses: 1, draws: 0, lastPlayedAt: null }],
  assignedGame: null,
  lastResult: { opponentId: 1002, opponentName: 'Austin', outcome: 'loss', finishedAt: '2026-10-18T12:00:00.000Z' },
}

describe('PlayerMatchupSummary', () => {
  it('renders matchup and latest-result context independently of a dropdown', () => {
    const { container } = render(<PlayerMatchupSummary player={player} opponent={{ id: 1001, name: 'Blanca' }} />)
    expect(container.querySelector('.seat-player-summary')).toHaveTextContent('Jackson 744 (vs. Blanca 0-1-0)')
    expect(container.querySelector('.player-rating')).toHaveTextContent(/^744$/)
    expect(container.querySelector('.seat-player-context')).toHaveTextContent('Last Played: Never · Last Result: Lost to Austin')
  })

  it('omits unavailable context instead of showing an empty secondary line', () => {
    const { container } = render(<PlayerMatchupSummary player={{ id: 1000, name: 'Jackson', currentRating: 744 }} />)
    expect(screen.getByText('Jackson')).toBeVisible()
    expect(container.querySelector('.seat-player-context')).toBeNull()
  })

  it('updates the same summary when its opposing player changes', () => {
    const { container, rerender } = render(<PlayerMatchupSummary player={player} opponent={{ id: 1001, name: 'Blanca' }} />)
    rerender(<PlayerMatchupSummary player={player} opponent={{ id: 1002, name: 'Austin' }} />)
    expect(container.querySelector('.seat-player-summary')).toHaveTextContent(/^Jackson 744$/)
    expect(container).not.toHaveTextContent('Last Played:')
    expect(container).toHaveTextContent('Last Result: Lost to Austin')
  })
})
