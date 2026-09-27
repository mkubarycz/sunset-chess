import { describe, expect, it, vi } from 'vitest'
import {
  CAMERA_CONSTRAINTS,
  configureCameraTrack,
  formatCameraDiagnostics,
} from './cameraConfiguration'

function trackWith(
  capabilities: object,
  settings: object,
  applyConstraints = vi.fn().mockResolvedValue(undefined),
): MediaStreamTrack {
  return {
    getCapabilities: () => capabilities,
    getSettings: () => settings,
    applyConstraints,
  } as unknown as MediaStreamTrack
}

describe('camera configuration', () => {
  it('requests practical high-resolution ideals without rejecting lesser cameras', () => {
    expect(CAMERA_CONSTRAINTS).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, max: 3840 },
        height: { ideal: 1080, max: 2160 },
        frameRate: { ideal: 60 },
      },
    })
  })

  it('applies only advertised continuous controls and reports settings and opt-in zoom', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined)
    const result = await configureCameraTrack(trackWith({
      focusMode: ['manual', 'continuous'],
      exposureMode: ['continuous'],
      whiteBalanceMode: ['manual'],
      zoom: { min: 1, max: 4, step: .1 },
    }, {
      width: 1920,
      height: 1080,
      frameRate: 59.94,
      focusMode: 'continuous',
      exposureMode: 'continuous',
      whiteBalanceMode: 'manual',
      zoom: 1,
    }, applyConstraints))

    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }],
    })
    expect(result.controls.map(({ control, state }) => [control, state])).toEqual([
      ['focus', 'active'],
      ['exposure', 'active'],
      ['white balance', 'unsupported'],
    ])
    expect(result.zoom).toEqual({
      supported: true, current: 1, min: 1, max: 4, applied: false,
    })
    expect(formatCameraDiagnostics(result)).toContain('1920×1080 @ 59.9 fps')
    expect(formatCameraDiagnostics(result)).toContain('zoom supported (1×), not applied')
  })

  it('surfaces optional tuning failure without rejecting camera configuration', async () => {
    const result = await configureCameraTrack(trackWith({
      focusMode: ['continuous'],
      exposureMode: ['continuous'],
    }, {
      width: 1280,
      height: 720,
      frameRate: 30,
      focusMode: 'manual',
    }, vi.fn().mockRejectedValue(new DOMException('not supported', 'OverconstrainedError'))))

    expect(result.controls).toEqual([
      { control: 'focus', state: 'failed', current: 'manual' },
      { control: 'exposure', state: 'failed', current: undefined },
      { control: 'white balance', state: 'unsupported', current: undefined },
    ])
    expect(formatCameraDiagnostics(result)).toContain('focus failed (manual)')
  })
})
