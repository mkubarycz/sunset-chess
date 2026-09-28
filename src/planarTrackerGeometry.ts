import type { Point, QrDetection } from './scanner'

export type MotionModel = 'homography' | 'affine' | 'similarity' | 'none'
export type Matrix3 = [number, number, number, number, number, number, number, number, number]

export interface FeaturePoint extends Point {
  cell: number
  inside: boolean
}

export interface PlanarFit {
  model: Exclude<MotionModel, 'none'>
  matrix: Matrix3
  inliers: number[]
  meanReprojectionError: number
  candidateErrors: Partial<Record<Exclude<MotionModel, 'none'>, number>>
  selectedReason: string
}

export interface GeometryPolicy {
  maxReprojectionErrorPx: number
  minInlierRatio: number
  minQuadAreaPx: number
  maxAreaRatio: number
  maxEdgeRatioChange: number
  maxProjectiveTerm: number
  maxDisplacementRatio: number
  maxAccelerationRatio: number
}

export const PLANAR_GEOMETRY_POLICY: GeometryPolicy = {
  maxReprojectionErrorPx: 2.5,
  minInlierRatio: .62,
  minQuadAreaPx: 64,
  maxAreaRatio: 1.8,
  maxEdgeRatioChange: 1.75,
  maxProjectiveTerm: .35,
  maxDisplacementRatio: 1.4,
  maxAccelerationRatio: 1,
}

export const MODEL_SELECTION_POLICY = {
  absoluteImprovementPx: .18,
  relativeImprovement: .15,
  maximumInlierDeficit: .08,
} as const

export function detectionCorners(detection: QrDetection): Point[] {
  return [
    detection.location.topLeftCorner,
    detection.location.topRightCorner,
    detection.location.bottomRightCorner,
    detection.location.bottomLeftCorner,
  ]
}

export function polygonArea(points: readonly Point[]): number {
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    total += points[index].x * next.y - next.x * points[index].y
  }
  return total / 2
}

export function pointInConvexQuad(point: Point, quad: readonly Point[]): boolean {
  if (quad.length !== 4) return false
  let sign = 0
  for (let index = 0; index < 4; index += 1) {
    const a = quad[index]
    const b = quad[(index + 1) % 4]
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (Math.abs(cross) < 1e-7) continue
    const current = Math.sign(cross)
    if (sign && current !== sign) return false
    sign = current
  }
  return sign !== 0
}

export function shrinkQuad(quad: readonly Point[], fraction = .9): Point[] {
  const center = quad.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  )
  return quad.map((point) => ({
    x: center.x + (point.x - center.x) * fraction,
    y: center.y + (point.y - center.y) * fraction,
  }))
}

export function distributeFeatures(
  candidates: readonly Point[],
  quad: readonly Point[],
  maxCount = 48,
  gridSize = 3,
): FeaturePoint[] {
  const mask = shrinkQuad(quad)
  const xs = quad.map(({ x }) => x)
  const ys = quad.map(({ y }) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const width = Math.max(1, Math.max(...xs) - minX)
  const height = Math.max(1, Math.max(...ys) - minY)
  const buckets = Array.from({ length: gridSize * gridSize }, () => [] as FeaturePoint[])
  for (const point of candidates) {
    if (!pointInConvexQuad(point, mask)) continue
    const column = Math.min(gridSize - 1, Math.max(0, Math.floor((point.x - minX) / width * gridSize)))
    const row = Math.min(gridSize - 1, Math.max(0, Math.floor((point.y - minY) / height * gridSize)))
    buckets[row * gridSize + column].push({ ...point, cell: row * gridSize + column, inside: true })
  }
  const selected: FeaturePoint[] = []
  const perCell = Math.max(1, Math.ceil(maxCount / buckets.length))
  for (let offset = 0; offset < perCell; offset += 1) {
    for (const bucket of buckets) {
      if (bucket[offset] && selected.length < maxCount) selected.push(bucket[offset])
    }
  }
  return selected
}

function solve(matrix: number[][], values: number[]): number[] | null {
  const size = values.length
  const augmented = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null
    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item]
      }
    }
  }
  return augmented.map((row) => row[size])
}

