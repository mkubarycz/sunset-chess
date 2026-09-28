/* global self */
'use strict'
import { loadOpenCV } from '@opencvjs/worker'
import {
  applyMatrix,
  detectionCorners,
  distributeFeatures,
  pointInConvexQuad,
  robustPlanarFit,
  shrinkQuad,
  validateTransformedQuad,
} from './planarTrackerGeometry'

const tracks = new Map()
let previous = null
let generation = 0
let cv = null
let policy = null

const corners = (detection) => [
  detection.location.topLeftCorner,
  detection.location.topRightCorner,
  detection.location.bottomRightCorner,
  detection.location.bottomLeftCorner,
]
const center = (detection) => {
  const points = corners(detection)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / 4,
    y: points.reduce((sum, point) => sum + point.y, 0) / 4,
  }
}

function release(value) {
  if (value && typeof value.delete === 'function') value.delete()
}

function clear() {
  for (const track of tracks.values()) release(track.points)
  tracks.clear()
  release(previous)
  previous = null
}

function grayFrame(pixels, width, height) {
  const rgba = cv.matFromArray(height, width, cv.CV_8UC4, pixels)
  const gray = new cv.Mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
  rgba.delete()
  return gray
}

function seedFeatures(gray, detection) {
  const quad = detectionCorners(detection)
  const inner = shrinkQuad(quad, .9)
  const maskValues = new Uint8Array(gray.rows * gray.cols)
  const xs = inner.map(({ x }) => x)
  const ys = inner.map(({ y }) => y)
  const left = Math.max(0, Math.floor(Math.min(...xs)))
  const top = Math.max(0, Math.floor(Math.min(...ys)))
  const right = Math.min(gray.cols - 1, Math.ceil(Math.max(...xs)))
  const bottom = Math.min(gray.rows - 1, Math.ceil(Math.max(...ys)))
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (pointInConvexQuad({ x: x + .5, y: y + .5 }, inner)) {
        maskValues[y * gray.cols + x] = 255
      }
    }
  }
  const selected = new cv.Mat()
  const mask = cv.matFromArray(gray.rows, gray.cols, cv.CV_8UC1, maskValues)
  try {
    cv.goodFeaturesToTrack(gray, selected, 96, .008, 3, mask, 5, false, .04)
    const candidates = []
    for (let index = 0; index < selected.rows; index += 1) {
      candidates.push({
        x: selected.data32F[index * 2],
        y: selected.data32F[index * 2 + 1],
      })
    }
    const distributed = distributeFeatures(candidates, quad, 48, 3)
    const values = distributed.flatMap(({ x, y }) => [x, y])
    return {
      points: cv.matFromArray(values.length / 2, 1, cv.CV_32FC2, values),
      cells: distributed.map(({ cell }) => cell),
      membership: distributed.map(({ cell, inside }) => ({ cell, inside })),
    }
  } finally {
    selected.delete()
    mask.delete()
  }
}

