import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsMenu } from './SettingsMenu'

describe('SettingsMenu', () => {
  it('toggles diagnostics, contains no camera setup action, and dismisses with Escape', async () => {
    const onDebugChange = vi.fn()
    render(<SettingsMenu showDebugTools={false} onDebugChange={onDebugChange}
      error="" />)
    const trigger = screen.getByRole('button', { name: 'Settings' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('checkbox', { name: /Show diagnostics/ }))
    expect(onDebugChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.queryByText(/camera setup/i)).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
