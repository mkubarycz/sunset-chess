import type { QrDetection } from './scanner'

export interface ZxingReadResult {
  text: string
  symbology: string
  position: {
    topLeft: { x: number; y: number }
    topRight: { x: number; y: number }
    bottomRight: { x: number; y: number }
    bottomLeft: { x: number; y: number }
  }
}

export function mapZxingResults(results: readonly ZxingReadResult[]): QrDetection[] {
  return results
    .filter(({ text, symbology }) => text.length > 0 && symbology === 'QRCode')
    .slice(0, 4)
    .map(({ text, position }) => ({
      data: text,
      location: {
        topLeftCorner: position.topLeft,
        topRightCorner: position.topRight,
        bottomRightCorner: position.bottomRight,
        bottomLeftCorner: position.bottomLeft,
      },
    }))
}
