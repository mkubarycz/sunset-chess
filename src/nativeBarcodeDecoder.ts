import type { Point, QrDetection } from './scanner'

interface NativeBarcode {
  rawValue: string
  cornerPoints?: Point[]
  boundingBox?: Pick<DOMRectReadOnly, 'x' | 'y' | 'width' | 'height'>
}

export interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<NativeBarcode[]>
}

interface BarcodeDetectorConstructor {
  new(options: { formats: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

export const NATIVE_DECODE_TIMEOUT_MS = 1_000

export async function createNativeBarcodeDetector(): Promise<NativeBarcodeDetector | null> {
  const constructor = (
    globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector
  if (!constructor) return null
  try {
    const formats = await constructor.getSupportedFormats?.()
    if (formats && !formats.includes('qr_code')) return null
    return new constructor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

export async function detectNativeQr(
  detector: NativeBarcodeDetector,
  video: HTMLVideoElement,
  timeoutMs = NATIVE_DECODE_TIMEOUT_MS,
): Promise<QrDetection | null> {
  return (await detectNativeQrs(detector, video, timeoutMs))[0] ?? null
}

export async function detectNativeQrs(
  detector: NativeBarcodeDetector,
  video: HTMLVideoElement,
  timeoutMs = NATIVE_DECODE_TIMEOUT_MS,
): Promise<QrDetection[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Native QR detector timed out')), timeoutMs)
  })
  const barcodes = await Promise.race([detector.detect(video), timeoutPromise])
    .finally(() => clearTimeout(timeout))
  return barcodes.flatMap((barcode) => {
    if (!barcode.rawValue) return []
    const corners = barcode.cornerPoints?.length === 4
      ? barcode.cornerPoints
      : cornersFromBoundingBox(barcode.boundingBox)
    if (!corners) return []
    return [{
      data: barcode.rawValue,
      location: {
        topLeftCorner: corners[0],
        topRightCorner: corners[1],
        bottomRightCorner: corners[2],
        bottomLeftCorner: corners[3],
      },
    }]
  })
}

function cornersFromBoundingBox(
  box: NativeBarcode['boundingBox'],
): [Point, Point, Point, Point] | null {
  if (!box) return null
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ]
}
