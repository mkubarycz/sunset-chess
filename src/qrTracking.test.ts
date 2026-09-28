import { describe, expect, it } from 'vitest'
import {
  emptyTrackingState,
  observeDetection,
  observeVisualDetection,
  sampleTracking,
  TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS,
} from './qrTracking'
import type { QrDetection } from './scanner'

const detection = (x: number): QrDetection => ({
  data: 'player',
  location: {
    topLeftCorner: { x, y: 0 },
    topRightCorner: { x: x + 10, y: 0 },
    bottomRightCorner: { x: x + 10, y: 10 },
    bottomLeftCorner: { x, y: 10 },
  },
})

describe('QR visual tracking', () => {
  it('smooths motion between decoder observations and predicts with a bounded horizon', () => {
    let state = observeDetection(emptyTrackingState(), detection(0), 100)
    state = observeDetection(state, detection(20), 200)
    const first = sampleTracking(state, 216)
    const second = sampleTracking(first.state, 232)
    expect(first.phase).toBe('tracking')
    expect(first.detection!.location.topLeftCorner.x).toBeGreaterThan(0)
    expect(second.detection!.location.topLeftCorner.x)
      .toBeGreaterThan(first.detection!.location.topLeftCorner.x)
    const coast = sampleTracking(second.state, 500)
    expect(coast.phase).toBe('coasting')
    expect(coast.detection!.location.topLeftCorner.x).toBeLessThan(50)
  })

  it('drops stale markers and snaps cleanly when reacquired', () => {
    const tracked = observeDetection(emptyTrackingState(), detection(10), 100)
    expect(sampleTracking(tracked, 100 + TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS + 1).phase).toBe('lost')
    const reacquired = observeDetection(
      tracked,
      detection(200),
      100 + TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS + 1,
    )
    expect(reacquired.rendered).toEqual(detection(200))
    expect(reacquired.velocity).toEqual({ x: 0, y: 0 })
  })

  it('bridges past 900ms on fresh visual evidence but expires authority and the hard TTL', () => {
    let state = observeDetection(emptyTrackingState(), detection(10), 100)
    for (let now = 200; now <= 1_100; now += 100) {
      state = observeVisualDetection(state, detection(10 + now / 100), now, .9, true)
    }
    expect(sampleTracking(state, 1_110)).toMatchObject({
      phase: 'tracking',
      actionable: false,
      ageMs: 1_010,
    })
    expect(sampleTracking(
      observeVisualDetection(state, detection(30), 1_690, .9, true),
      1_701,
    ).phase).toBe('lost')
  })

  it('exposes visual source, confidence, age, and conservative action eligibility', () => {
    const decoded = observeDetection(emptyTrackingState(), detection(10), 100)
    const visual = observeVisualDetection(decoded, detection(18), 150, .84, true)
    expect(sampleTracking(visual, 160)).toMatchObject({
      source: 'visual',
      confidence: .84,
      ageMs: 60,
      actionable: true,
    })

    const uncertain = observeVisualDetection(visual, detection(20), 180, .55, false)
    const sample = sampleTracking(uncertain, 190)
    expect(sample.detection?.data).toBe('player')
    expect(sample.actionable).toBe(false)
  })
})
