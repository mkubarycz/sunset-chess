import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SessionCard, type ClubSession } from './SessionCard'

const session: ClubSession = {
  id: 4,
  type: 'club-session',
  name: 'Oct 2 Club Session',
  createdAt: '2026-10-02T13:00:00.000Z',
  active: true,
  playerCount: 3,
  gameCount: 2,
  activeGameCount: 2,
  closedAt: null,
  pairingMode: 'club-session-pairing-1',
}

describe('SessionCard', () => {
  it('shows session status and renames from the standard settings modal', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn().mockResolvedValue(undefined)
    const onPairingModeChange = vi.fn().mockResolvedValue(undefined)
    const returnFocusRef = createRef<HTMLButtonElement>()
    render(<>
      <button ref={returnFocusRef}>Session settings</button>
      <SessionCard session={session} open onClose={vi.fn()}
        returnFocusRef={returnFocusRef} onRename={onRename}
        onPairingModeChange={onPairingModeChange}
        onCloseSession={vi.fn().mockResolvedValue(undefined)} />
    </>)

    expect(screen.getByText(/3 checked in · 2 games/)).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Club Session Settings' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Pairing mode' })).toHaveValue(
      'club-session-pairing-1',
    )
    const input = screen.getByRole('textbox', { name: 'Session title' })
    await user.clear(input)
    await user.type(input, 'Thursday Club Night')
    await user.tab()
    expect(onRename).toHaveBeenCalledWith('Thursday Club Night')
  })

  it('warns about active games and resolves all of them before closing', async () => {
    const user = userEvent.setup()
    const onCloseSession = vi.fn().mockResolvedValue(undefined)
    const returnFocusRef = createRef<HTMLButtonElement>()
    render(<SessionCard session={session} open onClose={vi.fn()}
      returnFocusRef={returnFocusRef} onRename={vi.fn()}
      onPairingModeChange={vi.fn().mockResolvedValue(undefined)}
      onCloseSession={onCloseSession} />)

    await user.click(screen.getByRole('button', { name: 'Close Session' }))
    expect(screen.getByRole('dialog', { name: 'Close Club Session?' })).toBeVisible()
    expect(screen.getByText(
      'There are two active games in the current session. Click Draw or Cancel to proceed with closing these games out.',
    )).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Draw Games and Close' }))
    expect(onCloseSession).toHaveBeenCalledWith('draw')
  })
})
