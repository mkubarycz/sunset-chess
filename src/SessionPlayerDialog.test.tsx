import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionPlayerDialog } from './SessionPlayerDialog'

describe('SessionPlayerDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('searches unregistered players and checks the selected player into the session', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/api/players') {
        return new Response(JSON.stringify({ players: [
          { id: 1000, name: 'Alice Knight', currentRating: 710 },
          { id: 1001, name: 'Bob Bishop', currentRating: 690 },
        ] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ leaderboard: [{ id: 1001 }] }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const onCheckIn = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(<SessionPlayerDialog eventId={4} returnFocusRef={createRef()}
      onCheckIn={onCheckIn} onClose={onClose} />)

    const input = screen.getByRole('combobox', { name: 'Player' })
    await waitFor(() => expect(screen.queryByText('Loading players…')).not.toBeInTheDocument())
    expect(screen.queryByText(/Bob Bishop/)).not.toBeInTheDocument()
    await user.type(input, 'Alice')
    await user.click(screen.getByRole('option', { name: 'Alice Knight (710 Elo)' }))
    expect(onCheckIn).toHaveBeenCalledWith({
      id: 1000,
      name: 'Alice Knight',
      currentRating: 710,
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