function transformDetection(detection, matrix) {
  const map = (point) => applyMatrix(matrix, point)
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

function flowTrack(track, current, now, previousFrame = previous) {
  const forward = new cv.Mat()
  const forwardStatus = new cv.Mat()
  const forwardError = new cv.Mat()
  const backward = new cv.Mat()
  const backwardStatus = new cv.Mat()
  const backwardError = new cv.Mat()
  const win = new cv.Size(31, 31)
  const criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 30, .02)
  try {
    cv.calcOpticalFlowPyrLK(previousFrame, current, track.points, forward, forwardStatus, forwardError, win, 4, criteria)
    cv.calcOpticalFlowPyrLK(current, previousFrame, forward, backward, backwardStatus, backwardError, win, 4, criteria)
    const from = []
    const to = []
    const cells = []
    const memberships = []
    let totalError = 0
    let totalFb = 0
    for (let index = 0; index < track.points.rows; index += 1) {
      const status = forwardStatus.data[index] && backwardStatus.data[index]
      const error = forwardError.data32F[index]
      const dx = track.points.data32F[index * 2] - backward.data32F[index * 2]
      const dy = track.points.data32F[index * 2 + 1] - backward.data32F[index * 2 + 1]
      const fb = Math.hypot(dx, dy)
      if (!status || error > policy.maxError || fb > policy.maxForwardBackwardPx) continue
      from.push({
        x: track.points.data32F[index * 2],
        y: track.points.data32F[index * 2 + 1],
      })
      to.push({ x: forward.data32F[index * 2], y: forward.data32F[index * 2 + 1] })
      cells.push(track.cells[index] ?? 0)
      memberships.push(track.membership?.[index] ?? { cell: track.cells[index] ?? 0, inside: true })
      totalError += error
      totalFb += fb
    }
    if (from.length < policy.minSurvivors) {
      return { track: null, reason: 'insufficient-features', diagnostics: {
        model: 'none', features: track.points.rows, survivors: from.length, inliers: 0,
        reprojectionError: 0, forwardBackwardError: 0, distributedCells: 0, maskViolations: 0,
      } }
    }
    const fit = robustPlanarFit(from, to, cells, policy.maxReprojectionErrorPx)
    const transform = fit?.matrix
    const inlierCount = fit?.inliers.length ?? 0
    const survival = from.length / Math.max(1, track.points.rows)
    const inlierRatio = inlierCount / Math.max(1, from.length)
    const meanError = totalError / from.length
    const meanFb = totalFb / from.length
    const diagnostics = {
      model: fit?.model ?? 'none',
      features: track.points.rows,
      survivors: from.length,
      inliers: inlierCount,
      reprojectionError: fit?.meanReprojectionError ?? 0,
      forwardBackwardError: meanFb,
      distributedCells: new Set(cells).size,
      maskViolations: (track.membership ?? []).filter(({ inside }) => !inside).length,
      candidateErrors: fit?.candidateErrors ?? {},
      selectedModelReason: fit?.selectedReason ?? 'no valid model',
    }
    const confidence = Math.max(0, Math.min(1,
      survival * .3 + inlierRatio * .45
      + Math.max(0, 1 - meanError / policy.maxError) * .15
      + Math.max(0, 1 - meanFb / policy.maxForwardBackwardPx) * .1,
    ))
    if (!transform?.length || inlierCount < policy.minSurvivors
      || inlierRatio < policy.minInlierRatio) {
      return { track: null, reason: 'bad-geometry', diagnostics }
    }
    if (confidence < policy.minUiConfidence) {
      return { track: null, reason: 'low-confidence', diagnostics }
    }
    const detection = transformDetection(track.detection, transform)
    const geometryRejection = validateTransformedQuad(
      corners(track.detection),
      corners(detection),
      { width: current.cols, height: current.rows },
      transform,
      track.displacement ?? 0,
    )
    if (geometryRejection) {
      return { track: null, reason: geometryRejection, diagnostics }
    }
    const retained = fit.inliers.flatMap((index) => [to[index].x, to[index].y])
    let nextPoints = cv.matFromArray(retained.length / 2, 1, cv.CV_32FC2, retained)
    let nextCells = fit.inliers.map((index) => cells[index])
    let nextMembership = fit.inliers.map((index) => memberships[index])
    if (nextPoints.rows < policy.reseedBelow || new Set(nextCells).size < policy.minDistributedCells) {
      const reseeded = seedFeatures(current, detection)
      if (reseeded.points.rows >= policy.minSurvivors) {
        release(nextPoints)
        nextPoints = reseeded.points
        nextCells = reseeded.cells
        nextMembership = reseeded.membership
      } else {
        release(reseeded.points)
      }
    }
    track.previousCenter = center(track.detection)
    release(track.points)
    const oldCenter = center(track.detection)
    const newCenter = center(detection)
    track.displacement = Math.hypot(newCenter.x - oldCenter.x, newCenter.y - oldCenter.y)
    track.points = nextPoints
    track.cells = nextCells
    track.membership = nextMembership
    track.detection = detection
    track.updatedAt = now
    track.confidence = confidence
    track.diagnostics = diagnostics
    return { track, reason: null, diagnostics }
  } finally {
    ;[forward, forwardStatus, forwardError, backward, backwardStatus, backwardError].forEach(release)
  }
}

function rejectAmbiguity(observations) {
  const rejected = new Set()
  for (let i = 0; i < observations.length; i += 1) {
    for (let j = i + 1; j < observations.length; j += 1) {
      const a = corners(observations[i].detection)
      const b = corners(observations[j].detection)
      const center = (values) => ({
        x: values.reduce((sum, point) => sum + point.x, 0) / 4,
        y: values.reduce((sum, point) => sum + point.y, 0) / 4,
      })
      const ac = center(a)
      const bc = center(b)
      const size = Math.max(
        Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y),
        Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y),
      )
      if (Math.hypot(ac.x - bc.x, ac.y - bc.y) < size * policy.ambiguityDistanceRatio) {
        rejected.add(observations[i].detection.data)
        rejected.add(observations[j].detection.data)
      }
      const aTrack = tracks.get(observations[i].detection.data)
      const bTrack = tracks.get(observations[j].detection.data)
      if (aTrack?.previousCenter && bTrack?.previousCenter) {
        const oldOrder = aTrack.previousCenter.x - bTrack.previousCenter.x
        const newOrder = ac.x - bc.x
        if (oldOrder && newOrder && Math.sign(oldOrder) !== Math.sign(newOrder)) {
          rejected.add(observations[i].detection.data)
          rejected.add(observations[j].detection.data)
        }
      }
    }
  }
  return observations.filter(({ detection }) => !rejected.has(detection.data))
}