function leastSquares(rows: number[][], values: number[], columns: number): number[] | null {
  const normal = Array.from({ length: columns }, () => Array(columns).fill(0))
  const right = Array(columns).fill(0)
  for (let row = 0; row < rows.length; row += 1) {
    for (let left = 0; left < columns; left += 1) {
      right[left] += rows[row][left] * values[row]
      for (let column = 0; column < columns; column += 1) {
        normal[left][column] += rows[row][left] * rows[row][column]
      }
    }
  }
  return solve(normal, right)
}

function fitModel(
  model: Exclude<MotionModel, 'none'>,
  from: readonly Point[],
  to: readonly Point[],
  indices: readonly number[],
): Matrix3 | null {
  if (model === 'similarity') {
    let fx = 0; let fy = 0; let tx = 0; let ty = 0
    indices.forEach((index) => {
      fx += from[index].x; fy += from[index].y; tx += to[index].x; ty += to[index].y
    })
    fx /= indices.length; fy /= indices.length; tx /= indices.length; ty /= indices.length
    let denominator = 0; let real = 0; let imaginary = 0
    indices.forEach((index) => {
      const x = from[index].x - fx; const y = from[index].y - fy
      const u = to[index].x - tx; const v = to[index].y - ty
      denominator += x * x + y * y
      real += x * u + y * v
      imaginary += x * v - y * u
    })
    if (denominator < 1) return null
    const a = real / denominator; const b = imaginary / denominator
    return [a, -b, tx - a * fx + b * fy, b, a, ty - b * fx - a * fy, 0, 0, 1]
  }
  const rows: number[][] = []
  const values: number[] = []
  for (const index of indices) {
    const { x, y } = from[index]
    const { x: u, y: v } = to[index]
    if (model === 'affine') {
      rows.push([x, y, 1, 0, 0, 0], [0, 0, 0, x, y, 1])
      values.push(u, v)
    } else {
      rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
      rows.push([0, 0, 0, x, y, 1, -v * x, -v * y])
      values.push(u, v)
    }
  }
  const solved = leastSquares(rows, values, model === 'affine' ? 6 : 8)
  if (!solved) return null
  return model === 'affine'
    ? [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], 0, 0, 1]
    : [...solved, 1] as Matrix3
}

export function applyMatrix(matrix: Matrix3, point: Point): Point {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  }
}

function samples(count: number, size: number): number[][] {
  const output: number[][] = []
  const limit = Math.min(96, count * count)
  for (let seed = 0; seed < limit; seed += 1) {
    const sample: number[] = []
    let value = (seed + 1) * 2654435761
    while (sample.length < size) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0
      const index = value % count
      if (!sample.includes(index)) sample.push(index)
    }
    output.push(sample)
  }
  return output
}

export function robustPlanarFit(
  from: readonly Point[],
  to: readonly Point[],
  cells: readonly number[],
  threshold = PLANAR_GEOMETRY_POLICY.maxReprojectionErrorPx,
): PlanarFit | null {
  if (from.length !== to.length) return null
  const uniqueCells = new Set(cells).size
  const candidates: Array<{ model: Exclude<MotionModel, 'none'>; minimum: number }> = []
  if (from.length >= 4 && uniqueCells >= 2) candidates.push({ model: 'similarity', minimum: 2 })
  if (from.length >= 6 && uniqueCells >= 3) candidates.push({ model: 'affine', minimum: 3 })
  if (from.length >= 10 && uniqueCells >= 4) candidates.push({ model: 'homography', minimum: 4 })
  const valid: PlanarFit[] = []
  for (const { model, minimum } of candidates) {
    let best: { matrix: Matrix3; inliers: number[]; error: number } | null = null
    for (const sample of samples(from.length, minimum)) {
      const matrix = fitModel(model, from, to, sample)
      if (!matrix) continue
      const residuals = from.map((point, index) => {
        const mapped = applyMatrix(matrix, point)
        return Math.hypot(mapped.x - to[index].x, mapped.y - to[index].y)
      })
      const inliers = residuals.flatMap((error, index) => error <= threshold ? [index] : [])
      const error = inliers.reduce((sum, index) => sum + residuals[index], 0) / Math.max(1, inliers.length)
      if (!best || inliers.length > best.inliers.length
        || (inliers.length === best.inliers.length && error < best.error)) {
        best = { matrix, inliers, error }
      }
    }
    if (!best || best.inliers.length < Math.max(minimum, Math.ceil(from.length * .62))) continue
    const refined = fitModel(model, from, to, best.inliers)
    if (!refined) continue
    const errors = best.inliers.map((index) => {
      const mapped = applyMatrix(refined, from[index])
      return Math.hypot(mapped.x - to[index].x, mapped.y - to[index].y)
    })
    valid.push({
      model,
      matrix: refined,
      inliers: best.inliers,
      meanReprojectionError: errors.reduce((sum, value) => sum + value, 0) / errors.length,
      candidateErrors: {},
      selectedReason: '',
    })
  }
  if (valid.length === 0) return null
  const candidateErrors = Object.fromEntries(
    valid.map((candidate) => [candidate.model, candidate.meanReprojectionError]),
  ) as PlanarFit['candidateErrors']
  let selected = valid[0]
  const decisions: string[] = [`${selected.model} baseline`]
  for (const complex of valid.slice(1)) {
    const requiredImprovement = Math.max(
      MODEL_SELECTION_POLICY.absoluteImprovementPx,
      selected.meanReprojectionError * MODEL_SELECTION_POLICY.relativeImprovement,
    )
    const improvement = selected.meanReprojectionError - complex.meanReprojectionError
    const allowedDeficit = Math.ceil(from.length * MODEL_SELECTION_POLICY.maximumInlierDeficit)
    const preservesEvidence = complex.inliers.length + allowedDeficit >= selected.inliers.length
    if (preservesEvidence && improvement > requiredImprovement) {
      decisions.push(
        `${complex.model} won: ${improvement.toFixed(3)}px improvement`
        + ` > ${requiredImprovement.toFixed(3)}px threshold`,
      )
      selected = complex
    } else {
      decisions.push(
        `${complex.model} rejected: ${improvement.toFixed(3)}px improvement`
        + ` <= ${requiredImprovement.toFixed(3)}px threshold`
        + `${preservesEvidence ? '' : ' or insufficient inliers'}`,
      )
    }
  }
  return { ...selected, candidateErrors, selectedReason: decisions.join('; ') }
}

