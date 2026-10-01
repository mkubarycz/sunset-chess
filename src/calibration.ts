import type { Rect } from './actionZones'

export const CALIBRATION_KEY = 'sunset-chess:camera-calibration'
export const CALIBRATION_VERSION = 1

export interface CameraCalibration {
  version: 1
  usableInsetPercent: number
  zoneOffsetXPercent: number
  zoneOffsetYPercent: number
  zoneScalePercent: number
}

export const defaultCalibration = (): CameraCalibration => ({
  version: CALIBRATION_VERSION,
  usableInsetPercent: 0,
  zoneOffsetXPercent: 0,
  zoneOffsetYPercent: 0,
  zoneScalePercent: 100,
})

function bounded(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

export function parseCalibration(raw: string | null): CameraCalibration {
  if (raw === null) return defaultCalibration()
  const value = JSON.parse(raw) as Partial<CameraCalibration>
  if (value.version !== CALIBRATION_VERSION
    || !bounded(value.usableInsetPercent, 0, 20)
    || !bounded(value.zoneOffsetXPercent, -20, 20)
    || !bounded(value.zoneOffsetYPercent, -20, 20)
    || !bounded(value.zoneScalePercent, 70, 130)) {
    throw new Error('Invalid camera calibration.')
  }
  return value as CameraCalibration
}

export function loadCalibration(storage: Pick<Storage, 'getItem'> = localStorage): {
  calibration: CameraCalibration
  error: string
} {
  try {
    return { calibration: parseCalibration(storage.getItem(CALIBRATION_KEY)), error: '' }
  } catch {
    return {
      calibration: defaultCalibration(),
      error: 'Saved camera calibration was corrupt and has been reset.',
    }
  }
}

export function saveCalibration(
  calibration: CameraCalibration,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(CALIBRATION_KEY, JSON.stringify(calibration))
}

export function calibratedRect(
  rect: Rect,
  viewport: { width: number; height: number },
  calibration: CameraCalibration,
): Rect {
  const inset = Math.min(viewport.width, viewport.height) * calibration.usableInsetPercent / 100
  const usable = {
    x: inset,
    y: inset,
    width: Math.max(1, viewport.width - inset * 2),
    height: Math.max(1, viewport.height - inset * 2),
  }
  const scale = calibration.zoneScalePercent / 100
  const width = Math.min(usable.width, Math.max(1, rect.width * scale))
  const height = Math.min(usable.height, Math.max(1, rect.height * scale))
  const centerX = rect.x + rect.width / 2
    + viewport.width * calibration.zoneOffsetXPercent / 100
  const centerY = rect.y + rect.height / 2
    + viewport.height * calibration.zoneOffsetYPercent / 100
  return {
    x: Math.min(usable.x + usable.width - width, Math.max(usable.x, centerX - width / 2)),
    y: Math.min(usable.y + usable.height - height, Math.max(usable.y, centerY - height / 2)),
    width,
    height,
  }
}

export function calibrationQuality(
  video: { width: number; height: number },
  playerMarkerPresent: boolean,
): { level: 'pass' | 'warning'; message: string } {
  if (video.width < 1280 || video.height < 720) {
    return { level: 'warning', message: 'Camera resolution is below 1280×720; small markers may decode unreliably.' }
  }
  if (!playerMarkerPresent) {
    return { level: 'warning', message: 'Place a player marker in view to verify representative tracking.' }
  }
  return { level: 'pass', message: 'Usable framing and a tracked player marker are observable.' }
}
