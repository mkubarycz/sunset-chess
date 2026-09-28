import type { Point, QrDetection } from './scanner'
import {
  TRACKING_ACTION_ANCHOR_MAX_AGE_MS,
  TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS,
  TRACKING_MAX_FRAME_GAP_MS,
} from './trackingPolicy'

export const VISUAL_FRAME_MAX_DIMENSION = 640
export const VISUAL_UI_CONFIDENCE = .48
export const VISUAL_ACTION_CONFIDENCE = .78
export const VISUAL_ACTION_ANCHOR_AGE_MS = TRACKING_ACTION_ANCHOR_MAX_AGE_MS
export const VISUAL_TRACK_MAX_ANCHOR_AGE_MS = TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS
export const VISUAL_TRACK_MAX_FRAME_GAP_MS = TRACKING_MAX_FRAME_GAP_MS

const TEMPLATE_SIZE = 16
const SEARCH_STEPS = [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1]
const SCALE_STEPS = [.9, 1, 1.1]

export interface VisualFrame {
  width: number
  height: number
  gray: Uint8Array
  capturedAt: number
}

export type VisualTrackSource = 'decoded' | 'visual'

export interface VisualTrackObservation {
  detection: QrDetection
  source: VisualTrackSource
  confidence: number
  anchoredAt: number
  updatedAt: number
  actionable: boolean
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Track {
  detection: QrDetection
  box: Box
  anchorBox: Box
  template: Float32Array
  source: VisualTrackSource
  confidence: number
  anchoredAt: number
  updatedAt: number
  misses: number
}

interface Candidate {
  box: Box
  score: number
}

function detectionBox(detection: QrDetection): Box {
  const points = Object.values(detection.location)
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  }
}

function boxCenter(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function transformDetection(detection: QrDetection, from: Box, to: Box): QrDetection {
  const map = ({ x, y }: Point): Point => ({
    x: to.x + (x - from.x) * to.width / from.width,
    y: to.y + (y - from.y) * to.height / from.height,
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

function insideFrame(box: Box, frame: VisualFrame): boolean {
  return box.width >= 8 && box.height >= 8
    && box.x >= 0 && box.y >= 0
    && box.x + box.width < frame.width
    && box.y + box.height < frame.height
}

function normalizedPatch(frame: VisualFrame, box: Box): Float32Array | null {
  if (!insideFrame(box, frame)) return null
  const values = new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE)
  let mean = 0
  for (let row = 0; row < TEMPLATE_SIZE; row += 1) {
    const y = Math.max(0, Math.min(
      frame.height - 1,
      Math.round(box.y + (row + .5) * box.height / TEMPLATE_SIZE),
    ))
    for (let column = 0; column < TEMPLATE_SIZE; column += 1) {
      const x = Math.max(0, Math.min(
        frame.width - 1,
        Math.round(box.x + (column + .5) * box.width / TEMPLATE_SIZE),
      ))
      const value = frame.gray[y * frame.width + x]
      values[row * TEMPLATE_SIZE + column] = value
      mean += value
    }
  }
  mean /= values.length
  let magnitude = 0
  for (let index = 0; index < values.length; index += 1) {
    values[index] -= mean
    magnitude += values[index] * values[index]
  }
  magnitude = Math.sqrt(magnitude)
  if (magnitude < 180) return null
  for (let index = 0; index < values.length; index += 1) values[index] /= magnitude
  return values
}

function correlation(left: Float32Array, right: Float32Array): number {
  let value = 0
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index]
  return Math.max(0, Math.min(1, (value + 1) / 2))
}

function intersectionOverUnion(left: Box, right: Box): number {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - x)
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - y)
  const intersection = width * height
  return intersection / Math.max(1, left.width * left.height + right.width * right.height - intersection)
}

function findCandidate(track: Track, frame: VisualFrame): Candidate | null {
  const searchRadius = Math.max(6, Math.min(30, Math.max(track.box.width, track.box.height) * .45))
  const candidates: Candidate[] = []
  for (const scale of SCALE_STEPS) {
    const width = track.box.width * scale
    const height = track.box.height * scale
    for (const xStep of SEARCH_STEPS) {
      for (const yStep of SEARCH_STEPS) {
        const box = {
          x: track.box.x + (track.box.width - width) / 2 + xStep * searchRadius,
          y: track.box.y + (track.box.height - height) / 2 + yStep * searchRadius,
          width,
          height,
        }
        const patch = normalizedPatch(frame, box)
        if (patch) candidates.push({ box, score: correlation(track.template, patch) })
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score)
  const best = candidates[0]
  if (!best) return null
  const bestCenter = boxCenter(best.box)
  const alternative = candidates.find(({ box }) => {
    const center = boxCenter(box)
    return Math.hypot(center.x - bestCenter.x, center.y - bestCenter.y)
      > Math.min(track.box.width, track.box.height) * .3
  })
  const margin = best.score - (alternative?.score ?? .5)
  const confidence = Math.max(0, Math.min(1, best.score * .86 + Math.max(0, margin) * .7))
  return { box: best.box, score: confidence }
}

function observation(track: Track): VisualTrackObservation {
  return {
    detection: track.detection,
    source: track.source,
    confidence: track.confidence,
    anchoredAt: track.anchoredAt,
    updatedAt: track.updatedAt,
    actionable: track.source === 'decoded'
      || (track.confidence >= VISUAL_ACTION_CONFIDENCE
        && track.updatedAt - track.anchoredAt <= VISUAL_ACTION_ANCHOR_AGE_MS),
  }
}

export function rgbaToVisualFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  capturedAt: number,
): VisualFrame | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return null
  const gray = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4
    gray[index] = Math.round(
      pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114,
    )
  }
  return { width, height, gray, capturedAt }
}

