import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionHeader } from './SessionHeader'
import type { ClubSession } from './SessionCard'

const session: ClubSession = {
  id: 2, type: 'club-session', name: 'Unused Club Night',
  createdAt: '2026-10-22T13:00:00.000Z', active: false,
  closedAt: '2026-10-22T15:00:00.000Z', playerCount: 0, gameCount: 0,
  activeGameCount: 0, pairingMode: 'club-session-pairing-1',
}

describe('SessionHeader', () => {
  it.each([true, false])('provides an accessible trash icon for an empty session (active=%s)', (active) => {
    render(<SessionHeader session={{ ...session, active }} onDelete={vi.fn()} />)
    const trash = screen.getByRole('button', { name: 'Delete empty session' })
    expect(trash.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(trash).toHaveAttribute('title', 'Delete empty session')
  })

  it.each([{ playerCount: 1, gameCount: 0 }, { playerCount: 0, gameCount: 1 }, { playerCount: 1, gameCount: 1 }])(
    'does not offer deletion for a populated session (%j)', (counts) => {
      render(<SessionHeader session={{ ...session, ...counts }} onDelete={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Delete empty session' })).not.toBeInTheDocument()
    },
  )

  it('requires confirmation and allows cancelling with restored focus', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(<SessionHeader session={session} onDelete={onDelete} />)
    const trigger = screen.getByRole('button', { name: 'Delete empty session' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Delete empty session?' })).toHaveTextContent('retained in the database')
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Keep Session' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Delete Session' }))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('surfaces stale eligibility and request errors without claiming success', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Session now has check-ins.'))
    render(<SessionHeader session={session} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete empty session' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete Session' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Session now has check-ins.')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete Session' })).toBeEnabled()
  })
})
