import { describe, expect, it } from 'vitest'
import { ZXING_QR_READER_OPTIONS } from './zxingOptions'

describe('ZXing QR reader options', () => {
  it('enables QR-only difficult-code search without irrelevant formats', () => {
    expect(ZXING_QR_READER_OPTIONS).toEqual({
      formats: ['QRCode'],
      maxNumberOfSymbols: 4,
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      returnErrors: false,
    })
  })
})