export function scaleDetection(
  detection: QrDetection,
  from: { width: number; height: number },
  to: { width: number; height: number },
): QrDetection {
  const map = ({ x, y }: Point): Point => ({
    x: x * to.width / from.width,
    y: y * to.height / from.height,
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

export class VisualObjectTracker {
  private tracks = new Map<string, Track>()

  clear(): void {
    this.tracks.clear()
  }

  anchor(
    detections: readonly QrDetection[],
    frame: VisualFrame | null,
    now: number,
    decodedAtByIdentity: Readonly<Record<string, number>> = {},
  ): void {
    if (!frame) return
    const unique = new Map(detections.map((detection) => [detection.data, detection]))
    const decodedBoxes = new Map(
      [...unique].map(([identity, detection]) => [identity, detectionBox(detection)]),
    )
    for (const [identity, track] of this.tracks) {
      if (
        !unique.has(identity)
        && [...decodedBoxes.values()].some((box) => intersectionOverUnion(track.box, box) > .35)
      ) {
        this.tracks.delete(identity)
      }
    }
    for (const [identity, detection] of unique) {
      const box = decodedBoxes.get(identity)!
      const template = normalizedPatch(frame, box)
      if (!template) continue
      this.tracks.set(identity, {
        detection,
        box,
        anchorBox: box,
        template,
        source: 'decoded',
        confidence: 1,
        anchoredAt: decodedAtByIdentity[identity] ?? now,
        updatedAt: now,
        misses: 0,
      })
    }
  }

  update(frame: VisualFrame, now: number): VisualTrackObservation[] {
    const proposed = new Map<string, Candidate>()
    for (const [identity, track] of this.tracks) {
      if (
        now - track.anchoredAt > VISUAL_TRACK_MAX_ANCHOR_AGE_MS
        || now - track.updatedAt > VISUAL_TRACK_MAX_FRAME_GAP_MS
      ) {
        this.tracks.delete(identity)
        continue
      }
      const candidate = findCandidate(track, frame)
      if (candidate) proposed.set(identity, candidate)
    }

    const ambiguous = new Set<string>()
    const entries = [...proposed.entries()]
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const [leftId, left] = entries[leftIndex]
        const [rightId, right] = entries[rightIndex]
        const leftCenter = boxCenter(left.box)
        const rightCenter = boxCenter(right.box)
        const centersAreTooClose = Math.hypot(
          leftCenter.x - rightCenter.x,
          leftCenter.y - rightCenter.y,
        ) < Math.max(left.box.width, right.box.width) * 1.1
        if (
          (intersectionOverUnion(left.box, right.box) > .2 || centersAreTooClose)
          && Math.abs(left.score - right.score) < .12
        ) {
          ambiguous.add(leftId)
          ambiguous.add(rightId)
        }
      }
    }

    for (const [identity, track] of this.tracks) {
      const candidate = proposed.get(identity)
      if (!candidate || ambiguous.has(identity) || candidate.score < VISUAL_UI_CONFIDENCE) {
        track.misses += 1
        track.confidence *= ambiguous.has(identity) ? .45 : .68
        if (track.misses >= 2 || track.confidence < VISUAL_UI_CONFIDENCE) {
          this.tracks.delete(identity)
        }
        continue
      }
      const scale = candidate.box.width / track.box.width
      const anchorScale = candidate.box.width / track.anchorBox.width
      if (
        scale < .82 || scale > 1.22
        || anchorScale < .65 || anchorScale > 1.5
        || !insideFrame(candidate.box, frame)
      ) {
        this.tracks.delete(identity)
        continue
      }
      track.detection = transformDetection(track.detection, track.box, candidate.box)
      track.box = candidate.box
      track.source = 'visual'
      track.confidence = candidate.score
      track.updatedAt = now
      track.misses = 0
      const nextTemplate = normalizedPatch(frame, candidate.box)
      if (nextTemplate && candidate.score >= VISUAL_ACTION_CONFIDENCE) {
        for (let index = 0; index < track.template.length; index += 1) {
          track.template[index] = track.template[index] * .92 + nextTemplate[index] * .08
        }
      }
    }
    return [...this.tracks.values()].map(observation)
  }

  observations(): VisualTrackObservation[] {
    return [...this.tracks.values()].map(observation)
  }
}
