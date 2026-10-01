import { describe, expect, it, vi } from 'vitest'
import { printRoundPlayerSticker } from './playerSticker'

describe('round player sticker printing', () => {
  it('prints only the selected player on the exact round one-inch substrate', async () => {
    let markup = ''
    const printWindow = {
      document: {
        open: vi.fn(),
        write: vi.fn((value: string) => { markup = value }),
        close: vi.fn(),
      },
      close: vi.fn(),
    } as unknown as Window
    const open = vi.fn(() => printWindow)
    const encode = vi.fn().mockResolvedValue('data:image/svg+xml,local-qr')

    await printRoundPlayerSticker({ id: 1234, name: 'Ada <Chess>' }, open, encode)

    expect(open).toHaveBeenCalledWith('', '_blank', expect.stringContaining('popup'))
    expect(encode).toHaveBeenCalledWith('SC1:YA')
    expect(markup).toContain('width:1in;height:1in')
    expect(markup).toContain('border-radius:50%')
    expect(markup).toContain('width:.8in;height:.8in')
    expect(markup).toContain('Ada &lt;Chess&gt;')
    expect(markup).toContain('player 1234')
    expect(markup).not.toContain('http://')
    expect(markup).not.toContain('https://')
  })

  it('reports popup blocking and closes a reserved window after generation failure', async () => {
    await expect(printRoundPlayerSticker(
      { id: 1234, name: 'Ada' },
      vi.fn(() => null),
      vi.fn(),
    )).rejects.toThrow('blocked')

    const close = vi.fn()
    const printWindow = { close } as unknown as Window
    await expect(printRoundPlayerSticker(
      { id: 1234, name: 'Ada' },
      vi.fn(() => printWindow),
      vi.fn().mockRejectedValue(new Error('QR failed')),
    )).rejects.toThrow('QR failed')
    expect(close).toHaveBeenCalledOnce()
  })
})
