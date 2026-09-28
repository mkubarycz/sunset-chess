import type { Point, QrDetection } from './scanner'
import {
  TRACKING_ACTION_ANCHOR_MAX_AGE_MS,
  TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS,
  TRACKING_COAST_MS,
  TRACKING_EVIDENCE_MAX_AGE_MS,
} from './trackingPolicy'

export type TrackingPhase = 'tracking' | 'coasting' | 'lost'

export interface TrackingState {
  decodedAnchor: QrDetection | null
  target: QrDetection | null
  rendered: QrDetection | null
  velocity: Point
  decodedAt: number
  visualEvidenceAt: number
  renderedAt: number
  source: 'decoded' | 'visual'
  confidence: number
  actionable: boolean
}

export interface TrackingSample {
  state: TrackingState
  detection: QrDetection | null
  decodedAnchor: QrDetection | null
  phase: TrackingPhase
  source: 'decoded' | 'visual'
  confidence: number
  ageMs: number
  evidenceAgeMs: number
  actionable: boolean
  holdQualified: boolean
  expired: boolean
}

export { TRACKING_COAST_MS, TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS }
const SMOOTHING_TIME_MS = 45
const MAX_PREDICTION_MS = 90

export function emptyTrackingState(): TrackingState {
  return {
    decodedAnchor: null,
    target: null,
    rendered: null,
    velocity: { x: 0, y: 0 },
    decodedAt: 0,
    visualEvidenceAt: 0,
    renderedAt: 0,
    source: 'decoded',
    confidence: 0,
    actionable: false,
  }
}

function corners(detection: QrDetection): Point[] {
  return [
    detection.location.topLeftCorner,
    detection.location.topRightCorner,
    detection.location.bottomRightCorner,
    detection.location.bottomLeftCorner,
  ]
}

function mapDetection(detection: QrDetection, map: (point: Point) => Point): QrDetection {
  return {
    ...detection,
    location: {
      topLeftCorner: map(detection.location.topLeftCorner),
      topRightCorner: map(detection.location.topRightCorner),
      bottomRightCorner: map(detection.location.bottomRightCorner),
      bottomLeftCorner: map(detection.location.bottomLeftCorner),
    },
  }
}

export function observeDetection(
  state: TrackingState,
  detection: QrDetection,
  now: number,
): TrackingState {
  return {
    ...state,
    decodedAnchor: detection,
    decodedAt: now,
    actionable: state.source === 'visual' && state.actionable,
  }
}

export function observeVisualDetection(
  state: TrackingState,
  detection: QrDetection,
  now: number,
  confidence: number,
  actionable: boolean,
): TrackingState {
  return {
    ...state,
    target: detection,
    rendered: state.rendered ?? detection,
    renderedAt: state.renderedAt || now,
    visualEvidenceAt: now,
    source: 'visual',
    confidence,
    actionable,
    velocity: { x: 0, y: 0 },
  }
}

export function rejectVisualDetection(state: TrackingState): TrackingState {
  if (!state.decodedAnchor) return emptyTrackingState()
  return {
    ...state,
    visualEvidenceAt: Number.NEGATIVE_INFINITY,
    source: 'visual',
    confidence: 0,
    actionable: false,
  }
}

export function sampleTracking(state: TrackingState, now: number): TrackingSample {
  const evidenceAge = now - state.visualEvidenceAt
  const decodedAge = now - state.decodedAt
  if (!state.decodedAnchor || decodedAge > TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS) {
    return {
      state: emptyTrackingState(),
      detection: null,
      decodedAnchor: null,
      phase: 'lost',
      source: state.source,
      confidence: 0,
      ageMs: Math.max(0, decodedAge),
      evidenceAgeMs: Math.max(0, evidenceAge),
      actionable: false,
      holdQualified: false,
      expired: true,
    }
  }
  const age = Math.max(0, decodedAge)
  if (!state.target || !state.rendered) {
    return {
      state,
      detection: null,
      decodedAnchor: state.decodedAnchor,
      phase: 'lost',
      source: state.source,
      confidence: 0,
      ageMs: age,
      evidenceAgeMs: Number.POSITIVE_INFINITY,
      actionable: false,
      holdQualified: false,
      expired: false,
    }
  }
  const elapsed = Math.max(0, now - state.renderedAt)
  const predictionMs = Math.min(age, MAX_PREDICTION_MS)
  const predicted = mapDetection(state.target, (point) => ({
    x: point.x + state.velocity.x * predictionMs,
    y: point.y + state.velocity.y * predictionMs,
  }))
  const alpha = 1 - Math.exp(-elapsed / SMOOTHING_TIME_MS)
  const renderedPoints = corners(state.rendered)
  let index = 0
  const rendered = mapDetection(predicted, (point) => {
    const previous = renderedPoints[index++]
    return {
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
    }
  })
  return {
    state: { ...state, rendered, renderedAt: now },
    detection: evidenceAge <= TRACKING_EVIDENCE_MAX_AGE_MS ? rendered : null,
    decodedAnchor: state.decodedAnchor,
    phase: evidenceAge > TRACKING_EVIDENCE_MAX_AGE_MS
      ? 'lost'
      : evidenceAge > TRACKING_COAST_MS ? 'coasting' : 'tracking',
    source: state.source,
    confidence: state.confidence,
    ageMs: age,
    evidenceAgeMs: Math.max(0, evidenceAge),
    actionable: evidenceAge <= TRACKING_COAST_MS
      && decodedAge <= TRACKING_ACTION_ANCHOR_MAX_AGE_MS
      && state.actionable,
    holdQualified: evidenceAge <= TRACKING_COAST_MS
      && decodedAge <= TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS
      && (state.source === 'decoded' || state.confidence >= .78),
    expired: false,
  }
}

export interface CadenceState {
  startedAt: number
  cameraFrames: number
  decodes: number
  paints: number
}

export function cadenceRates(state: CadenceState, now: number) {
  const seconds = Math.max(0.001, (now - state.startedAt) / 1000)
  return {
    cameraFps: state.cameraFrames / seconds,
    decodeFps: state.decodes / seconds,
    paintFps: state.paints / seconds,
  }
}
