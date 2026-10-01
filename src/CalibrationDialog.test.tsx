import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CalibrationDialog } from './CalibrationDialog'
import { defaultCalibration } from './calibration'

describe('CalibrationDialog', () => {
  it('guides framing, marker evidence, alignment, persistence callback, and reset', async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(<CalibrationDialog calibration={defaultCalibration()}
      videoSize={{ width: 1920, height: 1080 }} playerMarkerPresent={false}
      onChange={onChange} onClose={onClose} />)
    expect(screen.getByRole('heading', { name: 'Frame camera' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Place a player marker')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Place marker' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Align ActionZones' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset defaults' }))
    expect(onChange).toHaveBeenCalledWith(defaultCalibration())
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
