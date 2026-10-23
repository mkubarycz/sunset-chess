import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClubSessionsMenu, ClubSessionsView } from './ClubSessions'
import type { ClubSession } from './SessionCard'

const sessions: ClubSession[] = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1, type: 'club-session', name: `Club Night ${index + 1}`,
  createdAt: `2026-10-0${index + 1}T13:00:00.000Z`, active: false,
  closedAt: `2026-10-0${index + 1}T15:00:00.000Z`,
  playerCount: 12, gameCount: 30, activeGameCount: 0,
  pairingMode: 'club-session-pairing-1',
}))

function menuProps() {
  return { sessions, loaded: true, error: '', creating: false,
    onCreate: vi.fn(), onSelect: vi.fn(), onFindPast: vi.fn() }
}

describe('ClubSessionsMenu', () => {
  it('uses one labelled dropdown with the newest five in descending order', async () => {
    const props = menuProps()
    render(<ClubSessionsMenu {...props} />)
    const trigger = screen.getByRole('button', { name: 'Club Sessions' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Club Sessions' })
    expect(menu).toHaveAttribute('id', trigger.getAttribute('aria-controls'))
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Create New Session'),
      ...[7, 6, 5, 4, 3].map((id) => expect.stringContaining(`Club Night ${id}`)),
      expect.stringContaining('Find Past Sessions'),
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Club Night 6/ }))
    expect(props.onSelect).toHaveBeenCalledWith(6)
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('creates a session or opens the full archive and closes the menu', async () => {
    const props = menuProps()
    render(<ClubSessionsMenu {...props} sessions={[]} />)
    const trigger = screen.getByRole('button', { name: 'Club Sessions' })
    await userEvent.click(trigger)
    expect(screen.getByText('No club sessions yet.')).toBeVisible()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Create New Session' }))
    expect(props.onCreate).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Find Past Sessions' }))
    expect(props.onFindPast).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })

  it.each([
    { loaded: false }, { error: 'Offline' }, { creating: true },
    { sessions: [{ ...sessions[0], active: true }] },
  ])('disables unsafe or duplicate creation (%j)', async (overrides) => {
    const props = menuProps()
    render(<ClubSessionsMenu {...props} {...overrides} />)
    await userEvent.click(screen.getByRole('button', { name: 'Club Sessions' }))
    const create = screen.getByRole('menuitem', { name: /Creat.*Session/ })
    expect(create).toBeDisabled()
    await userEvent.click(create)
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('supports arrow, Home, End and Escape navigation, skipping disabled actions', async () => {
    const props = menuProps()
    render(<ClubSessionsMenu {...props} sessions={[{ ...sessions[0], active: true }, sessions[1]]} />)
    const trigger = screen.getByRole('button', { name: 'Club Sessions' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const newest = screen.getByRole('menuitem', { name: /Club Night 2/ })
    const oldest = screen.getByRole('menuitem', { name: /Club Night 1/ })
    const find = screen.getByRole('menuitem', { name: 'Find Past Sessions' })
    expect(newest).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(oldest).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(find).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(newest).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(find).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(newest).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses on outside click and when focus tabs out', async () => {
    render(<><ClubSessionsMenu {...menuProps()} /><button>Outside</button></>)
    const trigger = screen.getByRole('button', { name: 'Club Sessions' })
    await userEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(trigger)
    await userEvent.keyboard('{End}{Tab}')
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('ClubSessionsView', () => {
  it('lists every session with dates, status and counts and opens a selected session', async () => {
    const onSelect = vi.fn()
    render(<ClubSessionsView sessions={[{ ...sessions[0], active: true }, ...sessions.slice(1)]}
      loaded error="" onSelect={onSelect} />)
    const list = screen.getByRole('list')
    const buttons = within(list).getAllByRole('button')
    expect(buttons).toHaveLength(7)
    expect(buttons[0]).toHaveTextContent('Club Night 7')
    expect(buttons[0]).toHaveTextContent(new Date(sessions[6].createdAt).toLocaleString())
    expect(buttons[0]).toHaveTextContent('12 players')
    expect(buttons[0]).toHaveTextContent('30 games')
    expect(buttons[6]).toHaveTextContent('Active')
    await userEvent.click(buttons[6])
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('distinguishes loading and failure from an empty archive', () => {
    const props = { sessions: [], loaded: false, error: '', onSelect: vi.fn() }
    const view = render(<ClubSessionsView {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading club sessions')
    expect(screen.queryByText('No past club sessions yet.')).not.toBeInTheDocument()
    view.rerender(<ClubSessionsView {...props} error="Offline" />)
    expect(screen.getByText('Sessions could not be loaded. Use Retry club sessions below.')).toBeVisible()
    expect(screen.queryByText('No past club sessions yet.')).not.toBeInTheDocument()
    view.rerender(<ClubSessionsView {...props} loaded />)
    expect(screen.getByText('No past club sessions yet.')).toBeVisible()
  })
})
