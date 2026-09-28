import { describe, expect, it } from 'vitest'
import { trailForIdentity, updateTrail } from './trackingTrail'
import type { QrDetection } from './scanner'

const detection: QrDetection = {
  data: 'SC1:A',
  location: {
    topLeftCorner: { x: 1, y: 1 },
    topRightCorner: { x: 2, y: 1 },
    bottomRightCorner: { x: 2, y: 2 },
    bottomLeftCorner: { x: 1, y: 2 },
  },
}

describe('tracking trail', () => {
  it('ages out failed evidence and remains presentation-only geometry', () => {
    const point = { identity: detection.data, detection, at: 100, confidence: .9, model: 'homography' as const }
    const trail = updateTrail([], point, 100)
    expect(trailForIdentity(trail, detection.data, 500)).toHaveLength(1)
    expect(updateTrail(trail, null, 1_001)).toEqual([])
    expect(detection.location.topLeftCorner).toEqual({ x: 1, y: 1 })
  })
})
