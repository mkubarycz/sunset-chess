import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import {
  mapDetectionToPreview,
  mirroredCoverPoint,
  overlayLabelPosition,
  previewViewportSize,
} from './geometry'
import { detectionCenter, pointInRect, resultZoneRect } from './actionZones'
import {
  resizeCanvasToDisplaySize,
  retainFreshDetection,
  scanDimensions,
  type QrDetection,
} from './scanner'

const detection: QrDetection = {
  data: 'sunset-chess:test',
  location: {
    topLeftCorner: { x: 10, y: 20 },
    topRightCorner: { x: 90, y: 20 },
    bottomRightCorner: { x: 90, y: 80 },
    bottomLeftCorner: { x: 10, y: 80 },
  },
}

describe('QR scanner helpers', () => {
  it('detects a real generated QR fixture', () => {
    const qr = QRCode.create('sunset-chess:fixture', { errorCorrectionLevel: 'M' })
    const quiet = 4
    const scale = 5
    const size = (qr.modules.size + quiet * 2) * scale
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255)
    for (let row = 0; row < qr.modules.size; row += 1) {
      for (let column = 0; column < qr.modules.size; column += 1) {
        if (!qr.modules.get(row, column)) continue
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            const index = (((row + quiet) * scale + y) * size + (column + quiet) * scale + x) * 4
            pixels[index] = 0
            pixels[index + 1] = 0
            pixels[index + 2] = 0
          }
        }
      }
    }
    expect(jsQR(pixels, size, size)?.data).toBe('sunset-chess:fixture')
  })

  it('maps intrinsic points through cover cropping and horizontal mirroring', () => {
    expect(mirroredCoverPoint(
      { x: 0, y: 0 },
      { width: 640, height: 480 },
      { width: 400, height: 400 },
    )).toEqual({ x: 466.6666666666667, y: 0 })
    const bottomRight = mirroredCoverPoint(
      { x: 640, y: 480 },
      { width: 640, height: 480 },
      { width: 400, height: 400 },
    )
    expect(bottomRight.x).toBeCloseTo(-66.6667)
    expect(bottomRight.y).toBe(400)

    expect(mirroredCoverPoint(
      { x: 480, y: 270 },
      { width: 1920, height: 1080 },
      { width: 400, height: 400 },
      { width: 960, height: 540 },
    )).toEqual({ x: 200, y: 200 })
  })

  it.each([
    {
      video: { width: 1920, height: 1080 },
      sourceCenter: { x: 1664.492308, y: 337.292308 },
    },
    {
      video: { width: 400, height: 300 },
      sourceCenter: { x: 369.6, y: 101.2 },
    },
  ])('maps $video.width×$video.height QR centers into CSS-sized result zones', ({
    video,
    sourceCenter,
  }) => {
    const viewport = { width: 1000, height: 650 }
    const sourceDetection: QrDetection = {
      data: 'player',
      location: {
        topLeftCorner: { x: sourceCenter.x - 8, y: sourceCenter.y - 8 },
        topRightCorner: { x: sourceCenter.x + 8, y: sourceCenter.y - 8 },
        bottomRightCorner: { x: sourceCenter.x + 8, y: sourceCenter.y + 8 },
        bottomLeftCorner: { x: sourceCenter.x - 8, y: sourceCenter.y + 8 },
      },
    }
    const mapped = mapDetectionToPreview(sourceDetection, video, viewport)
    const zone = resultZoneRect('left', 'winner', viewport.width, viewport.height)

    expect(zone).toEqual({ x: 20, y: 147, width: 112, height: 112 })
    expect(detectionCenter(mapped).x).toBeCloseTo(76, 3)
    expect(detectionCenter(mapped).y).toBeCloseTo(203, 3)
    expect(pointInRect(detectionCenter(mapped), zone)).toBe(true)
  })

  it('prefers the CSS preview size over video diagnostics and only falls back when unmeasured', () => {
    expect(previewViewportSize(
      { width: 1000, height: 650 },
      { width: 400, height: 300 },
    )).toEqual({ width: 1000, height: 650 })
    expect(previewViewportSize(
      { width: 0, height: 0 },
      { width: 400, height: 300 },
    )).toEqual({ width: 400, height: 300 })
  })

  it('bounds scan dimensions without changing the source aspect ratio', () => {
    expect(scanDimensions(3840, 2160)).toEqual({ width: 1440, height: 810 })
    expect(scanDimensions(640, 480)).toEqual({ width: 640, height: 480 })
    expect(scanDimensions(1080, 1920)).toEqual({ width: 810, height: 1440 })
  })

  it('resizes an overlay backing canvas only when CSS size or DPR changes', () => {
    const canvas = document.createElement('canvas')
    expect(resizeCanvasToDisplaySize(canvas, 320, 180, 2)).toBe(true)
    expect([canvas.width, canvas.height]).toEqual([640, 360])
    expect(resizeCanvasToDisplaySize(canvas, 320, 180, 2)).toBe(false)
    expect(resizeCanvasToDisplaySize(canvas, 320, 180, 1)).toBe(true)
    expect([canvas.width, canvas.height]).toEqual([320, 180])
  })

  it('retains a missed detection briefly, then clears it', () => {
    const first = retainFreshDetection(null, detection, 1000)
    expect(retainFreshDetection(first, null, 1800)).toBe(first)
    expect(retainFreshDetection(first, null, 1901)).toBeNull()
  })

  it('places the label beside a polygon and clamps it inside the preview', () => {
    const viewport = { width: 400, height: 300 }
    const label = { width: 120, height: 58 }
    expect(overlayLabelPosition([
      { x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 20, y: 100 },
    ], viewport, label)).toEqual({ x: 110, y: 20 })
    const clamped = overlayLabelPosition([
      { x: 350, y: 280 }, { x: 395, y: 280 }, { x: 395, y: 300 }, { x: 350, y: 300 },
    ], viewport, label)
    expect(clamped).toEqual({ x: 220, y: 234 })
  })
})
