export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920, max: 3840 },
    height: { ideal: 1080, max: 2160 },
    frameRate: { ideal: 60 },
  },
}

type CameraMode = 'continuous' | string

interface ExtendedCameraCapabilities extends MediaTrackCapabilities {
  focusMode?: readonly CameraMode[]
  exposureMode?: readonly CameraMode[]
  whiteBalanceMode?: readonly CameraMode[]
  zoom?: { min: number; max: number; step?: number }
}

interface ExtendedCameraSettings extends MediaTrackSettings {
  focusMode?: CameraMode
  exposureMode?: CameraMode
  whiteBalanceMode?: CameraMode
  zoom?: number
}

interface ExtendedCameraConstraintSet extends MediaTrackConstraintSet {
  focusMode?: CameraMode
  exposureMode?: CameraMode
  whiteBalanceMode?: CameraMode
}

export type OptionalCameraControl = 'focus' | 'exposure' | 'white balance'
export type OptionalCameraControlState = 'unsupported' | 'active' | 'requested' | 'failed'

export interface CameraControlDiagnostic {
  control: OptionalCameraControl
  state: OptionalCameraControlState
  current?: string
}

export interface CameraDiagnostics {
  width?: number
  height?: number
  frameRate?: number
  controls: CameraControlDiagnostic[]
  zoom: {
    supported: boolean
    current?: number
    min?: number
    max?: number
    applied: false
  }
}

const optionalControls = [
  ['focus', 'focusMode'],
  ['exposure', 'exposureMode'],
  ['white balance', 'whiteBalanceMode'],
] as const

function capabilitiesOf(track: MediaStreamTrack): ExtendedCameraCapabilities {
  return typeof track.getCapabilities === 'function'
    ? track.getCapabilities() as ExtendedCameraCapabilities
    : {}
}

function settingsOf(track: MediaStreamTrack): ExtendedCameraSettings {
  return typeof track.getSettings === 'function'
    ? track.getSettings() as ExtendedCameraSettings
    : {}
}

export async function configureCameraTrack(
  track: MediaStreamTrack,
): Promise<CameraDiagnostics> {
  let capabilities: ExtendedCameraCapabilities = {}
  try {
    capabilities = capabilitiesOf(track)
  } catch {
    // Capability inspection is optional and must not prevent camera startup.
  }

  const advanced: ExtendedCameraConstraintSet[] = optionalControls.flatMap(([, field]) =>
    capabilities[field]?.includes('continuous') ? [{ [field]: 'continuous' }] : [])
  let tuningFailed = false
  if (advanced.length > 0 && typeof track.applyConstraints === 'function') {
    try {
      await track.applyConstraints({ advanced })
    } catch {
      tuningFailed = true
    }
  }

  let settings: ExtendedCameraSettings = {}
  try {
    settings = settingsOf(track)
  } catch {
    // Readback is diagnostic-only.
  }
  return {
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    controls: optionalControls.map(([control, field]) => {
      const supported = capabilities[field]?.includes('continuous') ?? false
      return {
        control,
        state: supported
          ? tuningFailed ? 'failed' : settings[field] === 'continuous' ? 'active' : 'requested'
          : 'unsupported',
        current: settings[field],
      }
    }),
    zoom: {
      supported: capabilities.zoom !== undefined,
      current: settings.zoom,
      min: capabilities.zoom?.min,
      max: capabilities.zoom?.max,
      applied: false,
    },
  }
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '?' : Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatCameraDiagnostics(diagnostics: CameraDiagnostics | null): string {
  if (!diagnostics) return 'camera settings unavailable'
  const resolution = `${formatNumber(diagnostics.width)}×${formatNumber(diagnostics.height)}`
  const frameRate = `${formatNumber(diagnostics.frameRate)} fps`
  const controls = diagnostics.controls.map(({ control, state, current }) =>
    `${control} ${state}${current ? ` (${current})` : ''}`).join(', ')
  const zoom = diagnostics.zoom.supported
    ? `zoom supported${diagnostics.zoom.current === undefined ? '' : ` (${formatNumber(diagnostics.zoom.current)}×)`}, not applied`
    : 'zoom unsupported'
  return `${resolution} @ ${frameRate} · ${controls} · ${zoom}`
}