function trackDiagnostic(identity, track, rejectionReason = null) {
  const details = track?.diagnostics ?? {
    model: 'none', features: track?.points?.rows ?? 0, survivors: 0, inliers: 0,
    reprojectionError: 0, forwardBackwardError: 0,
  }
  return {
    identity,
    ...details,
    confidence: track?.confidence ?? 0,
    rejectionReason,
  }
}

function replayAnchor(item) {
  if (!item.frames.length) return { observation: null, reason: 'empty-replay' }
  let prior = null
  let track = null
  const reject = (reason) => {
    release(prior)
    release(track?.points)
    return { observation: null, reason }
  }
  for (let index = 0; index < item.frames.length; index += 1) {
    const frame = item.frames[index]
    const current = grayFrame(new Uint8ClampedArray(frame.pixels), frame.width, frame.height)
    if (prior && (prior.cols !== current.cols || prior.rows !== current.rows)) {
      current.delete()
      return reject('replay-dimension-change')
    }
    if (index === 0) {
      const seeded = seedFeatures(current, item.detection)
      if (seeded.points.rows < policy.minSurvivors) {
        seeded.points.delete()
        current.delete()
        return reject('seed-insufficient-features')
      }
      track = {
        detection: item.detection,
        points: seeded.points,
        cells: seeded.cells,
        membership: seeded.membership,
        anchoredAt: item.anchoredAt,
        updatedAt: frame.capturedAt,
        confidence: 1,
      }
    } else {
      const outcome = flowTrack(track, current, frame.capturedAt, prior)
      if (!outcome.track) {
        current.delete()
        return reject(`replay-${outcome.reason}`)
      }
      track = outcome.track
    }
    release(prior)
    prior = current
  }
  return {
    observation: {
      detection: track.detection,
      source: 'visual',
      confidence: track.confidence,
      anchoredAt: track.anchoredAt,
      updatedAt: track.updatedAt,
      actionable: track.confidence >= policy.actionConfidence
        && track.updatedAt - track.anchoredAt <= policy.actionAnchorAgeMs,
      diagnostics: { ...track.diagnostics, rejectionReason: null },
    },
    track,
    lastFrame: prior,
    reason: null,
  }
}

function handleReanchor(data, startedAt) {
  const observations = []
  const acceptedTracks = new Map()
  const rejectionReasons = []
  const diagnostics = []
  let newest = null
  let newestAt = -Infinity
  for (const item of data.anchors) {
    const outcome = replayAnchor(item)
    if (!outcome.observation) {
      rejectionReasons.push(outcome.reason)
      diagnostics.push(trackDiagnostic(item.detection.data, null, outcome.reason))
      continue
    }
    observations.push(outcome.observation)
    acceptedTracks.set(item.detection.data, outcome.track)
    diagnostics.push(trackDiagnostic(item.detection.data, outcome.track))
    if (outcome.observation.updatedAt > newestAt) {
      release(newest)
      newest = outcome.lastFrame
      newestAt = outcome.observation.updatedAt
    } else {
      release(outcome.lastFrame)
    }
  }
  clear()
  for (const [identity, track] of acceptedTracks) tracks.set(identity, track)
  const safe = rejectAmbiguity(observations)
  for (const [identity, track] of tracks) {
    if (!safe.some(({ detection }) => detection.data === identity)) {
      release(track.points)
      tracks.delete(identity)
      rejectionReasons.push('ambiguous-or-crossing')
    }
  }
  previous = newest
  self.postMessage({
    type: 'result',
    id: data.id,
    generation: data.generation,
    observations: safe.filter(({ detection }) => tracks.has(detection.data)),
    elapsedMs: performance.now() - startedAt,
    diagnostics: {
      accepted: tracks.size,
      rejected: data.anchors.length - tracks.size,
      rejectionReasons: [...new Set(rejectionReasons)].slice(-4),
      tracks: diagnostics,
    },
  })
}

async function initialize() {
  const resolved = await loadOpenCV()
  if (!resolved?.calcOpticalFlowPyrLK || !resolved?.matFromArray
    || !resolved?.goodFeaturesToTrack) {
    throw new Error('required pyramidal LK APIs are unavailable')
  }
  cv = resolved
}

