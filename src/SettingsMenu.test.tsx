import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsMenu } from './SettingsMenu'

describe('SettingsMenu', () => {
  it('toggles diagnostics, starts calibration, and dismisses with Escape', async () => {
    const onDebugChange = vi.fn()
    const onCalibrate = vi.fn()
    render(<SettingsMenu showDebugTools={false} onDebugChange={onDebugChange}
      onCalibrate={onCalibrate} error="" />)
    const trigger = screen.getByRole('button', { name: 'Settings' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('checkbox', { name: /Show diagnostics/ }))
    expect(onDebugChange).toHaveBeenCalledWith(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Calibrate camera' }))
    expect(onCalibrate).toHaveBeenCalledOnce()
  })
})
