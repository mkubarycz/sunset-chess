import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModalDialog } from './ModalDialog'

afterEach(() => vi.restoreAllMocks())

describe('ModalDialog initial focus', () => {
  it('focuses the dialog when focus has not already entered it', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    render(<ModalDialog title="Details" onClose={() => {}}>Content</ModalDialog>)
    act(() => frame.mock.calls[0][0](0))
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('does not steal focus from a field activated before the initial frame runs', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    render(<ModalDialog title="Details" onClose={() => {}}><input aria-label="Search" /></ModalDialog>)
    const input = screen.getByRole('textbox', { name: 'Search' })
    act(() => input.focus())
    act(() => frame.mock.calls[0][0](0))
    expect(input).toHaveFocus()
  })

  it('cancels pending initial focus when the dialog closes', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = render(<ModalDialog title="Details" onClose={() => {}}>Content</ModalDialog>)
    unmount()
    expect(cancel).toHaveBeenCalledWith(42)
  })
})
