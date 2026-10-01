import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayersPanel } from './PlayersPanel'

afterEach(() => vi.unstubAllGlobals())

const player = {
  rank: 1, id: 1000, name: 'Alice', currentRating: 716,
  gamesPlayed: 1, wins: 1, losses: 0, draws: 0, lastPlayedAt: '2026-01-02T12:00:00.000Z',
}
const profile = {
  ...player,
  ongoingGames: [{
    id: 8, tableNumber: 4, createdAt: '2026-01-03T12:00:00.000Z',
    blackPlayerId: 1000, whitePlayerId: 1001, finishedAt: null, result: null,
    blackPlayer: { id: 1000, name: 'Alice', rating: 716 },
    whitePlayer: { id: 1001, name: 'Bob', rating: 684 },
  }],
  recentGames: [{
    id: 9, tableNumber: 2, opponent: { id: 1001, name: 'Bob', rating: 684, delta: -16 },
    color: 'white' as const, result: '1-0', outcome: 'W' as const,
    finishedAt: '2026-01-02T12:00:00.000Z',
    ratingBefore: 700, ratingAfter: 716, delta: 16,
  }],
  ratingHistory: [],
}

describe('PlayersPanel', () => {
  it('orders and aligns columns, then opens the profile editor from the name', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ players: [player] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile }) }))
    render(<PlayersPanel refreshKey={0} onMutate={vi.fn()} />)
    const table = await screen.findByRole('table', { name: 'All players' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['ID', 'Player', 'Elo', 'W/L/D', ''])
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('numeric-column')
    expect(within(table).getAllByRole('columnheader')[1]).not.toHaveClass('numeric-column')
    expect(within(table).getAllByRole('columnheader')[2]).toHaveClass('numeric-column')
    expect(within(table).getAllByRole('columnheader')[3]).toHaveClass('numeric-column')

    const nameButton = screen.getByRole('button', { name: 'Alice' })
    await userEvent.click(nameButton)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Alice' })
    expect(dialog).toContainElement(screen.getByLabelText('Player name'))
    const ongoingGames = screen.getByRole('region', { name: 'Ongoing games for Alice' })
    expect(ongoingGames.querySelectorAll('.game-card')).toHaveLength(1)
    expect(within(ongoingGames).getByRole('article', {
      name: 'Table 4: Alice plays black, Bob plays white',
    })).toBeVisible()
    const recentGames = screen.getByRole('region', { name: 'Recent games for Alice' })
    expect(recentGames).toHaveClass('profile-game-strip')
    expect(recentGames).toHaveAttribute('tabindex', '0')
    expect(recentGames.querySelectorAll('.game-card')).toHaveLength(1)
    expect(within(recentGames).getByRole('article', {
      name: 'Table 2: Bob plays black, Alice plays white',
    })).toBeVisible()
    expect(within(recentGames).getByText('Table 2')).toBeVisible()
    expect(within(recentGames).getByText('716 Elo')).toBeVisible()
    expect(within(recentGames).getByText('684 Elo')).toBeVisible()
    expect(within(recentGames).getByText('+16')).toBeVisible()
    expect(within(recentGames).getByText('-16')).toBeVisible()
    expect(within(recentGames).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(nameButton).toHaveFocus())
  })

  it('renders at most ten established game cards in one horizontal profile strip', async () => {
    const recentGames = Array.from({ length: 12 }, (_, index) => ({
      ...profile.recentGames[0],
      id: 100 + index,
      tableNumber: index + 1,
    }))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ players: [player] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile: { ...profile, recentGames } }) }))
    render(<PlayersPanel refreshKey={0} onMutate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Alice' }))

    const strip = await screen.findByRole('region', { name: 'Recent games for Alice' })
    expect(strip.querySelectorAll(':scope > .game-card')).toHaveLength(10)
    expect(strip).toHaveClass('profile-game-strip')
    expect(strip).toHaveAttribute('tabindex', '0')
    expect(within(strip).queryByRole('button', { name: /Manage|Edit/ })).not.toBeInTheDocument()
    expect(within(strip).getByText('Table 10')).toBeVisible()
    expect(within(strip).queryByText('Table 11')).not.toBeInTheDocument()
  })

  it('supports keyboard gear-menu navigation, dismissal, printing, and focus restoration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ players: [player] }),
    }))
    const printSticker = vi.fn().mockResolvedValue(undefined)
    render(<PlayersPanel refreshKey={0} onMutate={vi.fn()} printSticker={printSticker} />)
    const trigger = await screen.findByRole('button', { name: 'Actions for Alice' })
    await userEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Actions for Alice' })
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus())
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(within(menu).getByRole('menuitem', { name: 'Print sticker' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(printSticker).toHaveBeenCalledWith(player)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    await userEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('saves a validated name, refreshes profile/surfaces, and shows delete conflicts in one dialog', async () => {
    const renamed = { ...player, name: 'Alicia' }
    const renamedProfile = { ...profile, ...renamed }
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ players: [player] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ player: renamed }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ players: [renamed] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile: renamedProfile }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Player has game references.' }) })
    vi.stubGlobal('fetch', fetch)
    const onMutate = vi.fn()
    render(<PlayersPanel refreshKey={0} onMutate={onMutate} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Alice' }))
    const input = await screen.findByRole('textbox', { name: 'Player name' })
    await userEvent.clear(input)
    await userEvent.type(input, ' Alicia ')
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('heading', { name: 'Edit Alicia' })).toBeInTheDocument()
    expect(onMutate).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Delete player' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('game references')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('announces sticker generation failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ players: [player] }),
    }))
    render(<PlayersPanel refreshKey={0} onMutate={vi.fn()}
      printSticker={vi.fn().mockRejectedValue(new Error('The print window was blocked.'))} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Alice' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Print sticker' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('blocked')
  })
})
