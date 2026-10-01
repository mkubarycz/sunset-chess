import { describe, expect, it } from 'vitest'
import { encodeQrDataUrl, PLAYER_QR_RENDER_OPTIONS } from './qrArtwork'
import { encodePlayerReference, parseQrPayload } from './qrPayload'

describe('standards-compliant printable markers', () => {
  it('keeps a four-module quiet zone and encodes the supported 10,000 marker payload locally', async () => {
    expect(PLAYER_QR_RENDER_OPTIONS.margin).toBe(4)
    const payload = encodePlayerReference(10000)
    expect(parseQrPayload(payload)).toMatchObject({ reference: { playerId: 10000 } })
    const dataUrl = await encodeQrDataUrl(payload)
    expect(dataUrl).toMatch(/^data:image\/svg\+xml/)
    expect(dataUrl).not.toMatch(/https?:/)
  })
})
