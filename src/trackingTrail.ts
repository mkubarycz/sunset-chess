import type { QrDetection } from './scanner'
import type { MotionModel } from './planarTrackerGeometry'

export const TRACKING_TRAIL_AGE_MS = 900

export interface TrailPoint {
  identity: string
  detection: QrDetection
  at: number
  confidence: number
  model: MotionModel
}

export function updateTrail(
  trail: readonly TrailPoint[],
  point: TrailPoint | null,
  now: number,
): TrailPoint[] {
  const retained = trail.filter((item) => now - item.at <= TRACKING_TRAIL_AGE_MS)
  return point ? [...retained, point].slice(-30) : retained
}

export function trailForIdentity(
  trail: readonly TrailPoint[],
  identity: string,
  now: number,
): TrailPoint[] {
  return trail.filter((item) => item.identity === identity && now - item.at <= TRACKING_TRAIL_AGE_MS)
}
