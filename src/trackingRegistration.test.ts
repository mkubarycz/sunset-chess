import { describe, expect, it } from 'vitest'
import { TrackingFrameHistory, registerAnchor } from './trackingFrameHistory'
import type { QrDetection } from './scanner'

const WIDTH = 32
const HEIGHT = 12
const PATCH = [
  1, 0, 1, 1,
  0, 1, 0, 0,
  1, 1, 0, 1,
  0, 0, 1, 0,
]

function pixels(patchX: number, distractorX: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const noise = ((x * 13 + y * 7 + distractorX) % 17) < 8 ? 55 : 185
      const index = (y * WIDTH + x) * 4
      result.fill(noise, index, index + 3)
      result[index + 3] = 255
    }
  }
  for (const originX of [patchX, distractorX]) {
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const index = ((4 + y) * WIDTH + originX + x) * 4
        result.fill(PATCH[y * 4 + x] ? 255 : 0, index, index + 3)
      }
    }
  }
  return result
}

function locatePatch(frame: Uint8ClampedArray, around: number): number {
  let winner = around
  let best = Number.POSITIVE_INFINITY
  for (let candidate = Math.max(0, around - 6); candidate <= Math.min(WIDTH - 4, around + 6); candidate += 1) {
    let error = 0
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const actual = frame[((4 + y) * WIDTH + candidate + x) * 4]
        const expected = PATCH[y * 4 + x] ? 255 : 0
        error += Math.abs(actual - expected)
      }
    }
    if (error < best) {
      best = error
      winner = candidate
    }
  }
  return winner
}

const detection = (x: number): QrDetection => ({
  data: 'piece',
  location: {
    topLeftCorner: { x, y: 4 }, topRightCorner: { x: x + 4, y: 4 },
    bottomRightCorner: { x: x + 4, y: 8 }, bottomLeftCorner: { x, y: 8 },
  },
})

describe('frame-registered moving patch', () => {
  it('replays delayed geometry forward instead of seeding it on current background', () => {
    const history = new TrackingFrameHistory()
    ;[
      { at: 100, patchX: 6, distractorX: 20 },
      { at: 140, patchX: 10, distractorX: 18 },
      { at: 180, patchX: 14, distractorX: 2 },
    ].forEach(({ at, patchX, distractorX }) => history.add({
      generation: 1,
      capturedAt: at,
      width: WIDTH,
      height: HEIGHT,
      tier: 'balanced',
      pixels: pixels(patchX, distractorX),
    }))

    const registered = registerAnchor(history, {
      detection: detection(6),
      capturedAt: 100,
      generation: 1,
      width: WIDTH,
      height: HEIGHT,
      tier: 'balanced',
    })
    if (!registered.matched) throw new Error(registered.reason)
    let x = 6
    for (const frame of registered.frames.slice(1)) x = locatePatch(frame.pixels, x + 4)

    const staleDirect = locatePatch(history.latest()!.pixels, 6)
    expect(staleDirect).toBeLessThan(6)
    expect(x).toBe(14)
    expect(x).toBeGreaterThan(6)
  })
})
