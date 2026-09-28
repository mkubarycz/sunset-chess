import { describe, expect, it } from 'vitest'
import type { QualityProfile } from './adaptiveQuality'
import {
  formatDecoderInputStats,
  mergeDecoderDetections,
  mergeTimedDecoderDetections,
  workerDecodeDimensions,
} from './decoderOrchestration'
import type { QrDetection } from './scanner'

function detection(data: string, x: number, size: number): QrDetection {
  return {
    data,
    location: {
      topLeftCorner: { x, y: 0 },
      topRightCorner: { x: x + size, y: 0 },
      bottomRightCorner: { x: x + size, y: size },
      bottomLeftCorner: { x, y: size },
    },
  }
}

const profile = (tier: QualityProfile['tier'], max: number): QualityProfile => ({
  tier,
  decodeMaxDimension: max,
  trackMaxDimension: 640,
  decodeIntervalMs: 150,
  trackIntervalMs: 55,
})

describe('decoder orchestration', () => {
  it('keeps each identity geometry paired with its actual decoder capture time', () => {
    const olderLarge = detection('same', 0, 20)
    const newerSmall = detection('same', 80, 10)
    const other = detection('other', 40, 10)
    expect(mergeTimedDecoderDetections([
      { decoder: 'native', capturedAt: 100, detections: [olderLarge, other] },
      { decoder: 'zxing-wasm', capturedAt: 140, detections: [newerSmall] },
    ])).toEqual([
      { decoder: 'zxing-wasm', capturedAt: 140, detection: newerSmall },
      { decoder: 'native', capturedAt: 100, detection: other },
    ])
  })
  it('sends every high-tier 1920×1080 attempt at full source detail', () => {
    expect(workerDecodeDimensions(1920, 1080, profile('high', 1920), 500, 450))
      .toEqual({ width: 1920, height: 1080, fullDetail: true })
  })

  it('keeps periodic full-detail 4K attempts while bounding intervening work', () => {
    expect(workerDecodeDimensions(3840, 2160, profile('high', 1920), 500, 100))
      .toEqual({ width: 1920, height: 1080, fullDetail: false })
    expect(workerDecodeDimensions(3840, 2160, profile('high', 1920), 1_100, 100))
      .toEqual({ width: 3840, height: 2160, fullDetail: true })
  })

  it('merges multiple decoders by identity and keeps the strongest geometry', () => {
    const nativeA = detection('A', 0, 10)
    const zxingA = detection('A', 0, 20)
    const nativeB = detection('B', 30, 10)
    const zxingC = detection('C', 60, 10)
    expect(mergeDecoderDetections([nativeA, nativeB], [zxingA, zxingC]))
      .toEqual([zxingA, nativeB, zxingC])
  })

  it('reports actual source and per-decoder input dimensions', () => {
    expect(formatDecoderInputStats(1920, 1080, {
      native: { width: 1920, height: 1080, attemptedAt: 1 },
      'zxing-wasm': { width: 1920, height: 1080, attemptedAt: 2 },
      jsqr: { width: 1440, height: 810, attemptedAt: 3 },
    })).toBe(
      'source 1920×1080 · native 1920×1080 · zxing-wasm 1920×1080 · jsqr 1440×810',
    )
  })
})
