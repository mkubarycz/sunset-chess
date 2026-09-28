import { describe, expect, it } from 'vitest'
import {
  emptyTrackingState,
  decideDecodeReanchor,
  observeDetection,
  observeVisualDetection,
  rejectVisualDetection,
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
  it('smooths registered observations without predicting between evidence frames', () => {
    let state = observeDetection(emptyTrackingState(), detection(0), 100)
    state = observeVisualDetection(state, detection(0), 100, .9, true)
    state = observeVisualDetection(state, detection(20), 200, .9, true)
    const first = sampleTracking(state, 216)
    const second = sampleTracking(first.state, 232)
    expect(first.phase).toBe('tracking')
    expect(first.detection!.location.topLeftCorner.x).toBeGreaterThan(0)
    expect(second.detection!.location.topLeftCorner.x)
      .toBe(first.detection!.location.topLeftCorner.x)
    const coast = sampleTracking(second.state, 500)
    expect(coast.phase).toBe('coasting')
    expect(coast.detection!.location.topLeftCorner.x).toBeLessThan(50)
  })

  it('suppresses consistent decoder refreshes but forces material and stale reanchors', () => {
    let state = observeDetection(emptyTrackingState(), detection(10), 100)
    state = observeVisualDetection(state, detection(10), 100, .92, true)
    state = { ...state, lastReanchorAt: 100 }
    expect(decideDecodeReanchor(state, detection(10.5), 150, {
      registered: true,
      dimensionsAndGenerationMatch: true,
    })).toMatchObject({ reanchor: false, reason: 'consistent-refresh' })
    expect(decideDecodeReanchor(state, detection(80), 160, {
      registered: true,
      dimensionsAndGenerationMatch: true,
    })).toMatchObject({ reanchor: true, reason: 'material-disagreement' })
    expect(decideDecodeReanchor(state, detection(10), 400, {
      registered: true,
      dimensionsAndGenerationMatch: true,
    })).toMatchObject({ reanchor: true, reason: 'visual-evidence-stale' })
  })

  it('keeps identities independent and requires registration for a new anchor', () => {
    const first = observeVisualDetection(
      observeDetection(emptyTrackingState(), detection(10), 100),
      detection(10),
      100,
      .9,
      true,
    )
    const secondDetection = { ...detection(200), data: 'other-player' }
    const second = observeVisualDetection(
      observeDetection(emptyTrackingState(), secondDetection, 100),
      secondDetection,
      100,
      .9,
      true,
    )
    expect(first.stabilizer?.filtered.data).toBe('player')
    expect(second.stabilizer?.filtered.data).toBe('other-player')
    expect(decideDecodeReanchor(undefined, detection(10), 100, {
      registered: false,
      dimensionsAndGenerationMatch: true,
    })).toMatchObject({ reanchor: false, reason: 'new-identity' })
  })

  it('refreshes alternating decoder geometry without moving the stabilized current quad', () => {
    let state = observeDetection(emptyTrackingState(), detection(10), 100)
    state = observeVisualDetection(state, detection(10), 100, .94, true)
    state = { ...state, lastReanchorAt: 100 }
    const stabilized = state.stabilizer?.filtered
    for (let frame = 1; frame <= 8; frame += 1) {
      state = observeVisualDetection(state, detection(10), 95 + frame * 40, .94, true)
      const decoded = detection(10 + (frame % 2 ? .45 : -.45))
      const decision = decideDecodeReanchor(state, decoded, 100 + frame * 40, {
        registered: true,
        dimensionsAndGenerationMatch: true,
      })
      expect(decision.reason).toBe('consistent-refresh')
      state = observeDetection(state, decoded, 100 + frame * 40)
    }
    expect(state.decodedAt).toBe(420)
    expect(state.decodedAnchor).not.toEqual(detection(10))
    expect(state.stabilizer?.filtered).toEqual(stabilized)
  })

  it('forces periodic drift control, low-confidence, and dimension changes', () => {
    let state = observeVisualDetection(
      observeDetection(emptyTrackingState(), detection(10), 100),
      detection(10),
      100,
      .9,
      true,
    )
    state = { ...state, lastReanchorAt: 100 }
    expect(decideDecodeReanchor(state, detection(10), 2_601, {
      registered: true,
      dimensionsAndGenerationMatch: true,
    }).reason).toBe('visual-evidence-stale')
    expect(decideDecodeReanchor({ ...state, visualEvidenceAt: 2_590 }, detection(10), 2_601, {
      registered: true,
      dimensionsAndGenerationMatch: true,
    }).reason).toBe('periodic-drift-control')
    expect(decideDecodeReanchor({ ...state, confidence: .5 }, detection(10), 150, {
      registered: true,
      dimensionsAndGenerationMatch: true,
    }).reason).toBe('low-confidence')
    expect(decideDecodeReanchor(state, detection(10), 150, {
      registered: true,
      dimensionsAndGenerationMatch: false,
    }).reason).toBe('dimension-or-generation-change')
  })

  it('drops stale markers and snaps cleanly when reacquired', () => {
    const tracked = observeVisualDetection(
      observeDetection(emptyTrackingState(), detection(10), 100),
      detection(10),
      100,
      .9,
      true,
    )
    expect(sampleTracking(tracked, 100 + TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS + 1).phase).toBe('lost')
    const reacquired = observeDetection(
      tracked,
      detection(200),
      100 + TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS + 1,
    )
    expect(reacquired.decodedAnchor).toEqual(detection(200))
    expect(sampleTracking(reacquired, reacquired.decodedAt)).toMatchObject({
      detection: null,
      actionable: false,
      holdQualified: false,
    })
  })

  it('shows an unregistered decode only as a historical anchor and never advances holds', () => {
    const decoded = observeDetection(emptyTrackingState(), detection(10), 100)
    expect(sampleTracking(decoded, 120)).toMatchObject({
      decodedAnchor: detection(10),
      detection: null,
      actionable: false,
      holdQualified: false,
    })
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

  it('keeps the decoded anchor independent while accepted visual motion updates the object', () => {
    const decoded = observeDetection(emptyTrackingState(), detection(10), 100)
    const visual = observeVisualDetection(decoded, detection(90), 180, .9, true)
    expect(visual.decodedAnchor).toEqual(detection(10))
    expect(visual.target).toEqual(detection(90))
    const sample = sampleTracking(visual, 190)
    expect(sample.decodedAnchor).toEqual(detection(10))
    expect(sample.detection!.location.topLeftCorner.x).toBeGreaterThan(10)
    expect(sample.holdQualified).toBe(true)
  })

  it('hides a stale current object while retaining its bounded decoded anchor', () => {
    const decoded = observeDetection(emptyTrackingState(), detection(10), 100)
    const stale = sampleTracking(decoded, 551)
    expect(stale).toMatchObject({
      detection: null,
      decodedAnchor: detection(10),
      phase: 'lost',
      actionable: false,
      holdQualified: false,
      expired: false,
    })
    const expired = sampleTracking(decoded, 1_701)
    expect(expired.decodedAnchor).toBeNull()
    expect(expired.expired).toBe(true)
  })

  it('removes a rejected current box immediately without discarding its decoded anchor', () => {
    const decoded = observeDetection(emptyTrackingState(), detection(10), 100)
    const visual = observeVisualDetection(decoded, detection(40), 150, .9, true)
    const rejected = sampleTracking(rejectVisualDetection(visual), 160)
    expect(rejected.detection).toBeNull()
    expect(rejected.decodedAnchor).toEqual(detection(10))
    expect(rejected.expired).toBe(false)
  })
})
