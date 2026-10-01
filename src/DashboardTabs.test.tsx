import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DashboardTabs } from './DashboardTabs'
import type { DashboardTab } from './uiPreferences'

function Harness() {
  const [selected, setSelected] = useState<DashboardTab>('leaderboard')
  return <DashboardTabs selected={selected} onSelect={setSelected}>{{
    leaderboard: <p>Ranks</p>,
    'recent-games': <p>History</p>,
    players: <p>Roster</p>,
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
    expect(screen.getByRole('tab', { name: 'Players' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
    expect(leaderboard).toHaveFocus()
  })
})
