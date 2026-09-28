/* global self */
'use strict'
import { loadOpenCV } from '@opencvjs/worker'

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
  const points = corners(detection)
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const padding = Math.max(6, Math.min(32, (Math.max(...xs) - Math.min(...xs)) * .22))
  const x = Math.max(0, Math.floor(Math.min(...xs) - padding))
  const y = Math.max(0, Math.floor(Math.min(...ys) - padding))
  const right = Math.min(gray.cols - 1, Math.ceil(Math.max(...xs) + padding))
  const bottom = Math.min(gray.rows - 1, Math.ceil(Math.max(...ys) + padding))
  if (right - x < 8 || bottom - y < 8) return new cv.Mat()
  const roi = gray.roi(new cv.Rect(x, y, right - x + 1, bottom - y + 1))
  const selected = new cv.Mat()
  const mask = new cv.Mat()
  try {
    cv.goodFeaturesToTrack(roi, selected, 48, .01, 3, mask, 5, false, .04)
    const values = []
    for (let index = 0; index < selected.rows; index += 1) {
      values.push(selected.data32F[index * 2] + x, selected.data32F[index * 2 + 1] + y)
    }
    return cv.matFromArray(values.length / 2, 1, cv.CV_32FC2, values)
  } finally {
    roi.delete()
    selected.delete()
    mask.delete()
  }
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
  const inliers = all.filter((index) =>
    residual(index, initial) <= policy.maxReprojectionErrorPx)
  if (inliers.length < policy.minSurvivors) return null
  const refined = fitSimilarity(from, to, inliers)
  return refined ? { transform: refined, inlierCount: inliers.length } : null
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
    let totalError = 0
    let totalFb = 0
    for (let index = 0; index < track.points.rows; index += 1) {
      const status = forwardStatus.data[index] && backwardStatus.data[index]
      const error = forwardError.data32F[index]
      const dx = track.points.data32F[index * 2] - backward.data32F[index * 2]
      const dy = track.points.data32F[index * 2 + 1] - backward.data32F[index * 2 + 1]
      const fb = Math.hypot(dx, dy)
      if (!status || error > policy.maxError || fb > policy.maxForwardBackwardPx) continue
      from.push(track.points.data32F[index * 2], track.points.data32F[index * 2 + 1])
      to.push(forward.data32F[index * 2], forward.data32F[index * 2 + 1])
      totalError += error
      totalFb += fb
    }
    if (from.length / 2 < policy.minSurvivors) {
      return { track: null, reason: 'insufficient-features' }
    }
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
      + Math.max(0, 1 - totalError / (from.length / 2) / policy.maxError) * .15
      + Math.max(0, 1 - totalFb / (from.length / 2) / policy.maxForwardBackwardPx) * .1,
    ))
    if (!transform?.length || inlierCount < policy.minSurvivors
      || inlierRatio < policy.minInlierRatio) {
      release(toMat)
      return { track: null, reason: 'bad-geometry' }
    }
    if (scale < policy.minScale || scale > policy.maxScale
      || rotation > policy.maxRotationRadians) {
      release(toMat)
      return { track: null, reason: 'transform-bounds' }
    }
    if (confidence < policy.minUiConfidence) {
      release(toMat)
      return { track: null, reason: 'low-confidence' }
    }
    const detection = transformDetection(track.detection, transform)
    if (corners(detection).some(({ x, y }) =>
      x < 0 || y < 0 || x >= current.cols || y >= current.rows)) {
      release(toMat)
      return { track: null, reason: 'left-frame' }
    }
    track.previousCenter = center(track.detection)
    release(track.points)
    track.points = toMat.clone()
    track.detection = detection
    track.updatedAt = now
    track.confidence = confidence
    release(toMat)
    return { track, reason: null }
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
              const points = seedFeatures(current, item.detection)
              if (points.rows < 8) {
                points.delete()
                current.delete()
                return reject('seed-insufficient-features')
              }
              track = {
                detection: item.detection,
                points,
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
        let newest = null
        let newestAt = -Infinity
        for (const item of data.anchors) {
          const outcome = replayAnchor(item)
          if (!outcome.observation) {
            rejectionReasons.push(outcome.reason)
            continue
          }
          observations.push(outcome.observation)
          acceptedTracks.set(item.detection.data, outcome.track)
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
          },
        })
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
    let accepted = 0
    let rejected = 0
    const anchorIdentities = new Set(data.anchors.map(({ data: identity }) => identity))
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
        })
        accepted += 1
      }
    }
    for (const anchor of data.anchors) {
      const existing = tracks.get(anchor.data)
      release(existing?.points)
      const points = seedFeatures(current, anchor)
      if (points.rows >= 8) {
        tracks.set(anchor.data, {
          detection: anchor, points, anchoredAt: data.anchorTimes[anchor.data] ?? data.capturedAt,
          updatedAt: data.capturedAt, confidence: 1,
        })
      } else {
        points.delete()
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
