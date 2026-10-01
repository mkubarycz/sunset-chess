import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayersPanel } from './PlayersPanel'

afterEach(() => vi.unstubAllGlobals())

const player = {
  rank: 1, id: 1000, name: 'Alice', currentRating: 700,
  gamesPlayed: 0, wins: 0, losses: 0, draws: 0, lastPlayedAt: null,
}

describe('PlayersPanel', () => {
  it('lists and renames players, then exposes explicit delete conflicts', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ players: [player] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ player: { ...player, name: 'Alicia' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ players: [{ ...player, name: 'Alicia' }] }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Player has game references.' }) })
    vi.stubGlobal('fetch', fetch)
    const onMutate = vi.fn()
    render(<PlayersPanel refreshKey={0} onMutate={onMutate} />)
    expect(await screen.findByRole('table', { name: 'All players' })).toHaveTextContent('Alice')
    await userEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
    const input = screen.getByRole('textbox', { name: 'New name for Alice' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Alicia')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Alicia')).toBeInTheDocument()
    expect(onMutate).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Alicia' }))
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete Alicia?')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('game references')
  })
})
