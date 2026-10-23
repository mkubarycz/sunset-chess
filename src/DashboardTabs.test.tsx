import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardTabs } from './DashboardTabs'

function Harness() {
  const [selected, setSelected] = useState('leaderboard')
  return <DashboardTabs selected={selected} onSelect={setSelected} tabs={[
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'recent-games', label: 'Recent Games' },
  ]}>{{
    leaderboard: <p>Ranks</p>,
    'recent-games': <p>History</p>,
  }}</DashboardTabs>
}

describe('DashboardTabs', () => {
  it('implements Arrow, Home, and End selection with linked WAI-ARIA panels', () => {
    render(<Harness />)
    const leaderboard = screen.getByRole('tab', { name: 'Leaderboard' })
    expect(leaderboard).toHaveAttribute('aria-controls', 'panel-leaderboard')
    fireEvent.keyDown(leaderboard, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Recent Games' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Recent Games' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
    expect(leaderboard).toHaveFocus()
  })

  it('renders toolbar controls outside the selectable tabs and their scroller', () => {
    const onOpen = vi.fn()
    render(<DashboardTabs selected="leaderboard" onSelect={() => undefined}
      tabs={[{ id: 'leaderboard', label: 'Leaderboard' }]}
      toolbarActions={<button type="button" onClick={onOpen}>Club Sessions</button>}>
      {{ leaderboard: <p>Ranks</p> }}
    </DashboardTabs>)

    const menu = screen.getByRole('button', { name: 'Club Sessions' })
    expect(screen.getByRole('tablist')).not.toContainElement(menu)
    fireEvent.click(menu)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('places a configuration action directly beside its tab', () => {
    const onConfigure = vi.fn()
    render(<DashboardTabs selected="session-4" onSelect={() => undefined}
      tabs={[{
        id: 'session-4',
        label: 'Oct 2 Club Session',
        action: { label: 'Configure Oct 2 Club Session', onClick: onConfigure },
      }]}>
      {{ 'session-4': <p>Session standings</p> }}
    </DashboardTabs>)

    const tab = screen.getByRole('tab', { name: 'Oct 2 Club Session' })
    const configure = screen.getByRole('button', { name: 'Configure Oct 2 Club Session' })
    expect(tab.parentElement).toContainElement(configure)
    expect(tab.parentElement).toHaveAttribute('data-selected', 'true')
    expect(configure.querySelector('svg')).toBeInTheDocument()
    fireEvent.click(configure)
    expect(onConfigure).toHaveBeenCalledOnce()
  })
})
