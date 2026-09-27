export type QualityTier = 'economy' | 'balanced' | 'high'

export interface QualityProfile {
  tier: QualityTier
  decodeMaxDimension: number
  trackMaxDimension: number
  decodeIntervalMs: number
  trackIntervalMs: number
}

export interface CapabilitySample {
  cameraWidth?: number
  cameraHeight?: number
  frameRate?: number
  hardwareConcurrency?: number
  deviceMemory?: number
  wasm: boolean
  simd: boolean
  offscreenCanvas: boolean
  visible: boolean
  decodeLatencyMs?: number
  trackLatencyMs?: number
}

const profiles: Record<QualityTier, QualityProfile> = {
  economy: {
    tier: 'economy', decodeMaxDimension: 720, trackMaxDimension: 480,
    decodeIntervalMs: 320, trackIntervalMs: 90,
  },
  balanced: {
    tier: 'balanced', decodeMaxDimension: 1080, trackMaxDimension: 640,
    decodeIntervalMs: 150, trackIntervalMs: 55,
  },
  high: {
    tier: 'high', decodeMaxDimension: 1440, trackMaxDimension: 960,
    decodeIntervalMs: 120, trackIntervalMs: 33,
  },
}

export function supportsWasmSimd(): boolean {
  if (typeof WebAssembly === 'undefined') return false
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0,
      3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15, 26, 11,
    ]))
  } catch {
    return false
  }
}

export function selectQuality(sample: CapabilitySample): QualityProfile {
  if (!sample.visible) return profiles.economy
  const pixels = (sample.cameraWidth ?? 0) * (sample.cameraHeight ?? 0)
  const capable = (sample.hardwareConcurrency ?? 2) >= 8
    && (sample.deviceMemory ?? 4) >= 8
    && sample.wasm && sample.simd && sample.offscreenCanvas
    && pixels >= 1920 * 1080
    && (sample.frameRate ?? 30) >= 30
  let tier: QualityTier = capable ? 'high'
    : sample.wasm && (sample.hardwareConcurrency ?? 2) >= 4 ? 'balanced' : 'economy'
  if ((sample.decodeLatencyMs ?? 0) > 260 || (sample.trackLatencyMs ?? 0) > 75) {
    tier = tier === 'high' ? 'balanced' : 'economy'
  }
  const profile = profiles[tier]
  if ((sample.decodeLatencyMs ?? 0) <= profile.decodeIntervalMs) return profile
  return {
    ...profile,
    decodeIntervalMs: Math.min(600, Math.ceil((sample.decodeLatencyMs ?? 0) * 1.35)),
  }
}
