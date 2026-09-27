/* global self */
'use strict'
import { loadOpenCV } from '@opencvjs/worker'

const tracks = new Map()
let previous = null
let generation = 0
let cv = null

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
  const points = corners(detection)
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const padding = Math.max(4, Math.min(24, (Math.max(...xs) - Math.min(...xs)) * .18))
  const x = Math.max(0, Math.floor(Math.min(...xs) - padding))
  const y = Math.max(0, Math.floor(Math.min(...ys) - padding))
  const right = Math.min(gray.cols - 1, Math.ceil(Math.max(...xs) + padding))
  const bottom = Math.min(gray.rows - 1, Math.ceil(Math.max(...ys) + padding))
  const grid = []
  for (let row = 1; row <= 6; row += 1) {
    for (let column = 1; column <= 6; column += 1) {
      grid.push(
        x + (right - x) * column / 7,
        y + (bottom - y) * row / 7,
      )
    }
  }
  return cv.matFromArray(grid.length / 2, 1, cv.CV_32FC2, grid)
}

function transformDetection(detection, transform) {
  const map = ({ x, y }) => ({
    x: transform[0] * x + transform[1] * y + transform[2],
    y: transform[3] * x + transform[4] * y + transform[5],
  })
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

function fitSimilarity(from, to, indices) {
  let fromX = 0
  let fromY = 0
  let toX = 0
  let toY = 0
  for (const index of indices) {
    fromX += from[index * 2]
    fromY += from[index * 2 + 1]
    toX += to[index * 2]
    toY += to[index * 2 + 1]
  }
  fromX /= indices.length
  fromY /= indices.length
  toX /= indices.length
  toY /= indices.length
  let denominator = 0
  let real = 0
  let imaginary = 0
  for (const index of indices) {
    const x = from[index * 2] - fromX
    const y = from[index * 2 + 1] - fromY
    const u = to[index * 2] - toX
    const v = to[index * 2 + 1] - toY
    denominator += x * x + y * y
    real += x * u + y * v
    imaginary += x * v - y * u
  }
  if (denominator < 1) return null
  const a = real / denominator
  const b = imaginary / denominator
  return [a, -b, toX - a * fromX + b * fromY,
    b, a, toY - b * fromX - a * fromY]
}

function robustSimilarity(from, to) {
  const all = Array.from({ length: from.length / 2 }, (_, index) => index)
  const initial = fitSimilarity(from, to, all)
  if (!initial) return null
  const residual = (index, transform) => {
    const x = from[index * 2]
    const y = from[index * 2 + 1]
    return Math.hypot(
      transform[0] * x + transform[1] * y + transform[2] - to[index * 2],
      transform[3] * x + transform[4] * y + transform[5] - to[index * 2 + 1],
    )
  }
  const inliers = all.filter((index) => residual(index, initial) <= 2.5)
  if (inliers.length < 8) return null
  const refined = fitSimilarity(from, to, inliers)
  return refined ? { transform: refined, inlierCount: inliers.length } : null
}

function flowTrack(track, current, now) {
  const forward = new cv.Mat()
  const forwardStatus = new cv.Mat()
  const forwardError = new cv.Mat()
  const backward = new cv.Mat()
  const backwardStatus = new cv.Mat()
  const backwardError = new cv.Mat()
  const win = new cv.Size(21, 21)
  const criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 20, .03)
  try {
    cv.calcOpticalFlowPyrLK(previous, current, track.points, forward, forwardStatus, forwardError, win, 3, criteria)
    cv.calcOpticalFlowPyrLK(current, previous, forward, backward, backwardStatus, backwardError, win, 3, criteria)
    const from = []
    const to = []
    let totalError = 0
    let totalFb = 0
    for (let index = 0; index < track.points.rows; index += 1) {
      const status = forwardStatus.data[index] && backwardStatus.data[index]
      const error = forwardError.data32F[index]
      const dx = track.points.data32F[index * 2] - backward.data32F[index * 2]
      const dy = track.points.data32F[index * 2 + 1] - backward.data32F[index * 2 + 1]
      const fb = Math.hypot(dx, dy)
      if (!status || error > 24 || fb > 1.5) continue
      from.push(track.points.data32F[index * 2], track.points.data32F[index * 2 + 1])
      to.push(forward.data32F[index * 2], forward.data32F[index * 2 + 1])
      totalError += error
      totalFb += fb
    }
    if (from.length < 16) return null
    const toMat = cv.matFromArray(to.length / 2, 1, cv.CV_32FC2, to)
    const fit = robustSimilarity(from, to)
    const transform = fit?.transform
    const inlierCount = fit?.inlierCount ?? 0
    const survival = from.length / 2 / Math.max(1, track.points.rows)
    const inlierRatio = inlierCount / Math.max(1, from.length / 2)
    const scale = transform?.length ? Math.hypot(transform[0], transform[3]) : 0
    const rotation = transform?.length ? Math.abs(Math.atan2(transform[3], transform[0])) : Math.PI
    const confidence = Math.max(0, Math.min(1,
      survival * .3 + inlierRatio * .45
      + Math.max(0, 1 - totalError / (from.length / 2) / 24) * .15
      + Math.max(0, 1 - totalFb / (from.length / 2) / 1.5) * .1,
    ))
    if (!transform?.length || inlierCount < 8 || inlierRatio < .65
      || scale < .75 || scale > 1.3 || rotation > .7 || confidence < .52) {
      release(toMat)
      return null
    }
    const detection = transformDetection(track.detection, transform)
    track.previousCenter = center(track.detection)
    release(track.points)
    track.points = toMat.clone()
    track.detection = detection
    track.updatedAt = now
    track.confidence = confidence
    release(toMat)
    return track
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
      if (Math.hypot(ac.x - bc.x, ac.y - bc.y) < size * .7) {
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

async function initialize() {
  const resolved = await loadOpenCV()
  if (!resolved?.calcOpticalFlowPyrLK || !resolved?.matFromArray) {
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
    current = grayFrame(new Uint8ClampedArray(data.pixels), data.width, data.height)
    const observations = []
    if (previous) {
      for (const [identity, track] of tracks) {
        if (data.capturedAt - track.anchoredAt > 1100
          || data.capturedAt - track.updatedAt > 220) {
          release(track.points)
          tracks.delete(identity)
          continue
        }
        const updated = flowTrack(track, current, data.capturedAt)
        if (!updated) {
          release(track.points)
          tracks.delete(identity)
          continue
        }
        observations.push({
          detection: updated.detection,
          source: 'visual',
          confidence: updated.confidence,
          anchoredAt: updated.anchoredAt,
          updatedAt: updated.updatedAt,
          actionable: updated.confidence >= .82
            && updated.updatedAt - updated.anchoredAt <= 650,
        })
      }
    }
    for (const anchor of data.anchors) {
      const existing = tracks.get(anchor.data)
      release(existing?.points)
      const points = seedFeatures(current, anchor)
      if (points.rows >= 8) {
        tracks.set(anchor.data, {
          detection: anchor, points, anchoredAt: data.capturedAt,
          updatedAt: data.capturedAt, confidence: 1,
        })
      } else {
        points.delete()
        tracks.delete(anchor.data)
      }
    }
    const safe = rejectAmbiguity(observations)
    for (const [identity, track] of tracks) {
      if (observations.some(({ detection }) => detection.data === identity)
        && !safe.some(({ detection }) => detection.data === identity)) {
        release(track.points)
        tracks.delete(identity)
      }
    }
    release(previous)
    previous = current
    current = null
    self.postMessage({
      type: 'result', id: data.id, generation: data.generation, observations: safe,
      elapsedMs: performance.now() - startedAt,
    })
  } catch (error) {
    release(current)
    self.postMessage({
      type: 'error', id: data.id, generation: data.generation, phase: 'runtime',
      message: error instanceof Error ? error.message : 'OpenCV tracking failed',
    })
  }
}
