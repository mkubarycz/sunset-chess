import type { Point, QrDetection } from './scanner'

export interface Size {
  width: number
  height: number
}

export function previewViewportSize(
  preview: Size,
  fallback: Size,
): Size {
  return {
    width: preview.width > 0 ? preview.width : fallback.width,
    height: preview.height > 0 ? preview.height : fallback.height,
  }
}

export function mirroredCoverPoint(
  point: Point,
  video: Size,
  viewport: Size,
  source = video,
): Point {
  const scale = Math.max(viewport.width / video.width, viewport.height / video.height)
  const offsetX = (viewport.width - video.width * scale) / 2
  const offsetY = (viewport.height - video.height * scale) / 2
  const unmirroredX = offsetX + point.x * video.width / source.width * scale
  return {
    x: viewport.width - unmirroredX,
    y: offsetY + point.y * video.height / source.height * scale,
  }
}

export function mapDetectionToPreview(
  detection: QrDetection,
  video: Size,
  viewport: Size,
  source = video,
): QrDetection {
  const mapPoint = (point: Point) => mirroredCoverPoint(point, video, viewport, source)
  return {
    ...detection,
    location: {
      topLeftCorner: mapPoint(detection.location.topLeftCorner),
      topRightCorner: mapPoint(detection.location.topRightCorner),
      bottomRightCorner: mapPoint(detection.location.bottomRightCorner),
      bottomLeftCorner: mapPoint(detection.location.bottomLeftCorner),
    },
  }
}

export function overlayLabelPosition(
  corners: Point[],
  viewport: { width: number; height: number },
  label: { width: number; height: number },
  gap = 10,
  padding = 8,
): Point {
  const minX = Math.min(...corners.map(({ x }) => x))
  const maxX = Math.max(...corners.map(({ x }) => x))
  const minY = Math.min(...corners.map(({ y }) => y))
  const maxLeft = Math.max(padding, viewport.width - label.width - padding)
  const preferred = maxX + gap
  const left = preferred + label.width <= viewport.width - padding
    ? preferred
    : minX - gap - label.width
  return {
    x: Math.min(maxLeft, Math.max(padding, left)),
    y: Math.min(
      Math.max(padding, viewport.height - label.height - padding),
      Math.max(padding, minY),
    ),
  }
}
