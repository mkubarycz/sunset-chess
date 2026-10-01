import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { describe, expect, it, vi } from 'vitest'
import {
  createPlayerPayload,
  encodePlayerReference,
  encodePlayerPayload,
  parseQrPayload,
  uniformInteger,
} from './qrPayload'

function qrPixels(value: string) {
  const qr = QRCode.create(value)
  const quiet = 4
  const scale = 5
  const size = (qr.modules.size + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) continue
      for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
        const index = (((row + quiet) * scale + y) * size + (column + quiet) * scale + x) * 4
        pixels[index] = pixels[index + 1] = pixels[index + 2] = 0
      }
    }
  }
  return { pixels, size }
}

describe('player QR payloads', () => {
  it('covers range boundaries and rejection sampling without modulo bias', () => {
    expect(uniformInteger(1000, 2000, () => 0)).toBe(1000)
    expect(uniformInteger(1000, 2000, () => 1000)).toBe(2000)
    const random = vi.fn()
      .mockReturnValueOnce(4_294_967_295)
      .mockReturnValueOnce(42)
    expect(uniformInteger(1000, 2000, random)).toBe(1042)
    expect(random).toHaveBeenCalledTimes(2)
  })

  it('encodes canonical JSON and roundtrips a valid player', () => {
    const player = createPlayerPayload('  Ada  ', () => 234)
    const encoded = encodePlayerPayload(player)
    expect(encoded).toBe('{"v":1,"kind":"player","playerId":1234,"name":"Ada"}')
    expect(parseQrPayload(encoded)).toEqual({
      kind: 'player',
      player,
      label: 'Ada · #1234',
    })
  })

  it('roundtrips canonical compact player references across the supported range', () => {
    expect(encodePlayerReference(1000)).toBe('SC1:RS')
    expect(encodePlayerReference(1234)).toBe('SC1:YA')
    expect(encodePlayerReference(2000)).toBe('SC1:1JK')
    expect(encodePlayerReference(10000)).toBe('SC1:7PS')
    expect(parseQrPayload('SC1:YA')).toEqual({
      kind: 'player-reference',
      reference: { v: 1, kind: 'player-reference', playerId: 1234 },
      label: 'Player #1234 · resolving…',
    })
  })

  it.each([
    'sc1:YA',
    'SC1:ya',
    'SC1:0YA',
    'SC1:',
    'SC1:Y-',
    'SC1:RR',
    'SC1:7PT',
  ])('rejects malformed, noncanonical, or out-of-range compact references: %s', (value) => {
    expect(parseQrPayload(value)).toEqual({ kind: 'raw', value, label: value })
  })

  it.each([
    '{"v":2,"kind":"player","playerId":1234,"name":"Ada"}',
    '{"v":1,"kind":"player","playerId":999,"name":"Ada"}',
    '{"v":1,"kind":"player","playerId":1234.5,"name":"Ada"}',
    '{"v":1,"kind":"player","playerId":1234,"name":" "}',
    '{"v":1,"kind":"player","playerId":"1234","name":"Ada"}',
  ])('treats invalid player JSON as an arbitrary raw payload', (value) => {
    expect(parseQrPayload(value).kind).toBe('raw')
  })

  it('rejects invalid producer names', () => {
    expect(() => createPlayerPayload('   ', () => 0)).toThrow('Enter a player name')
    expect(() => createPlayerPayload('x'.repeat(81), () => 0)).toThrow('80 characters')
  })

  it('generates a real QR that jsQR decodes to the canonical payload', () => {
    const encoded = encodePlayerPayload(createPlayerPayload('Grace', () => 7))
    const { pixels, size } = qrPixels(encoded)
    expect(jsQR(pixels, size, size)?.data).toBe(encoded)
  })

  it('fits the compact payload in a Version 1-H matrix with a 29-module symbol', () => {
    for (const playerId of [1000, 1234, 2000, 10000]) {
      const qr = QRCode.create(encodePlayerReference(playerId), { errorCorrectionLevel: 'H' })
      expect(qr.modules.size).toBe(21)
      expect(qr.modules.size + 4 * 2).toBe(29)
    }
  })
})
