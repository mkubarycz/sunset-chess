import type { QrDetection } from './scanner'
import {
  TRACKING_ACTION_ANCHOR_MAX_AGE_MS,
  TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS,
  TRACKING_MAX_FRAME_GAP_MS,
} from './trackingPolicy'

export const LK_MIN_SURVIVORS = 8
export const LK_MAX_ERROR = 24
export const LK_MAX_FORWARD_BACKWARD_PX = 1.5
export const LK_MIN_INLIER_RATIO = .65
export const LK_MIN_SCALE = .75
export const LK_MAX_SCALE = 1.3
export const LK_MAX_ROTATION_RADIANS = .7
export const LK_MAX_REPROJECTION_ERROR_PX = 2.5
export const LK_RESEED_BELOW = 20
export const LK_MIN_DISTRIBUTED_CELLS = 3
export const LK_AMBIGUITY_DISTANCE_RATIO = .7
export const LK_MIN_UI_CONFIDENCE = .52
export const LK_ACTION_CONFIDENCE = .82
export const LK_ACTION_ANCHOR_AGE_MS = TRACKING_ACTION_ANCHOR_MAX_AGE_MS
export const LK_TRACK_EXPIRY_MS = TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS
export const LK_MAX_FRAME_GAP_MS = TRACKING_MAX_FRAME_GAP_MS

export const OPTICAL_FLOW_POLICY = {
  minSurvivors: LK_MIN_SURVIVORS,
  maxError: LK_MAX_ERROR,
  maxForwardBackwardPx: LK_MAX_FORWARD_BACKWARD_PX,
  minInlierRatio: LK_MIN_INLIER_RATIO,
  minScale: LK_MIN_SCALE,
  maxScale: LK_MAX_SCALE,
  maxRotationRadians: LK_MAX_ROTATION_RADIANS,
  maxReprojectionErrorPx: LK_MAX_REPROJECTION_ERROR_PX,
  reseedBelow: LK_RESEED_BELOW,
  minDistributedCells: LK_MIN_DISTRIBUTED_CELLS,
  ambiguityDistanceRatio: LK_AMBIGUITY_DISTANCE_RATIO,
  minUiConfidence: LK_MIN_UI_CONFIDENCE,
  actionConfidence: LK_ACTION_CONFIDENCE,
  actionAnchorAgeMs: LK_ACTION_ANCHOR_AGE_MS,
  trackExpiryMs: LK_TRACK_EXPIRY_MS,
  maxFrameGapMs: LK_MAX_FRAME_GAP_MS,
} as const

export interface FlowValidation {
  originalCount: number
  survivors: number
  inliers: number
  meanError: number
  meanForwardBackward: number
  scale: number
  rotationRadians: number
}

export function validateFlow(sample: FlowValidation): {
  accepted: boolean
  confidence: number
} {
  const survival = sample.survivors / Math.max(1, sample.originalCount)
  const inlierRatio = sample.inliers / Math.max(1, sample.survivors)
  const confidence = Math.max(0, Math.min(1,
    survival * .3 + inlierRatio * .45
    + Math.max(0, 1 - sample.meanError / LK_MAX_ERROR) * .15
    + Math.max(0, 1 - sample.meanForwardBackward / LK_MAX_FORWARD_BACKWARD_PX) * .1,
  ))
  return {
    accepted: sample.survivors >= LK_MIN_SURVIVORS
      && inlierRatio >= LK_MIN_INLIER_RATIO
      && sample.meanError <= LK_MAX_ERROR
      && sample.meanForwardBackward <= LK_MAX_FORWARD_BACKWARD_PX
      && sample.scale >= LK_MIN_SCALE
      && sample.scale <= LK_MAX_SCALE
      && Math.abs(sample.rotationRadians) <= LK_MAX_ROTATION_RADIANS
      && confidence >= LK_MIN_UI_CONFIDENCE,
    confidence,
  }
}

function center(detection: QrDetection) {
  const points = Object.values(detection.location)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / 4,
    y: points.reduce((sum, point) => sum + point.y, 0) / 4,
  }
}

export function rejectAmbiguousTracks(detections: readonly QrDetection[]): QrDetection[] {
  const rejected = new Set<string>()
  for (let left = 0; left < detections.length; left += 1) {
    for (let right = left + 1; right < detections.length; right += 1) {
      const a = detections[left]
      const b = detections[right]
      const aPoints = Object.values(a.location)
      const bPoints = Object.values(b.location)
      const objectSize = Math.max(
        Math.hypot(aPoints[0].x - aPoints[1].x, aPoints[0].y - aPoints[1].y),
        Math.hypot(bPoints[0].x - bPoints[1].x, bPoints[0].y - bPoints[1].y),
      )
      const ac = center(a)
      const bc = center(b)
      if (Math.hypot(ac.x - bc.x, ac.y - bc.y) < objectSize * .7) {
        rejected.add(a.data)
        rejected.add(b.data)
      }
    }
  }
  return detections.filter(({ data }) => !rejected.has(data))
}

export function hasIdentityCrossing(
  previous: readonly QrDetection[],
  current: readonly QrDetection[],
): boolean {
  if (previous.length !== 2 || current.length !== 2) return false
  const old = new Map(previous.map((item) => [item.data, center(item)]))
  const next = new Map(current.map((item) => [item.data, center(item)]))
  const identities = [...old.keys()]
  if (identities.some((identity) => !next.has(identity))) return false
  const oldOrder = old.get(identities[0])!.x - old.get(identities[1])!.x
  const nextOrder = next.get(identities[0])!.x - next.get(identities[1])!.x
  return oldOrder !== 0 && nextOrder !== 0 && Math.sign(oldOrder) !== Math.sign(nextOrder)
}
