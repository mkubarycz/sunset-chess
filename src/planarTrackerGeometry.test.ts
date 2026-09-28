import { describe, expect, it } from 'vitest'
import type { Point } from './scanner'
import {
  applyMatrix,
  distributeFeatures,
  pointInConvexQuad,
  robustPlanarFit,
  shrinkQuad,
  validateTransformedQuad,
  type Matrix3,
} from './planarTrackerGeometry'

const quad: Point[] = [
  { x: 30, y: 25 }, { x: 150, y: 18 }, { x: 165, y: 140 }, { x: 20, y: 150 },
]

function grid(): Point[] {
  return Array.from({ length: 20 * 20 }, (_, index) => ({
    x: index % 20 * 10,
    y: Math.floor(index / 20) * 10,
  }))
}

describe('planar tracker geometry', () => {
  it('keeps features in the inward quad and distributes them across cells', () => {
    const selected = distributeFeatures(grid(), quad, 36)
    const inner = shrinkQuad(quad)
    expect(selected.length).toBeGreaterThan(20)
    expect(selected.every((point) => point.inside && pointInConvexQuad(point, inner))).toBe(true)
    expect(new Set(selected.map(({ cell }) => cell)).size).toBeGreaterThanOrEqual(7)
  })

  it('recovers planar perspective and preserves movement direction', () => {
    const matrix: Matrix3 = [1.04, -.08, 14, .12, .98, -7, .00035, -.00022, 1]
    const from = distributeFeatures(grid(), quad, 36)
    const to = from.map((point) => applyMatrix(matrix, point))
    const fit = robustPlanarFit(from, to, from.map(({ cell }) => cell))
    expect(fit?.model).toBe('homography')
    expect(fit?.meanReprojectionError).toBeLessThan(.01)
    const moved = applyMatrix(fit!.matrix, { x: 90, y: 80 })
    const expected = applyMatrix(matrix, { x: 90, y: 80 })
    expect(moved.x).toBeCloseTo(expected.x, 3)
    expect(moved.y).toBeCloseTo(expected.y, 3)
    expect(moved.x).toBeGreaterThan(90)
  })

  it('excludes opposite-moving background features before fitting', () => {
    const sticker = distributeFeatures(grid(), quad, 30)
    const background = grid().filter((point) => !pointInConvexQuad(point, quad))
    const selected = distributeFeatures([...background, ...sticker], quad, 30)
    const to = selected.map((point) => ({ x: point.x + 12, y: point.y + 3 }))
    const fit = robustPlanarFit(selected, to, selected.map(({ cell }) => cell))
    expect(selected.every((point) => pointInConvexQuad(point, shrinkQuad(quad)))).toBe(true)
    expect(applyMatrix(fit!.matrix, { x: 80, y: 70 })).toEqual(
      expect.objectContaining({ x: expect.closeTo(92, 4), y: expect.closeTo(73, 4) }),
    )
  })

  it('selects explicit homography, affine, and similarity fallbacks', () => {
    const all = distributeFeatures(grid(), quad, 30)
    const translated = all.map((point) => ({ x: point.x + 4, y: point.y - 2 }))
    const translatedFit = robustPlanarFit(all, translated, all.map(({ cell }) => cell))
    expect(translatedFit?.model).toBe('similarity')
    expect(translatedFit?.candidateErrors).toEqual(expect.objectContaining({
      similarity: expect.any(Number),
      affine: expect.any(Number),
      homography: expect.any(Number),
    }))
    expect(translatedFit?.selectedReason).toContain('homography rejected')
    expect(robustPlanarFit(all.slice(0, 8), translated.slice(0, 8), all.slice(0, 8).map(({ cell }) => cell))?.model)
      .toBe('similarity')
    const local = all.filter(({ cell }) => cell === 0 || cell === 1).slice(0, 5)
    expect(robustPlanarFit(local, local.map((point) => ({ x: point.x + 2, y: point.y })), local.map(({ cell }) => cell))?.model)
      .toBe('similarity')
  })

  it('uses affine only for material shear and homography only for material perspective', () => {
    const all = distributeFeatures(grid(), quad, 36)
    const cells = all.map(({ cell }) => cell)
    const affine: Matrix3 = [1.08, .18, 3, -.04, .93, 5, 0, 0, 1]
    const perspective: Matrix3 = [1.02, -.06, 8, .08, .97, -4, .0012, -.0009, 1]
    const affineFit = robustPlanarFit(all, all.map((point) => applyMatrix(affine, point)), cells)
    const perspectiveFit = robustPlanarFit(
      all,
      all.map((point) => applyMatrix(perspective, point)),
      cells,
    )
    expect(affineFit?.model).toBe('affine')
    expect(perspectiveFit?.model).toBe('homography')
    expect(perspectiveFit?.selectedReason).toContain('homography won')
  })

  it('rejects invalid and excessive transforms', () => {
    const frame = { width: 300, height: 220 }
    const identity: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    expect(validateTransformedQuad(quad, [
      quad[0], quad[2], quad[1], quad[3],
    ], frame, identity)).toMatch(/non-convex|winding/)
    expect(validateTransformedQuad(quad, quad.map(({ x, y }) => ({ x: x + 250, y })), frame, identity))
      .toBe('out-of-frame')
    expect(validateTransformedQuad(quad, quad.map(({ x, y }) => ({ x: x * 2, y: y * 2 })), { width: 500, height: 500 }, identity))
      .toBe('area-change')
    expect(validateTransformedQuad(quad, quad, frame, [1, 0, 0, 0, 1, 0, .1, 0, 1]))
      .toBe('projective-distortion')
  })
})
