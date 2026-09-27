import { describe, expect, it, vi } from 'vitest'
import {
  createNativeBarcodeDetector,
  detectNativeQr,
  detectNativeQrs,
  type NativeBarcodeDetector,
} from './nativeBarcodeDecoder'

describe('native barcode decoder', () => {
  it('maps native QR corner points without copying camera pixels', async () => {
    const detector: NativeBarcodeDetector = {
      detect: vi.fn().mockResolvedValue([{
        rawValue: 'Elliot',
        cornerPoints: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 40 },
          { x: 10, y: 40 },
        ],
      }]),
    }

    await expect(detectNativeQr(detector, document.createElement('video'))).resolves.toEqual({
      data: 'Elliot',
      location: {
        topLeftCorner: { x: 10, y: 20 },
        topRightCorner: { x: 30, y: 20 },
        bottomRightCorner: { x: 30, y: 40 },
        bottomLeftCorner: { x: 10, y: 40 },
      },
    })
  })

  it('falls back to the native bounding box and ignores empty detections', async () => {
    const detector: NativeBarcodeDetector = {
      detect: vi.fn()
        .mockResolvedValueOnce([{ rawValue: 'Tate', boundingBox: { x: 1, y: 2, width: 3, height: 4 } }])
        .mockResolvedValueOnce([]),
    }
    const video = document.createElement('video')

    expect((await detectNativeQr(detector, video))?.location).toEqual({
      topLeftCorner: { x: 1, y: 2 },
      topRightCorner: { x: 4, y: 2 },
      bottomRightCorner: { x: 4, y: 6 },
      bottomLeftCorner: { x: 1, y: 6 },
    })
    await expect(detectNativeQr(detector, video)).resolves.toBeNull()
  })

  it('returns multiple simultaneous native detections', async () => {
    const detector: NativeBarcodeDetector = {
      detect: vi.fn().mockResolvedValue([
        { rawValue: 'Black', boundingBox: { x: 1, y: 2, width: 3, height: 4 } },
        { rawValue: 'White', boundingBox: { x: 10, y: 20, width: 5, height: 6 } },
        { rawValue: '', boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    }
    await expect(detectNativeQrs(detector, document.createElement('video')))
      .resolves.toMatchObject([{ data: 'Black' }, { data: 'White' }])
  })

  it('rejects a native detector that hangs', async () => {
    vi.useFakeTimers()
    const detector: NativeBarcodeDetector = {
      detect: vi.fn((): Promise<never> => new Promise(() => undefined)),
    }
    const detection = detectNativeQr(detector, document.createElement('video'), 100)
    const assertion = expect(detection).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    vi.useRealTimers()
  })

  it('checks native QR support before constructing a detector', async () => {
    const constructor = vi.fn()
    Object.assign(constructor, { getSupportedFormats: vi.fn().mockResolvedValue(['aztec']) })
    vi.stubGlobal('BarcodeDetector', constructor)

    await expect(createNativeBarcodeDetector()).resolves.toBeNull()
    expect(constructor).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
