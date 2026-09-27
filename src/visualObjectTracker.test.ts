import { describe, expect, it } from 'vitest'
import {
  rgbaToVisualFrame,
  scaleDetection,
  VisualObjectTracker,
  VISUAL_ACTION_ANCHOR_AGE_MS,
  VISUAL_TRACK_MAX_ANCHOR_AGE_MS,
} from './visualObjectTracker'
import type { QrDetection } from './scanner'

const size = 96
const detection = (data: string, x: number, y = 24, side = 24): QrDetection => ({
  data,
  location: {
    topLeftCorner: { x, y },
    topRightCorner: { x: x + side, y },
    bottomRightCorner: { x: x + side, y: y + side },
    bottomLeftCorner: { x, y: y + side },
  },
})

function patternedFrame(boxes: Array<{ x: number; y?: number; seed: number }>, at: number) {
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255)
  for (const { x, y = 24, seed } of boxes) {
    for (let row = 0; row < 24; row += 1) {
      for (let column = 0; column < 24; column += 1) {
        const dark = ((row * 7 + column * 11 + seed) % 17) < 8
        const index = ((y + row) * size + x + column) * 4
        pixels[index] = pixels[index + 1] = pixels[index + 2] = dark ? 15 : 235
        pixels[index + 3] = 255
      }
    }
  }
  return rgbaToVisualFrame(pixels, size, size, at)!
}

describe('identity-preserving visual object tracking', () => {
  it('tracks an identity through undecodable moving frames using image evidence', () => {
    const tracker = new VisualObjectTracker()
    tracker.anchor([detection('player-a', 12)], patternedFrame([{ x: 12, seed: 3 }], 0), 0)
    const [tracked] = tracker.update(patternedFrame([{ x: 20, seed: 3 }], 50), 50)
    expect(tracked.source).toBe('visual')
    expect(tracked.confidence).toBeGreaterThan(.78)
    expect(tracked.detection.data).toBe('player-a')
    expect(tracked.detection.location.topLeftCorner.x).toBeCloseTo(20, 0)
    expect(tracked.actionable).toBe(true)
  })

  it('decays and expires on missing evidence and stale decode anchors', () => {
    const tracker = new VisualObjectTracker()
    tracker.anchor([detection('player-a', 12)], patternedFrame([{ x: 12, seed: 3 }], 0), 0)
    expect(tracker.update(patternedFrame([], 40), 40)).toHaveLength(1)
    expect(tracker.update(patternedFrame([], 80), 80)).toHaveLength(0)

    tracker.anchor([detection('player-a', 12)], patternedFrame([{ x: 12, seed: 3 }], 100), 100)
    expect(tracker.update(
      patternedFrame([{ x: 12, seed: 3 }], 100 + VISUAL_TRACK_MAX_ANCHOR_AGE_MS + 1),
      100 + VISUAL_TRACK_MAX_ANCHOR_AGE_MS + 1,
    )).toHaveLength(0)
  })

  it('keeps older visual evidence visible but not action eligible', () => {
    const tracker = new VisualObjectTracker()
    tracker.anchor([detection('player-a', 12)], patternedFrame([{ x: 12, seed: 3 }], 0), 0)
    let tracked
    for (let now = 100; now <= 600; now += 100) {
      ;[tracked] = tracker.update(patternedFrame([{ x: 14, seed: 3 }], now), now)
    }
    ;[tracked] = tracker.update(
      patternedFrame([{ x: 14, seed: 3 }], VISUAL_ACTION_ANCHOR_AGE_MS + 1),
      VISUAL_ACTION_ANCHOR_AGE_MS + 1,
    )
    expect(tracked).toBeDefined()
    expect(tracked.actionable).toBe(false)
  })

  it('rejects ambiguous overlapping matches instead of swapping identities', () => {
    const tracker = new VisualObjectTracker()
    tracker.anchor(
      [detection('player-a', 22), detection('player-b', 46)],
      patternedFrame([{ x: 22, seed: 5 }, { x: 46, seed: 5 }], 0),
      0,
    )
    const tracked = tracker.update(patternedFrame([{ x: 34, seed: 5 }], 50), 50)
    expect(tracked).toEqual([])
  })

  it('re-anchors the decoded identity and does not invent fallback identities', () => {
    const tracker = new VisualObjectTracker()
    tracker.anchor([detection('player-a', 12)], patternedFrame([{ x: 12, seed: 3 }], 0), 0)
    tracker.update(patternedFrame([{ x: 20, seed: 3 }], 50), 50)
    tracker.anchor([detection('player-a', 30)], patternedFrame([{ x: 30, seed: 8 }], 100), 100)
    const observations = tracker.observations()
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({ source: 'decoded', confidence: 1, anchoredAt: 100 })
    expect(observations[0].detection.location.topLeftCorner.x).toBe(30)
  })

  it('drops an old identity when a different decoded identity occupies the same object', () => {
    const tracker = new VisualObjectTracker()
    tracker.anchor([detection('player-a', 12)], patternedFrame([{ x: 12, seed: 3 }], 0), 0)
    tracker.anchor([detection('player-b', 13)], patternedFrame([{ x: 13, seed: 8 }], 50), 50)
    expect(tracker.observations().map(({ detection: value }) => value.data))
      .toEqual(['player-b'])
  })

  it('scales coordinates without changing identity', () => {
    expect(scaleDetection(detection('player-a', 12), { width: 96, height: 96 }, {
      width: 192,
      height: 144,
    })).toEqual({
      data: 'player-a',
      location: {
        topLeftCorner: { x: 24, y: 36 },
        topRightCorner: { x: 72, y: 36 },
        bottomRightCorner: { x: 72, y: 72 },
        bottomLeftCorner: { x: 24, y: 72 },
      },
    })
  })
})
