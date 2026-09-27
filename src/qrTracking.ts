import type { Point, QrDetection } from './scanner'

export type TrackingPhase = 'tracking' | 'coasting' | 'lost'

export interface TrackingState {
  target: QrDetection | null
  rendered: QrDetection | null
  velocity: Point
  detectedAt: number
  renderedAt: number
}

export interface TrackingSample {
  state: TrackingState
  detection: QrDetection | null
  phase: TrackingPhase
}

export const TRACKING_COAST_MS = 180
export const TRACKING_LOST_MS = 900
const SMOOTHING_TIME_MS = 75
const MAX_PREDICTION_MS = 90
const MAX_SPEED_PX_PER_MS = 2

export function emptyTrackingState(): TrackingState {
  return {
    target: null,
    rendered: null,
    velocity: { x: 0, y: 0 },
    detectedAt: 0,
    renderedAt: 0,
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

function center(detection: QrDetection): Point {
  const points = corners(detection)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
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
  const gap = now - state.detectedAt
  if (!state.target || !state.rendered || gap > TRACKING_LOST_MS) {
    return {
      target: detection,
      rendered: detection,
      velocity: { x: 0, y: 0 },
      detectedAt: now,
      renderedAt: now,
    }
  }
  const oldCenter = center(state.target)
  const newCenter = center(detection)
  const elapsed = Math.max(1, gap)
  const clamp = (value: number) =>
    Math.max(-MAX_SPEED_PX_PER_MS, Math.min(MAX_SPEED_PX_PER_MS, value))
  return {
    ...state,
    target: detection,
    velocity: {
      x: clamp((newCenter.x - oldCenter.x) / elapsed),
      y: clamp((newCenter.y - oldCenter.y) / elapsed),
    },
    detectedAt: now,
  }
}

export function sampleTracking(state: TrackingState, now: number): TrackingSample {
  if (!state.target || !state.rendered || now - state.detectedAt > TRACKING_LOST_MS) {
    return { state: emptyTrackingState(), detection: null, phase: 'lost' }
  }
  const age = Math.max(0, now - state.detectedAt)
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
    detection: rendered,
    phase: age > TRACKING_COAST_MS ? 'coasting' : 'tracking',
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
