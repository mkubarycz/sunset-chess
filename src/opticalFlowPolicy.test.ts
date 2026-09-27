import { describe, expect, it } from 'vitest'
import { hasIdentityCrossing, rejectAmbiguousTracks, validateFlow } from './opticalFlowPolicy'
import type { QrDetection } from './scanner'

function detection(data: string, x: number): QrDetection {
  return {
    data,
    location: {
      topLeftCorner: { x, y: 0 },
      topRightCorner: { x: x + 20, y: 0 },
      bottomRightCorner: { x: x + 20, y: 20 },
      bottomLeftCorner: { x, y: 20 },
    },
  }
}

describe('OpenCV LK acceptance policy', () => {
  it('accepts distributed, forward-backward-consistent affine flow', () => {
    expect(validateFlow({
      originalCount: 30, survivors: 25, inliers: 22,
      meanError: 3, meanForwardBackward: .3, scale: 1.04, rotationRadians: .1,
    })).toMatchObject({ accepted: true })
  })

  it.each([
    ['too few points', { survivors: 7 }],
    ['LK error', { meanError: 25 }],
    ['forward-backward error', { meanForwardBackward: 1.6 }],
    ['weak geometry', { inliers: 5 }],
    ['scale jump', { scale: 1.4 }],
    ['rotation jump', { rotationRadians: .8 }],
  ])('fails closed for %s', (_name, override) => {
    expect(validateFlow({
      originalCount: 30, survivors: 25, inliers: 22,
      meanError: 3, meanForwardBackward: .3, scale: 1, rotationRadians: 0,
      ...override,
    }).accepted).toBe(false)
  })

  it('drops both identities when tracked quads converge ambiguously', () => {
    expect(rejectAmbiguousTracks([detection('a', 0), detection('b', 8)])).toEqual([])
    expect(rejectAmbiguousTracks([detection('a', 0), detection('b', 50)])).toHaveLength(2)
  })

  it('detects identity crossing so both tracks can fail closed', () => {
    expect(hasIdentityCrossing(
      [detection('a', 0), detection('b', 50)],
      [detection('a', 60), detection('b', 0)],
    )).toBe(true)
  })
})
