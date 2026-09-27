import { describe, expect, it } from 'vitest'
import { selectQuality } from './adaptiveQuality'

const capable = {
  cameraWidth: 3840,
  cameraHeight: 2160,
  frameRate: 60,
  hardwareConcurrency: 10,
  deviceMemory: 16,
  wasm: true,
  simd: true,
  offscreenCanvas: true,
  visible: true,
}

describe('adaptive vision quality', () => {
  it('selects high quality from capabilities rather than user-agent', () => {
    expect(selectQuality(capable).tier).toBe('high')
  })

  it('degrades while hidden and under measured load', () => {
    expect(selectQuality({ ...capable, visible: false }).tier).toBe('economy')
    expect(selectQuality({ ...capable, decodeLatencyMs: 300 }).tier).toBe('balanced')
    expect(selectQuality({
      ...capable,
      hardwareConcurrency: 4,
      deviceMemory: 4,
      decodeLatencyMs: 300,
    }).tier).toBe('economy')
  })
})