function edgeLengths(points: readonly Point[]): number[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    return Math.hypot(next.x - point.x, next.y - point.y)
  })
}

export function validateTransformedQuad(
  previous: readonly Point[],
  current: readonly Point[],
  frame: { width: number; height: number },
  matrix: Matrix3,
  previousDisplacement = 0,
  policy = PLANAR_GEOMETRY_POLICY,
): string | null {
  if (current.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return 'non-finite-corners'
  if (current.some(({ x, y }) => x < 0 || y < 0 || x >= frame.width || y >= frame.height)) {
    return 'out-of-frame'
  }
  const beforeArea = polygonArea(previous)
  const afterArea = polygonArea(current)
  if (Math.abs(afterArea) < policy.minQuadAreaPx) return 'degenerate-quad'
  if (Math.sign(beforeArea) !== Math.sign(afterArea)) return 'winding-flip'
  const crossSigns = current.map((point, index) => {
    const next = current[(index + 1) % 4]
    const after = current[(index + 2) % 4]
    return Math.sign((next.x - point.x) * (after.y - next.y)
      - (next.y - point.y) * (after.x - next.x))
  }).filter(Boolean)
  if (crossSigns.some((sign) => sign !== crossSigns[0])) return 'non-convex'
  const areaRatio = Math.abs(afterArea / beforeArea)
  if (areaRatio < 1 / policy.maxAreaRatio || areaRatio > policy.maxAreaRatio) return 'area-change'
  const oldEdges = edgeLengths(previous)
  const newEdges = edgeLengths(current)
  if (newEdges.some((edge, index) => {
    const ratio = edge / oldEdges[index]
    return ratio < 1 / policy.maxEdgeRatioChange || ratio > policy.maxEdgeRatioChange
  })) return 'edge-change'
  const diagonal = Math.hypot(frame.width, frame.height)
  if (Math.abs(matrix[6]) * diagonal > policy.maxProjectiveTerm
    || Math.abs(matrix[7]) * diagonal > policy.maxProjectiveTerm) return 'projective-distortion'
  const displacement = current.reduce((sum, point, index) =>
    sum + Math.hypot(point.x - previous[index].x, point.y - previous[index].y) / 4, 0)
  const objectSize = Math.sqrt(Math.abs(beforeArea))
  if (displacement > objectSize * policy.maxDisplacementRatio) return 'excessive-displacement'
  if (previousDisplacement > 0
    && Math.abs(displacement - previousDisplacement) > objectSize * policy.maxAccelerationRatio) {
    return 'excessive-acceleration'
  }
  return null
}
