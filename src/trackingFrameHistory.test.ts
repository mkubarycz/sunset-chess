import { describe, expect, it } from 'vitest'
import {
  registerAnchor,
  TRACKING_HISTORY_MAX_AGE_MS,
  TRACKING_HISTORY_MAX_BYTES,
  TRACKING_HISTORY_MAX_COUNT,
  TRACKING_REGISTRATION_TOLERANCE_MS,
  TrackingFrameHistory,
  type TrackingFrame,
} from './trackingFrameHistory'

const frame = (
  capturedAt: number,
  overrides: Partial<TrackingFrame> = {},
): TrackingFrame => ({
  generation: 1,
  capturedAt,
  width: 2,
  height: 2,
  tier: 'balanced',
  pixels: new Uint8ClampedArray(16),
  ...overrides,
})

describe('TrackingFrameHistory', () => {
  it('matches exact and nearest timestamps and rejects outside strict tolerance', () => {
    const history = new TrackingFrameHistory()
    history.add(frame(100))
    history.add(frame(120))
    expect(history.match(100, frame(0))).toMatchObject({ matched: true, deltaMs: 0 })
    expect(history.match(115, frame(0))).toMatchObject({ matched: true, deltaMs: 5 })
    expect(history.match(120 + TRACKING_REGISTRATION_TOLERANCE_MS + 1, frame(0)))
      .toEqual({ matched: false, reason: 'registration-tolerance' })
  })

  it('rejects generation, dimensions, and tier mismatches', () => {
    const history = new TrackingFrameHistory()
    history.add(frame(100))
    for (const compatible of [
      frame(0, { generation: 2 }),
      frame(0, { width: 3, pixels: new Uint8ClampedArray(24) }),
      frame(0, { tier: 'economy' }),
    ]) expect(history.match(100, compatible)).toEqual({
      matched: false, reason: 'no-compatible-frame',
    })
  })

  it('bounds count, time, and memory and clears on compatibility changes', () => {
    const history = new TrackingFrameHistory()
    for (let index = 0; index < TRACKING_HISTORY_MAX_COUNT + 4; index += 1) {
      history.add(frame(index * 20))
    }
    expect(history.stats().count).toBe(TRACKING_HISTORY_MAX_COUNT)
    history.add(frame(1_000))
    expect(history.stats().ageMs).toBeLessThanOrEqual(TRACKING_HISTORY_MAX_AGE_MS)

    const largeBytes = Math.floor(TRACKING_HISTORY_MAX_BYTES / 2)
    const largeWidth = largeBytes / 4
    const memoryHistory = new TrackingFrameHistory()
    memoryHistory.add(frame(1, {
      width: largeWidth, height: 1, pixels: new Uint8ClampedArray(largeBytes),
    }))
    memoryHistory.add(frame(2, {
      width: largeWidth, height: 1, pixels: new Uint8ClampedArray(largeBytes),
    }))
    memoryHistory.add(frame(3, {
      width: largeWidth, height: 1, pixels: new Uint8ClampedArray(largeBytes),
    }))
    expect(memoryHistory.stats().bytes).toBeLessThanOrEqual(TRACKING_HISTORY_MAX_BYTES)
    memoryHistory.add(frame(4, { generation: 2 }))
    expect(memoryHistory.stats()).toEqual({ count: 1, ageMs: 0, bytes: 16 })
    memoryHistory.clear()
    expect(memoryHistory.stats()).toEqual({ count: 0, ageMs: 0, bytes: 0 })
  })

  it('returns a chronological bounded replay from the registered source frame', () => {
    const history = new TrackingFrameHistory()
    ;[100, 120, 140].forEach((time) => history.add(frame(time)))
    const result = registerAnchor(history, {
      detection: {
        data: 'a',
        location: {
          topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: 1, y: 0 },
          bottomRightCorner: { x: 1, y: 1 }, bottomLeftCorner: { x: 0, y: 1 },
        },
      },
      capturedAt: 101,
      generation: 1,
      width: 2,
      height: 2,
      tier: 'balanced',
    })
    expect(result.matched && result.frames.map(({ capturedAt }) => capturedAt))
      .toEqual([100, 120, 140])
  })
})
