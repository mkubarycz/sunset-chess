import { describe, expect, it } from 'vitest'
import { mapZxingResults, type ZxingReadResult } from './zxingResults'

function result(text: string, x: number, symbology = 'QRCode'): ZxingReadResult {
  return {
    text,
    symbology,
    position: {
      topLeft: { x, y: 1 },
      topRight: { x: x + 4, y: 1 },
      bottomRight: { x: x + 4, y: 5 },
      bottomLeft: { x, y: 5 },
    },
  }
}

describe('ZXing WASM result mapping', () => {
  it('returns multiple QR payloads with quadrilateral geometry', () => {
    expect(mapZxingResults([result('left', 1), result('right', 10)])).toEqual([
      {
        data: 'left',
        location: {
          topLeftCorner: { x: 1, y: 1 }, topRightCorner: { x: 5, y: 1 },
          bottomRightCorner: { x: 5, y: 5 }, bottomLeftCorner: { x: 1, y: 5 },
        },
      },
      expect.objectContaining({ data: 'right' }),
    ])
  })

  it('keeps work QR-only and bounded to four results', () => {
    const values = [
      result('not-qr', 0, 'DataMatrix'),
      ...Array.from({ length: 6 }, (_, index) => result(String(index), index * 10)),
    ]
    expect(mapZxingResults(values).map(({ data }) => data)).toEqual(['0', '1', '2', '3'])
  })
})