self.onmessage = async ({ data }) => {
  if (data.type === 'clear') {
    clear()
    generation = data.generation
    return
  }
  if (data.type === 'init') {
    try {
      await initialize()
      policy = data.policy
      generation = data.generation
      self.postMessage({ type: 'ready', id: data.id, generation: data.generation })
    } catch (error) {
      self.postMessage({
        type: 'error', id: data.id, generation: data.generation, phase: 'initialization',
        message: error instanceof Error ? error.message : 'OpenCV initialization failed',
      })
    }
    return
  }
  const startedAt = performance.now()
  let current
  try {
    if (data.generation !== generation) {
      clear()
      generation = data.generation
    }
    if (data.type === 'reanchor') {
      handleReanchor(data, startedAt)
      return
    }
    current = grayFrame(new Uint8ClampedArray(data.pixels), data.width, data.height)
    if (previous && (previous.cols !== current.cols || previous.rows !== current.rows)) clear()
    const observations = []
    const rejectionReasons = []
    const trackDiagnostics = []
    let accepted = 0
    let rejected = 0
    const anchorIdentities = new Set(data.anchors.map(({ data: identity }) => identity))
    for (const [identity, anchoredAt] of Object.entries(data.anchorTimes ?? {})) {
      const track = tracks.get(identity)
      if (track) track.anchoredAt = Math.max(track.anchoredAt, anchoredAt)
    }
    if (previous) {
      for (const [identity, track] of tracks) {
        if (anchorIdentities.has(identity)) continue
        if (data.capturedAt - track.anchoredAt > policy.trackExpiryMs
          || data.capturedAt - track.updatedAt > policy.maxFrameGapMs) {
          release(track.points)
          tracks.delete(identity)
          rejected += 1
          rejectionReasons.push(data.capturedAt - track.anchoredAt > policy.trackExpiryMs
            ? 'stale-anchor' : 'frame-gap')
          continue
        }
        const outcome = flowTrack(track, current, data.capturedAt)
        if (!outcome.track) {
          trackDiagnostics.push(trackDiagnostic(identity, track, outcome.reason))
          release(track.points)
          tracks.delete(identity)
          rejected += 1
          rejectionReasons.push(outcome.reason)
          continue
        }
        observations.push({
          detection: outcome.track.detection,
          source: 'visual',
          confidence: outcome.track.confidence,
          anchoredAt: outcome.track.anchoredAt,
          updatedAt: outcome.track.updatedAt,
          actionable: outcome.track.confidence >= policy.actionConfidence
            && outcome.track.updatedAt - outcome.track.anchoredAt <= policy.actionAnchorAgeMs,
          diagnostics: { ...outcome.diagnostics, rejectionReason: null },
        })
        trackDiagnostics.push(trackDiagnostic(identity, outcome.track))
        accepted += 1
      }
    }
    for (const anchor of data.anchors) {
      const existing = tracks.get(anchor.data)
      release(existing?.points)
      const seeded = seedFeatures(current, anchor)
      if (seeded.points.rows >= policy.minSurvivors) {
        tracks.set(anchor.data, {
          detection: anchor, points: seeded.points, cells: seeded.cells,
          membership: seeded.membership,
          anchoredAt: data.anchorTimes[anchor.data] ?? data.capturedAt,
          updatedAt: data.capturedAt, confidence: 1,
        })
      } else {
        trackDiagnostics.push(trackDiagnostic(anchor.data, { points: seeded.points }, 'seed-insufficient-features'))
        seeded.points.delete()
        tracks.delete(anchor.data)
        rejected += 1
        rejectionReasons.push('seed-insufficient-features')
      }
    }
    const safe = rejectAmbiguity(observations)
    for (const [identity, track] of tracks) {
      if (observations.some(({ detection }) => detection.data === identity)
        && !safe.some(({ detection }) => detection.data === identity)) {
        release(track.points)
        tracks.delete(identity)
        accepted -= 1
        rejected += 1
        rejectionReasons.push('ambiguous-or-crossing')
      }
    }
    release(previous)
    previous = current
    current = null
    self.postMessage({
      type: 'result', id: data.id, generation: data.generation, observations: safe,
      elapsedMs: performance.now() - startedAt,
      diagnostics: {
        accepted: Math.max(0, accepted),
        rejected,
        rejectionReasons: [...new Set(rejectionReasons)].slice(-4),
        tracks: trackDiagnostics,
      },
    })
  } catch (error) {
    release(current)
    self.postMessage({
      type: 'error', id: data.id, generation: data.generation, phase: 'runtime',
      message: error instanceof Error ? error.message : 'OpenCV tracking failed',
    })
  }
}
