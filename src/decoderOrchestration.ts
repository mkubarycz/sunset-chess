import type { QualityProfile } from './adaptiveQuality'
import { scanDimensions, type QrDetection } from './scanner'

export type DecoderName = 'native' | 'zxing-wasm' | 'jsqr'

export const NATIVE_DECODE_INTERVAL_MS = 50
export const JSQR_DECODE_INTERVAL_MS = 1_200
export const JSQR_IDLE_BEFORE_ATTEMPT_MS = 900
export const FULL_DETAIL_DECODE_INTERVAL_MS = 1_000
export const RESULT_MERGE_WINDOW_MS = 250

export interface DecoderInputStats {
  width: number
  height: number
  attemptedAt: number
  completedAt?: number
  intervalMs?: number
}

export function workerDecodeDimensions(
  sourceWidth: number,
  sourceHeight: number,
  profile: QualityProfile,
  now: number,
  lastFullDetailAt: number,
): { width: number; height: number; fullDetail: boolean } {
  const sourceMax = Math.max(sourceWidth, sourceHeight)
  const periodicFullDetail = now - lastFullDetailAt >= FULL_DETAIL_DECODE_INTERVAL_MS
  const fullDetail = (profile.tier === 'high' && sourceMax <= profile.decodeMaxDimension)
    || sourceMax <= profile.decodeMaxDimension
    || periodicFullDetail
  const size = fullDetail
    ? scanDimensions(sourceWidth, sourceHeight, sourceMax)
    : scanDimensions(sourceWidth, sourceHeight, profile.decodeMaxDimension)
  return { ...size, fullDetail }
}

function polygonArea(detection: QrDetection): number {
  const points = Object.values(detection.location)
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point.x * next.y - next.x * point.y
  }, 0) / 2)
}

export function mergeDecoderDetections(
  ...sets: ReadonlyArray<readonly QrDetection[]>
): QrDetection[] {
  const byPayload = new Map<string, QrDetection>()
  for (const detection of sets.flat()) {
    const current = byPayload.get(detection.data)
    if (!current || polygonArea(detection) > polygonArea(current)) {
      byPayload.set(detection.data, detection)
    }
  }
  return [...byPayload.values()]
}

export function formatDecoderInputStats(
  sourceWidth: number,
  sourceHeight: number,
  stats: Partial<Record<DecoderName, DecoderInputStats>>,
): string {
  const describe = (name: DecoderName) => {
    const item = stats[name]
    return `${name} ${item
      ? `${item.width}×${item.height}${item.intervalMs ? ` @ ${Math.round(item.intervalMs)}ms` : ''}`
      : 'idle'}`
  }
  return `source ${sourceWidth}×${sourceHeight} · ${describe('native')} · `
    + `${describe('zxing-wasm')} · ${describe('jsqr')}`
}
