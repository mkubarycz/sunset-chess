import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendDiagnosticEvent,
  appendDiagnosticSample,
  diagnosticRemainingMs,
  DiagnosticUrls,
  DIAGNOSTIC_MAX_EVENTS,
  DIAGNOSTIC_MAX_SAMPLES,
  startDiagnostic,
  supportsDiagnosticVideo,
} from './trackingDiagnostic'

describe('tracking diagnostic state', () => {
  afterEach(() => vi.restoreAllMocks())

  it('starts only when called, stops at ten seconds, and bounds telemetry', () => {
    let session = startDiagnostic(50, 'shared-id')
    for (let index = 0; index < DIAGNOSTIC_MAX_SAMPLES + 20; index += 1) {
      session = appendDiagnosticSample(session, { index })
    }
    for (let index = 0; index < DIAGNOSTIC_MAX_EVENTS + 20; index += 1) {
      session = appendDiagnosticEvent(session, { index })
    }
    expect(session.id).toBe('shared-id')
    expect(diagnosticRemainingMs(session, 5_000)).toBe(5_050)
    expect(diagnosticRemainingMs(session, 10_050)).toBe(0)
    expect(session.samples).toHaveLength(DIAGNOSTIC_MAX_SAMPLES)
    expect(session.events).toHaveLength(DIAGNOSTIC_MAX_EVENTS)
  })

  it('supports JSON-only fallback and revokes replacement URLs', () => {
    const canvas = document.createElement('canvas')
    expect(supportsDiagnosticVideo(canvas)).toBe(false)
    const create = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:video').mockReturnValueOnce('blob:json').mockReturnValueOnce('blob:new-json')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const urls = new DiagnosticUrls()
    expect(urls.replace(new Blob(['video']), new Blob(['json']))).toEqual({
      video: 'blob:video', telemetry: 'blob:json',
    })
    urls.replace(null, new Blob(['new']))
    expect(revoke).toHaveBeenCalledWith('blob:video')
    expect(revoke).toHaveBeenCalledWith('blob:json')
    expect(create).toHaveBeenCalledTimes(3)
  })
})

