import type { Point, QrDetection } from './scanner'
import {
  TRACKING_ACTION_ANCHOR_MAX_AGE_MS,
  TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS,
  TRACKING_COAST_MS,
  TRACKING_EVIDENCE_MAX_AGE_MS,
} from './trackingPolicy'
import {
  quadArea,
  quadCenter,
  quadCornerRms,
  quadCorners,
  quadObjectSize,
  updateQuadStabilizer,
  type QuadStabilizerState,
  type StabilizerMotion,
} from './quadStabilizer'

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
  stabilizer: QuadStabilizerState | null
  lastReanchorAt: number
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
  stabilization: {
    motion: StabilizerMotion
    raw: QrDetection | null
    filtered: QrDetection | null
    rawFilteredDeltaPx: number
    normalizedSpeed: number
    cutoffHz: number
    gain: number
  }
}

export { TRACKING_COAST_MS, TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS }
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
    stabilizer: null,
    lastReanchorAt: 0,
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
  const stabilizer = updateQuadStabilizer(state.stabilizer, detection, now)
  return {
    ...state,
    target: detection,
    rendered: stabilizer.filtered,
    renderedAt: now,
    visualEvidenceAt: now,
    source: 'visual',
    confidence,
    actionable: actionable || confidence >= .78,
    velocity: { x: 0, y: 0 },
    stabilizer,
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
      stabilization: stabilizationDiagnostics(state),
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
      stabilization: stabilizationDiagnostics(state),
    }
  }
  const rendered = state.stabilizer?.filtered ?? state.rendered
  return {
    state: { ...state, rendered },
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
    stabilization: stabilizationDiagnostics(state),
  }
}

function stabilizationDiagnostics(state: TrackingState): TrackingSample['stabilization'] {
  const stabilizer = state.stabilizer
  return {
    motion: stabilizer?.motion ?? 'moving',
    raw: stabilizer?.raw ?? state.target,
    filtered: stabilizer?.filtered ?? state.rendered,
    rawFilteredDeltaPx: stabilizer?.rawFilteredDeltaPx ?? 0,
    normalizedSpeed: stabilizer?.normalizedSpeed ?? 0,
    cutoffHz: stabilizer?.cutoffHz ?? 0,
    gain: stabilizer?.gain ?? 0,
  }
}

export const DECODE_REANCHOR_POLICY = {
  minimumConfidence: .78,
  maximumEvidenceAgeMs: 180,
  periodicDriftControlMs: 2_500,
  maximumCenterRatio: .06,
  minimumIou: .72,
  maximumCornerRmsRatio: .08,
  minimumAreaRatio: .8,
  maximumAreaRatio: 1.25,
  minimumAspectRatio: .85,
  maximumAspectRatio: 1.18,
} as const

export type DecodeReanchorReason =
  | 'new-identity'
  | 'visual-evidence-stale'
  | 'visual-evidence-rejected'
  | 'low-confidence'
  | 'material-disagreement'
  | 'periodic-drift-control'
  | 'dimension-or-generation-change'
  | 'consistent-refresh'
  | 'unregistered-refresh'

export interface DecodeReanchorDecision {
  reanchor: boolean
  reason: DecodeReanchorReason
  metrics: {
    centerRatio: number
    iou: number
    cornerRmsRatio: number
    areaRatio: number
    aspectRatio: number
  } | null
}

function bounds(detection: QrDetection) {
  const points = quadCorners(detection)
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    left,
    top,
    width: Math.max(1, Math.max(...xs) - left),
    height: Math.max(1, Math.max(...ys) - top),
  }
}

function boxIou(left: ReturnType<typeof bounds>, right: ReturnType<typeof bounds>): number {
  const x = Math.max(left.left, right.left)
  const y = Math.max(left.top, right.top)
  const width = Math.max(0, Math.min(left.left + left.width, right.left + right.width) - x)
  const height = Math.max(0, Math.min(left.top + left.height, right.top + right.height) - y)
  const intersection = width * height
  return intersection / Math.max(
    1,
    left.width * left.height + right.width * right.height - intersection,
  )
}

export function decideDecodeReanchor(
  state: TrackingState | undefined,
  decoded: QrDetection,
  capturedAt: number,
  options: { registered: boolean; dimensionsAndGenerationMatch: boolean },
): DecodeReanchorDecision {
  if (!state?.target || !state.stabilizer) {
    return { reanchor: options.registered, reason: 'new-identity', metrics: null }
  }
  if (!options.dimensionsAndGenerationMatch) {
    return { reanchor: options.registered, reason: 'dimension-or-generation-change', metrics: null }
  }
  if (!Number.isFinite(state.visualEvidenceAt)) {
    return { reanchor: options.registered, reason: 'visual-evidence-rejected', metrics: null }
  }
  if (capturedAt - state.visualEvidenceAt > DECODE_REANCHOR_POLICY.maximumEvidenceAgeMs) {
    return { reanchor: options.registered, reason: 'visual-evidence-stale', metrics: null }
  }
  if (state.confidence < DECODE_REANCHOR_POLICY.minimumConfidence) {
    return { reanchor: options.registered, reason: 'low-confidence', metrics: null }
  }
  if (capturedAt - state.lastReanchorAt >= DECODE_REANCHOR_POLICY.periodicDriftControlMs) {
    return { reanchor: options.registered, reason: 'periodic-drift-control', metrics: null }
  }

  const tracked = state.stabilizer.filtered
  const trackedCenter = quadCenter(tracked)
  const decodedCenter = quadCenter(decoded)
  const size = quadObjectSize(tracked)
  const trackedBounds = bounds(tracked)
  const decodedBounds = bounds(decoded)
  const trackedArea = quadArea(tracked)
  const decodedArea = quadArea(decoded)
  const metrics = {
    centerRatio: Math.hypot(
      trackedCenter.x - decodedCenter.x,
      trackedCenter.y - decodedCenter.y,
    ) / size,
    iou: boxIou(trackedBounds, decodedBounds),
    cornerRmsRatio: quadCornerRms(tracked, decoded) / size,
    areaRatio: decodedArea / Math.max(1, trackedArea),
    aspectRatio: (decodedBounds.width / decodedBounds.height)
      / (trackedBounds.width / trackedBounds.height),
  }
  const consistent = metrics.centerRatio <= DECODE_REANCHOR_POLICY.maximumCenterRatio
    && metrics.iou >= DECODE_REANCHOR_POLICY.minimumIou
    && metrics.cornerRmsRatio <= DECODE_REANCHOR_POLICY.maximumCornerRmsRatio
    && metrics.areaRatio >= DECODE_REANCHOR_POLICY.minimumAreaRatio
    && metrics.areaRatio <= DECODE_REANCHOR_POLICY.maximumAreaRatio
    && metrics.aspectRatio >= DECODE_REANCHOR_POLICY.minimumAspectRatio
    && metrics.aspectRatio <= DECODE_REANCHOR_POLICY.maximumAspectRatio
  if (consistent) {
    return {
      reanchor: false,
      reason: options.registered ? 'consistent-refresh' : 'unregistered-refresh',
      metrics,
    }
  }
  return { reanchor: options.registered, reason: 'material-disagreement', metrics }
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
