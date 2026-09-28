import { describe, expect, it } from 'vitest'
import {
  quadCenter,
  quadCornerRms,
  updateQuadStabilizer,
  type QuadStabilizerState,
} from './quadStabilizer'
import type { QrDetection } from './scanner'
import { checkInZoneRect, emptyCheckInState, updateCheckInZones } from './actionZones'

function detection(
  centerX: number,
  centerY: number,
  frame: number,
  noise = 0,
): QrDetection {
  const offsets = [
    [Math.sin(frame * 1.7), Math.cos(frame * 1.3)],
    [Math.cos(frame * 1.1), Math.sin(frame * 1.9)],
    [Math.sin(frame * .9), Math.cos(frame * 1.5)],
    [Math.cos(frame * 1.8), Math.sin(frame * 1.2)],
  ].map(([x, y]) => ({ x: x * noise, y: y * noise }))
  return {
    data: 'player-1',
    location: {
      topLeftCorner: { x: centerX - 50 + offsets[0].x, y: centerY - 50 + offsets[0].y },
      topRightCorner: { x: centerX + 50 + offsets[1].x, y: centerY - 50 + offsets[1].y },
      bottomRightCorner: { x: centerX + 50 + offsets[2].x, y: centerY + 50 + offsets[2].y },
      bottomLeftCorner: { x: centerX - 50 + offsets[3].x, y: centerY + 50 + offsets[3].y },
    },
  }
}

describe('adaptive quad stabilizer', () => {
  it('holds realistic stationary noise below the 960x540 jitter targets', () => {
    let state: QuadStabilizerState | null = null
    const centers: number[] = []
    const corners: number[] = []
    const truth = detection(480, 270, 0)
    for (let frame = 0; frame < 300; frame += 1) {
      const decoderOffset = frame % 47 === 0 ? 1.25 : 0
      state = updateQuadStabilizer(
        state,
        detection(480 + decoderOffset, 270 - decoderOffset / 2, frame, 2),
        frame * (1000 / 60),
      )
      if (frame >= 120) {
        const center = quadCenter(state.filtered)
        centers.push(Math.hypot(center.x - 480, center.y - 270))
        corners.push(quadCornerRms(state.filtered, truth))
      }
    }
    const rms = (values: number[]) =>
      Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
    expect(state?.motion).toBe('stationary')
    expect(rms(centers)).toBeLessThanOrEqual(.35)
    expect(rms(corners)).toBeLessThanOrEqual(.6)
  })

  it('responds to a one-width ramp within 160ms without material overshoot', () => {
    let state: QuadStabilizerState | null = null
    for (let frame = 0; frame < 30; frame += 1) {
      state = updateQuadStabilizer(state, detection(300, 270, frame, .8), frame * 16)
    }
    const startedAt = 30 * 16
    let reachedAt = Number.POSITIVE_INFINITY
    let maximum = 0
    for (let frame = 0; frame < 30; frame += 1) {
      const elapsed = frame * 16
      const progress = Math.min(1, elapsed / 320)
      const measured = 300 + progress * 100
      state = updateQuadStabilizer(
        state,
        detection(measured, 270, frame + 30, .4),
        startedAt + elapsed,
      )
      const filtered = quadCenter(state.filtered).x
      maximum = Math.max(maximum, filtered)
      if (progress === 1 && filtered >= 385 && !Number.isFinite(reachedAt)) {
        reachedAt = elapsed - 320
      }
    }
    expect(reachedAt).toBeLessThanOrEqual(160)
    expect(maximum).toBeLessThan(402)
  })

  it('tracks slow motion continuously rather than stair-stepping a hard deadband', () => {
    let state: QuadStabilizerState | null = null
    const positions: number[] = []
    for (let frame = 0; frame < 120; frame += 1) {
      state = updateQuadStabilizer(
        state,
        detection(300 + frame * .35, 270, frame, .2),
        frame * 16,
      )
      if (frame > 40) positions.push(quadCenter(state.filtered).x)
    }
    const movingSteps = positions.slice(1)
      .filter((value, index) => value - positions[index] > .02)
    expect(movingSteps.length).toBeGreaterThan(positions.length * .8)
    expect(positions.at(-1)! - positions[0]).toBeGreaterThan(20)
  })

  it('keeps a held zone occupant and progress stable under boundary jitter', () => {
    const zone = checkInZoneRect(960, 540, 'left')
    let stabilizer: QuadStabilizerState | null = null
    let checkIn = emptyCheckInState()
    let occupantKey: string | null = null
    let churn = 0
    for (let frame = 0; frame < 180; frame += 1) {
      const raw = detection(zone.x + 4, zone.y + zone.height / 2, frame, frame ? 2 : 0)
      stabilizer = updateQuadStabilizer(stabilizer, raw, frame * (1000 / 60))
      const update = updateCheckInZones(checkIn, [{
        playerId: 1,
        name: 'Held player',
        detection: stabilizer.filtered,
      }], 960, 540, frame * (1000 / 60), {
        freshPlayerIds: new Set([1]),
      })
      checkIn = update.state
      if (occupantKey && checkIn.occupantKey !== occupantKey) churn += 1
      occupantKey = checkIn.occupantKey
    }
    expect(churn).toBe(0)
    expect(checkIn.occupant?.playerId).toBe(1)
    expect(checkIn.hold.completed).toBe(true)
  })
})
