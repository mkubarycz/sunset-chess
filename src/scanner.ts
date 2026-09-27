export interface Point {
  x: number
  y: number
}

export interface QrDetection {
  data: string
  location: {
    topLeftCorner: Point
    topRightCorner: Point
    bottomRightCorner: Point
    bottomLeftCorner: Point
  }
}

export interface RememberedDetection {
  detection: QrDetection
  seenAt: number
}

export const SCAN_INTERVAL_MS = 150
export const NATIVE_SCAN_INTERVAL_MS = 50
export const STALE_AFTER_MS = 900
// The worker fallback trades CPU for source detail; native BarcodeDetector still sees full video.
export const MAX_SCAN_DIMENSION = 1440

export function scanDimensions(
  width: number,
  height: number,
  maxDimension = MAX_SCAN_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxDimension <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  devicePixelRatio: number,
): boolean {
  const backingWidth = Math.round(width * devicePixelRatio)
  const backingHeight = Math.round(height * devicePixelRatio)
  if (canvas.width === backingWidth && canvas.height === backingHeight) return false
  canvas.width = backingWidth
  canvas.height = backingHeight
  return true
}

export function retainFreshDetection(
  previous: RememberedDetection | null,
  next: QrDetection | null,
  now: number,
  staleAfterMs = STALE_AFTER_MS,
): RememberedDetection | null {
  if (next) return { detection: next, seenAt: now }
  if (previous && now - previous.seenAt <= staleAfterMs) return previous
  return null
}
