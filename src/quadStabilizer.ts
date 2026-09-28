import type { Point, QrDetection } from './scanner'

export type StabilizerMotion = 'moving' | 'stationary'

export interface QuadStabilizerState {
  filtered: QrDetection
  raw: QrDetection
  updatedAt: number
  motion: StabilizerMotion
  stationaryFrames: number
  normalizedSpeed: number
  cutoffHz: number
  gain: number
  rawFilteredDeltaPx: number
}

export const QUAD_STABILIZER_POLICY = {
  stationaryEnterCenterRatio: .02,
  stationaryEnterShapeRatio: .035,
  stationaryExitCenterRatio: .04,
  stationaryExitCornerRatio: .055,
  stationaryResidualExitRatio: .025,
  stationaryEnterFrames: 5,
  stationaryCutoffHz: .55,
  movingBaseCutoffHz: 4,
  speedCutoffScale: 5,
  movingMaxCutoffHz: 24,
  stationaryDeadbandRatio: .003,
  snapDisplacementRatio: .35,
} as const

export function quadCorners(detection: QrDetection): Point[] {
  return [
    detection.location.topLeftCorner,
    detection.location.topRightCorner,
    detection.location.bottomRightCorner,
    detection.location.bottomLeftCorner,
  ]
}

export function quadCenter(detection: QrDetection): Point {
  return quadCorners(detection).reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  )
}

export function quadArea(detection: QrDetection): number {
  const points = quadCorners(detection)
  return Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length]
    return total + point.x * next.y - next.x * point.y
  }, 0) / 2)
}

export function quadObjectSize(detection: QrDetection): number {
  return Math.max(1, Math.sqrt(quadArea(detection)))
}

function interpolateDetection(
  previous: QrDetection,
  next: QrDetection,
  gain: number,
): QrDetection {
  const before = quadCorners(previous)
  const after = quadCorners(next)
  const points = after.map((point, index) => ({
    x: before[index].x + (point.x - before[index].x) * gain,
    y: before[index].y + (point.y - before[index].y) * gain,
  }))
  return {
    ...next,
    location: {
      topLeftCorner: points[0],
      topRightCorner: points[1],
      bottomRightCorner: points[2],
      bottomLeftCorner: points[3],
    },
  }
}

function centerDistance(left: QrDetection, right: QrDetection): number {
  const a = quadCenter(left)
  const b = quadCenter(right)
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function quadCornerRms(left: QrDetection, right: QrDetection): number {
  const a = quadCorners(left)
  const b = quadCorners(right)
  return Math.sqrt(a.reduce((sum, point, index) => {
    const dx = point.x - b[index].x
    const dy = point.y - b[index].y
    return sum + dx * dx + dy * dy
  }, 0) / 4)
}

function shapeRms(left: QrDetection, right: QrDetection): number {
  const aCenter = quadCenter(left)
  const bCenter = quadCenter(right)
  const a = quadCorners(left)
  const b = quadCorners(right)
  return Math.sqrt(a.reduce((sum, point, index) => {
    const dx = (point.x - aCenter.x) - (b[index].x - bCenter.x)
    const dy = (point.y - aCenter.y) - (b[index].y - bCenter.y)
    return sum + dx * dx + dy * dy
  }, 0) / 4)
}

function lowPassGain(cutoffHz: number, elapsedSeconds: number): number {
  return 1 - Math.exp(-2 * Math.PI * cutoffHz * elapsedSeconds)
}

export function updateQuadStabilizer(
  previous: QuadStabilizerState | null,
  measurement: QrDetection,
  measuredAt: number,
): QuadStabilizerState {
  if (!previous || previous.filtered.data !== measurement.data || measuredAt <= previous.updatedAt) {
    return {
      filtered: measurement,
      raw: measurement,
      updatedAt: measuredAt,
      motion: 'moving',
      stationaryFrames: 0,
      normalizedSpeed: 0,
      cutoffHz: QUAD_STABILIZER_POLICY.movingMaxCutoffHz,
      gain: 1,
      rawFilteredDeltaPx: 0,
    }
  }

  const elapsedSeconds = Math.max(.001, Math.min(.25, (measuredAt - previous.updatedAt) / 1000))
  const objectSize = quadObjectSize(previous.filtered)
  const rawCenterRatio = centerDistance(previous.raw, measurement) / objectSize
  const rawShapeRatio = shapeRms(previous.raw, measurement) / objectSize
  const filteredCenterRatio = centerDistance(previous.filtered, measurement) / objectSize
  const filteredCornerRatio = quadCornerRms(previous.filtered, measurement) / objectSize
  const normalizedSpeed = rawCenterRatio / elapsedSeconds
  const quiet = rawCenterRatio <= QUAD_STABILIZER_POLICY.stationaryEnterCenterRatio
    && rawShapeRatio <= QUAD_STABILIZER_POLICY.stationaryEnterShapeRatio
  let stationaryFrames = quiet ? previous.stationaryFrames + 1 : 0
  let motion = previous.motion

  if (
    motion === 'stationary'
    && (
      rawCenterRatio > QUAD_STABILIZER_POLICY.stationaryExitCenterRatio
      || filteredCornerRatio > QUAD_STABILIZER_POLICY.stationaryExitCornerRatio
      || filteredCenterRatio > QUAD_STABILIZER_POLICY.stationaryResidualExitRatio
    )
  ) {
    motion = 'moving'
    stationaryFrames = 0
  } else if (
    motion === 'moving'
    && stationaryFrames >= QUAD_STABILIZER_POLICY.stationaryEnterFrames
  ) {
    motion = 'stationary'
  }

  const snap = filteredCenterRatio >= QUAD_STABILIZER_POLICY.snapDisplacementRatio
  const cutoffHz = motion === 'stationary'
    ? QUAD_STABILIZER_POLICY.stationaryCutoffHz
    : Math.min(
        QUAD_STABILIZER_POLICY.movingMaxCutoffHz,
        QUAD_STABILIZER_POLICY.movingBaseCutoffHz
          + normalizedSpeed * QUAD_STABILIZER_POLICY.speedCutoffScale,
      )
  const rawFilteredDeltaPx = quadCornerRms(previous.filtered, measurement)
  const deadband = motion === 'stationary'
    && rawFilteredDeltaPx <= objectSize * QUAD_STABILIZER_POLICY.stationaryDeadbandRatio
  const gain = snap ? 1 : deadband ? 0 : lowPassGain(cutoffHz, elapsedSeconds)
  const filtered = interpolateDetection(previous.filtered, measurement, gain)

  return {
    filtered,
    raw: measurement,
    updatedAt: measuredAt,
    motion,
    stationaryFrames,
    normalizedSpeed,
    cutoffHz,
    gain,
    rawFilteredDeltaPx: quadCornerRms(filtered, measurement),
  }
}
