import type { QualityTier } from './adaptiveQuality'
import type { QrDetection } from './scanner'

export const TRACKING_HISTORY_MAX_COUNT = 12
export const TRACKING_HISTORY_MAX_AGE_MS = 650
export const TRACKING_HISTORY_MAX_BYTES = 24 * 1024 * 1024
export const TRACKING_REGISTRATION_TOLERANCE_MS = 24

export interface TrackingFrame {
  generation: number
  capturedAt: number
  width: number
  height: number
  tier: QualityTier
  pixels: Uint8ClampedArray
}

export interface TrackingFrameHistoryStats {
  count: number
  ageMs: number
  bytes: number
}

export type RegistrationResult =
  | { matched: true; frame: TrackingFrame; deltaMs: number; index: number }
  | { matched: false; reason: string }

export class TrackingFrameHistory {
  private frames: TrackingFrame[] = []
  private bytes = 0

  add(frame: TrackingFrame): void {
    if (frame.pixels.byteLength !== frame.width * frame.height * 4) return
    const newest = this.frames.at(-1)
    if (newest && (
      newest.generation !== frame.generation
      || newest.width !== frame.width
      || newest.height !== frame.height
      || newest.tier !== frame.tier
    )) this.clear()
    const duplicate = this.frames.findIndex((item) =>
      item.generation === frame.generation && item.capturedAt === frame.capturedAt)
    if (duplicate >= 0) {
      this.bytes -= this.frames[duplicate].pixels.byteLength
      this.frames.splice(duplicate, 1)
    }
    const insertAt = this.frames.findIndex((item) => item.capturedAt > frame.capturedAt)
    if (insertAt < 0) this.frames.push(frame)
    else this.frames.splice(insertAt, 0, frame)
    this.bytes += frame.pixels.byteLength
    this.prune(frame.capturedAt)
  }

  match(
    capturedAt: number,
    compatible: Pick<TrackingFrame, 'generation' | 'width' | 'height' | 'tier'>,
    toleranceMs = TRACKING_REGISTRATION_TOLERANCE_MS,
  ): RegistrationResult {
    const candidates = this.frames
      .map((frame, index) => ({ frame, index, deltaMs: Math.abs(frame.capturedAt - capturedAt) }))
      .filter(({ frame }) =>
        frame.generation === compatible.generation
        && frame.width === compatible.width
        && frame.height === compatible.height
        && frame.tier === compatible.tier)
      .sort((a, b) => a.deltaMs - b.deltaMs || b.frame.capturedAt - a.frame.capturedAt)
    const nearest = candidates[0]
    if (!nearest) return { matched: false, reason: 'no-compatible-frame' }
    if (nearest.deltaMs > toleranceMs) return { matched: false, reason: 'registration-tolerance' }
    return { matched: true, ...nearest }
  }

  replayFrom(index: number): TrackingFrame[] {
    return this.frames.slice(index)
  }

  latest(): TrackingFrame | null {
    return this.frames.at(-1) ?? null
  }

  stats(): TrackingFrameHistoryStats {
    return {
      count: this.frames.length,
      ageMs: this.frames.length < 2
        ? 0
        : this.frames.at(-1)!.capturedAt - this.frames[0].capturedAt,
      bytes: this.bytes,
    }
  }

  clear(): void {
    this.frames = []
    this.bytes = 0
  }

  private prune(now: number): void {
    while (
      this.frames.length > TRACKING_HISTORY_MAX_COUNT
      || this.bytes > TRACKING_HISTORY_MAX_BYTES
      || (this.frames.length > 1 && now - this.frames[0].capturedAt > TRACKING_HISTORY_MAX_AGE_MS)
    ) {
      this.bytes -= this.frames.shift()!.pixels.byteLength
    }
  }
}

export interface RegisteredAnchor {
  detection: QrDetection
  capturedAt: number
  generation: number
  width: number
  height: number
  tier: QualityTier
}

export function registerAnchor(
  history: TrackingFrameHistory,
  anchor: RegisteredAnchor,
): { matched: true; frames: TrackingFrame[]; deltaMs: number }
  | { matched: false; reason: string } {
  const match = history.match(anchor.capturedAt, anchor)
  if (!match.matched) return match
  const frames = history.replayFrom(match.index)
  if (frames.length === 0) return { matched: false, reason: 'empty-replay' }
  return { matched: true, frames, deltaMs: match.deltaMs }
}
