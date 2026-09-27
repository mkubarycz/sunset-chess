import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  featuredFirst,
  gameIdentityKey,
  isSameGame,
  mergeCheckedInGame,
  retainFeaturedGame,
  type GameIdentity,
} from './gamePresentation'
import {
  mapDetectionToPreview,
  overlayLabelPosition,
  previewViewportSize,
} from './geometry'
import {
  createNativeBarcodeDetector,
  detectNativeQrs,
  type NativeBarcodeDetector,
} from './nativeBarcodeDecoder'
import {
  encodePlayerReference,
  normalizePlayerName,
  parseQrPayload,
  type PlayerPayload,
} from './qrPayload'
import {
  resizeCanvasToDisplaySize,
  scanDimensions,
  NATIVE_SCAN_INTERVAL_MS,
  SCAN_INTERVAL_MS,
  type QrDetection,
  type RememberedDetection,
} from './scanner'
import {
  cadenceRates,
  emptyTrackingState,
  observeDetection,
  sampleTracking,
  type CadenceState,
  type TrackingPhase,
  type TrackingState,
} from './qrTracking'
import {
  CAMERA_CONSTRAINTS,
  configureCameraTrack,
  formatCameraDiagnostics,
  type CameraDiagnostics,
} from './cameraConfiguration'
import {
  createResultZones,
  createDisabledResultZones,
  blockReentryLatch,
  emptyCheckInState,
  emptyHoldState,
  emptyLaneBindingState,
  evaluateResultChoices,
  matchGameContext,
  openReentryLatch,
  updateCheckInZones,
  updateHold,
  updateLaneBinding,
  updateReentryLatch,
  type ActionZone,
  type CheckInState,
  type GameContext,
  type HoldState,
  type LaneBindingState,
  type PlayerDetection,
  type ReentryLatchState,
} from './actionZones'
import { ActionZoneView } from './ActionZoneView'
import { GameCard, type OngoingGame } from './GameCard'
import { createQrWorker, WorkerDecoder } from './workerDecoder'
import { encodeQrDataUrl } from './qrArtwork'
import './App.css'

type CameraState = 'initial' | 'requesting' | 'active' | 'inactive' | 'denied' | 'unavailable' | 'insecure' | 'error'
type ScheduledFrame =
  | { kind: 'video'; id: number; watchdogId: number }
  | { kind: 'animation'; id: number }
  | { kind: 'timer'; id: number }
  | null

export const CAMERA_INACTIVITY_MS = 5 * 60 * 1000
export const VIDEO_FRAME_CALLBACK_WATCHDOG_MS = 500

const stateCopy: Record<CameraState, { title: string; detail: string }> = {
  initial: { title: 'Ready when you are', detail: 'Point your camera at a QR code. Frames stay on this device.' },
  requesting: { title: 'Waiting for camera permission', detail: 'Use your browser prompt to allow camera access.' },
  active: { title: 'Scanning for a QR code', detail: 'Hold the code steady inside the camera view.' },
  inactive: {
    title: 'Camera paused after 5 minutes without a QR code',
    detail: 'Restart the camera when you are ready to scan again.',
  },
  denied: { title: 'Camera permission was denied', detail: 'Allow camera access in your browser settings, then try again.' },
  unavailable: { title: 'No camera is available', detail: 'Connect or enable a camera, then try again.' },
  insecure: { title: 'A secure connection is required', detail: 'Open this scanner over HTTPS or on localhost to use the camera.' },
  error: { title: 'The QR scanner stopped', detail: 'Restart the camera to recover the local decoder.' },
}

async function defaultFinalizeGame(
  gameId: number,
  result: '1-0' | '0-1' | '1/2-1/2',
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/games/${gameId}/result`, {
    method: 'PATCH',
    signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ result }),
  })
  const body = await response.json() as { error?: string }
  if (!response.ok) {
    throw new Error(body.error || `Result request failed (${response.status}).`)
  }
}

async function defaultCreatePlayer(name: string, signal: AbortSignal): Promise<PlayerPayload> {
  const response = await fetch('/api/players', {
    method: 'POST',
    signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await response.json() as { player?: { id: number; name: string }; error?: string }
  if (!response.ok || !body.player) {
    throw new Error(body.error || `Player creation failed (${response.status}).`)
  }
  return { v: 1, kind: 'player', playerId: body.player.id, name: body.player.name }
}

async function defaultResolvePlayer(playerId: number, signal: AbortSignal): Promise<PlayerPayload> {
  const response = await fetch(`/api/players/${playerId}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  const body = await response.json() as { player?: { id: number; name: string }; error?: string }
  if (!response.ok || !body.player) {
    throw new Error(body.error || `Player lookup failed (${response.status}).`)
  }
  return { v: 1, kind: 'player', playerId: body.player.id, name: body.player.name }
}

function classifyCameraError(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'unavailable'
  return 'error'
}

interface AppProps {
  workerFactory?: () => Worker
  nativeDetectorFactory?: () => NativeBarcodeDetector | null | Promise<NativeBarcodeDetector | null>
  qrEncoder?: (value: string) => Promise<string>
  createPlayer?: (name: string, signal: AbortSignal) => Promise<PlayerPayload>
  resolvePlayer?: (playerId: number, signal: AbortSignal) => Promise<PlayerPayload>
  fetchGames?: (signal: AbortSignal) => Promise<GameFeed | OngoingGame[]>
  checkInPlayer?: (player: PlayerPayload, signal: AbortSignal) => Promise<CheckInResult>
  finalizeGame?: (
    gameId: number,
    result: '1-0' | '0-1' | '1/2-1/2',
    signal: AbortSignal,
  ) => Promise<void>
  gamesPollIntervalMs?: number
}

export type { OngoingGame } from './GameCard'

export interface GameFeed {
  games: OngoingGame[]
  recentGames: OngoingGame[]
}

export type CheckInResult = {
  status: 'paired' | 'waiting' | 'already-checked-in'
  game: OngoingGame
  side: 'black' | 'white'
}

type CheckInTransition = {
  id: number
  game: GameIdentity
  player: PlayerPayload
  sourceZoneId: string
}

function actionZonesKey(zones: readonly ActionZone[]): string {
  return zones.map((zone) =>
    `${zone.id}:${zone.rect.x}:${zone.rect.y}:${zone.rect.width}:${zone.rect.height}:`
    + `${zone.occupant?.playerId ?? ''}:${zone.status}:${zone.completion.completed}`)
    .join('|')
}

async function defaultFetchGames(signal: AbortSignal): Promise<GameFeed> {
  const response = await fetch('/api/games', { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Games request failed (${response.status}).`)
  const body = await response.json() as { games?: unknown; recentGames?: unknown }
  if (!Array.isArray(body.games) || !Array.isArray(body.recentGames)) {
    throw new Error('Games response was invalid.')
  }
  return body as GameFeed
}

async function defaultCheckInPlayer(
  player: PlayerPayload,
  signal: AbortSignal,
): Promise<CheckInResult> {
  const response = await fetch('/api/check-ins', {
    method: 'POST',
    signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: player.playerId, name: player.name }),
  })
  const body = await response.json() as CheckInResult | { error?: string }
  if (!response.ok) {
    throw new Error('error' in body && body.error
      ? body.error
      : `Check-in request failed (${response.status}).`)
  }
  return body as CheckInResult
}
export default function App({
  workerFactory = createQrWorker,
  nativeDetectorFactory = createNativeBarcodeDetector,
  qrEncoder = encodeQrDataUrl,
  createPlayer = defaultCreatePlayer,
  resolvePlayer = defaultResolvePlayer,
  fetchGames = defaultFetchGames,
  checkInPlayer = defaultCheckInPlayer,
  finalizeGame = defaultFinalizeGame,
  gamesPollIntervalMs = 2000,
}: AppProps) {
  const [cameraState, setCameraState] = useState<CameraState>(
    window.isSecureContext === false ? 'insecure' : 'initial',
  )
  const [remembered, setRemembered] = useState<RememberedDetection | null>(null)
  const [name, setName] = useState('')
  const [producerError, setProducerError] = useState('')
  const [player, setPlayer] = useState<PlayerPayload | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [, setResolverRevision] = useState(0)
  const [games, setGames] = useState<OngoingGame[]>([])
  const [recentGames, setRecentGames] = useState<OngoingGame[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [gamesError, setGamesError] = useState('')
  const [checkInNotice, setCheckInNotice] = useState('')
  const [checkInError, setCheckInError] = useState(false)
  const [featuredGame, setFeaturedGame] = useState<GameIdentity | null>(null)
  const [checkInTransitions, setCheckInTransitions] = useState<CheckInTransition[]>([])
  const [actionZones, setActionZones] = useState<ActionZone[]>([])
  const [gameContext, setGameContext] = useState<GameContext | null>(null)
  const [overlayMessage, setOverlayMessage] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const payloadLabelRef = useRef<HTMLDivElement>(null)
  const actionZoneRefs = useRef(new Map<string, HTMLDivElement>())
  const actionProgressRefs = useRef(new Map<string, HTMLDivElement>())
  const gamesListRef = useRef<HTMLDivElement>(null)
  const gameCardRefs = useRef(new Map<string, HTMLElement>())
  const transitionSequenceRef = useRef(0)
  const transitionCleanupRef = useRef(new Set<() => void>())
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const captureRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scheduleRef = useRef<ScheduledFrame>(null)
  const timerFallbackRef = useRef(false)
  const inactivityTimerRef = useRef<number | null>(null)
  const lastScanRef = useRef(0)
  const rememberedRef = useRef<RememberedDetection | null>(null)
  const trackingRefs = useRef(new Map<string, TrackingState>())
  const trackingPhaseRef = useRef('lost')
  const presenceStateRef = useRef('0 fresh / 0 present')
  const cameraDiagnosticsRef = useRef<CameraDiagnostics | null>(null)
  const diagnosticsRef = useRef<HTMLSpanElement>(null)
  const cadenceRef = useRef<CadenceState>({
    startedAt: performance.now(), cameraFrames: 0, decodes: 0, paints: 0,
  })
  const lastDiagnosticsRef = useRef(0)
  const scanSizeRef = useRef<{ width: number; height: number } | null>(null)
  const cameraGenerationRef = useRef(0)
  const decoderRef = useRef<WorkerDecoder | null>(null)
  const nativeDetectorRef = useRef<NativeBarcodeDetector | null>(null)
  const nativePendingGenerationRef = useRef<number | null>(null)
  const qrRequestRef = useRef(0)
  const playerCreationRef = useRef<AbortController | null>(null)
  const playerCacheRef = useRef(new Map<number, PlayerPayload>())
  const playerLookupRef = useRef(new Map<number, AbortController>())
  const playerLookupErrorRef = useRef(new Map<number, string>())
  const gamesRequestRef = useRef<AbortController | null>(null)
  const gamesRef = useRef<OngoingGame[]>([])
  const checkInRequestRef = useRef(new Map<number, AbortController>())
  const submittedCheckInRef = useRef(new Set<number>())
  const resultRequestRef = useRef<AbortController | null>(null)
  const gameContextRef = useRef<GameContext | null>(null)
  const resultHoldRef = useRef<HoldState>(emptyHoldState())
  const submittedResultRef = useRef<string | null>(null)
  const checkInStateRef = useRef<CheckInState>(emptyCheckInState())
  const actionZonesRef = useRef<ActionZone[]>([])
  const laneBindingRef = useRef<LaneBindingState>(emptyLaneBindingState())
  const reentryLatchRef = useRef<ReentryLatchState>(openReentryLatch())
  const overlayMessageRef = useRef('')
  const displayedGames = useMemo(
    () => featuredFirst(games, featuredGame),
    [featuredGame, games],
  )

  useEffect(() => {
    gamesRef.current = games
  }, [games])

  const clearResultMode = useCallback(() => {
    gameContextRef.current = null
    resultHoldRef.current = emptyHoldState()
    submittedResultRef.current = null
    setGameContext(null)
  }, [])

  const updateOverlayMessage = useCallback((message: string) => {
    if (overlayMessageRef.current === message) return
    overlayMessageRef.current = message
    setOverlayMessage(message)
  }, [])

  const cancelCheckInTransition = useCallback(() => {
    transitionCleanupRef.current.forEach((cleanup) => cleanup())
    transitionCleanupRef.current.clear()
    setCheckInTransitions([])
  }, [])

  const resetCheckInTargets = useCallback(() => {
    checkInStateRef.current = emptyCheckInState()
    actionZonesRef.current = []
    setActionZones([])
    actionProgressRefs.current.forEach((progress) => {
      progress.style.transform = 'scaleX(0)'
      progress.setAttribute('aria-valuenow', '0')
    })
  }, [])

  const refreshGames = useCallback(async (force = false) => {
    if (gamesRequestRef.current) {
      if (!force) return
      gamesRequestRef.current.abort()
    }
    const controller = new AbortController()
    gamesRequestRef.current = controller
    try {
      const response = await fetchGames(controller.signal)
      const next = Array.isArray(response) ? response : response.games
      const recent = Array.isArray(response) ? [] : response.recentGames
      if (!controller.signal.aborted) {
        setGames(next)
        setRecentGames(recent)
        setFeaturedGame((current) => retainFeaturedGame(next, current))
        setGamesError('')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setGamesError(error instanceof Error ? error.message : 'Could not load ongoing games.')
      }
    } finally {
      if (gamesRequestRef.current === controller) gamesRequestRef.current = null
      if (!controller.signal.aborted) setGamesLoading(false)
    }
  }, [fetchGames])

  const submitResult = useCallback((
    gameId: number,
    result: '1-0' | '0-1' | '1/2-1/2',
    dedupeKey: string,
    generation: number,
  ) => {
    if (resultRequestRef.current || submittedResultRef.current === dedupeKey) return
    submittedResultRef.current = dedupeKey
    const controller = new AbortController()
    resultRequestRef.current = controller
    setCheckInError(false)
    setCheckInNotice(`Recording ${result}…`)
    void finalizeGame(gameId, result, controller.signal).then(() => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      setCheckInNotice(`Result ${result} recorded. Ratings updated.`)
      reentryLatchRef.current = blockReentryLatch()
      trackingRefs.current.clear()
      rememberedRef.current = null
      setRemembered(null)
      clearResultMode()
      void refreshGames(true)
    }).catch((error) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      setCheckInError(true)
      setCheckInNotice(error instanceof Error ? error.message : 'Could not record the result.')
      submittedResultRef.current = null
      resultHoldRef.current = emptyHoldState()
    }).finally(() => {
      if (resultRequestRef.current === controller) resultRequestRef.current = null
    })
  }, [clearResultMode, finalizeGame, refreshGames])

  const requestPlayerResolution = useCallback((playerId: number, generation: number) => {
    if (
      playerCacheRef.current.has(playerId)
      || playerLookupRef.current.has(playerId)
      || playerLookupErrorRef.current.has(playerId)
    ) return
    const controller = new AbortController()
    playerLookupRef.current.set(playerId, controller)
    void resolvePlayer(playerId, controller.signal).then((resolved) => {
      if (
        controller.signal.aborted
        || generation !== cameraGenerationRef.current
        || resolved.playerId !== playerId
      ) return
      playerCacheRef.current.set(playerId, resolved)
      playerLookupErrorRef.current.delete(playerId)
      setResolverRevision((value) => value + 1)
    }).catch((error) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      const message = error instanceof Error ? error.message : `Player #${playerId} could not be resolved.`
      playerLookupErrorRef.current.set(playerId, message)
      setCheckInError(true)
      setCheckInNotice(`Player #${playerId} could not be resolved. ${message}`)
      setResolverRevision((value) => value + 1)
    }).finally(() => {
      if (playerLookupRef.current.get(playerId) === controller) {
        playerLookupRef.current.delete(playerId)
      }
    })
  }, [resolvePlayer])

  const submitCheckIn = useCallback((
    detectedPlayer: PlayerPayload,
    generation: number,
    sourceZoneId: string,
  ) => {
    const playerId = detectedPlayer.playerId
    if (
      gameContextRef.current?.resultReady
      || submittedCheckInRef.current.has(playerId)
      || checkInRequestRef.current.size > 0
      || checkInRequestRef.current.has(playerId)
    ) return
    submittedCheckInRef.current.add(playerId)
    const controller = new AbortController()
    checkInRequestRef.current.set(playerId, controller)
    setCheckInError(false)
    setCheckInNotice(`Checking in ${detectedPlayer.name}…`)
    void checkInPlayer(detectedPlayer, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      const side = result.side === 'black' ? 'Black' : 'White'
      if (result.status === 'paired') {
        setCheckInNotice(
          `${detectedPlayer.name} checked in — Table ${result.game.tableNumber}, ${side}`,
        )
      } else if (result.status === 'waiting') {
        setCheckInNotice(`Waiting for an opponent at Table ${result.game.tableNumber}`)
      } else {
        setCheckInNotice(
          `${detectedPlayer.name} is already checked in at Table ${result.game.tableNumber}`,
        )
      }
      setGames((current) => mergeCheckedInGame(current, result.game))
      setFeaturedGame({ id: result.game.id, createdAt: result.game.createdAt })
      if (result.status !== 'already-checked-in') {
        setCheckInTransitions((current) => [...current, {
          id: ++transitionSequenceRef.current,
          game: { id: result.game.id, createdAt: result.game.createdAt },
          player: detectedPlayer,
          sourceZoneId,
        }])
      }
      submittedCheckInRef.current.delete(playerId)
      void refreshGames(true)
    }).catch((error) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      setCheckInError(true)
      setCheckInNotice(
        `${error instanceof Error ? error.message : 'Check-in failed.'} Move the QR away, then try again.`,
      )
    }).finally(() => {
      if (checkInRequestRef.current.get(playerId) === controller) {
        checkInRequestRef.current.delete(playerId)
      }
    })
  }, [checkInPlayer, refreshGames])

  useEffect(() => {
    void refreshGames()
    const interval = window.setInterval(() => void refreshGames(), gamesPollIntervalMs)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshGames()
    }
    const refreshOnFocus = () => { void refreshGames() }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      gamesRequestRef.current?.abort()
      gamesRequestRef.current = null
    }
  }, [gamesPollIntervalMs, refreshGames])

  const cancelScheduledFrame = useCallback(() => {
    const scheduled = scheduleRef.current
    scheduleRef.current = null
    if (!scheduled) return
    if (scheduled.kind === 'video') {
      window.clearTimeout(scheduled.watchdogId)
      videoRef.current?.cancelVideoFrameCallback?.(scheduled.id)
    } else if (scheduled.kind === 'animation') {
      window.cancelAnimationFrame?.(scheduled.id)
    } else {
      window.clearTimeout(scheduled.id)
    }
  }, [])

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
  }, [])

  const stopCamera = useCallback((clearDetection = false) => {
    cancelCheckInTransition()
    cameraGenerationRef.current += 1
    clearInactivityTimer()
    checkInRequestRef.current.forEach((controller) => controller.abort())
    checkInRequestRef.current.clear()
    submittedCheckInRef.current.clear()
    laneBindingRef.current = emptyLaneBindingState()
    reentryLatchRef.current = openReentryLatch()
    updateOverlayMessage('')
    resetCheckInTargets()
    resultRequestRef.current?.abort()
    resultRequestRef.current = null
    playerLookupRef.current.forEach((controller) => controller.abort())
    playerLookupRef.current.clear()
    clearResultMode()
    cancelScheduledFrame()
    decoderRef.current?.terminate()
    decoderRef.current = null
    nativeDetectorRef.current = null
    nativePendingGenerationRef.current = null
    timerFallbackRef.current = false
    cameraDiagnosticsRef.current = null
    const stream = streamRef.current
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    stream?.getTracks().forEach((track) => track.stop())
    if (clearDetection) {
      rememberedRef.current = null
      trackingRefs.current.clear()
      scanSizeRef.current = null
      setRemembered(null)
    }
  }, [cancelCheckInTransition, cancelScheduledFrame, clearInactivityTimer, clearResultMode, resetCheckInTargets, updateOverlayMessage])

  const drawOverlay = useCallback((now = performance.now()) => {
    const video = videoRef.current
    const preview = previewRef.current
    const canvas = overlayRef.current
    if (!video || !preview || !canvas) return
    const { width, height } = previewViewportSize(
      { width: preview.clientWidth, height: preview.clientHeight },
      { width: video.clientWidth, height: video.clientHeight },
    )
    if (width <= 0 || height <= 0) return
    const ratio = window.devicePixelRatio || 1
    const resized = resizeCanvasToDisplaySize(canvas, width, height, ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    if (resized) context.scale(ratio, ratio)
    context.clearRect(0, 0, width, height)
    const scanSize = scanSizeRef.current
    if (!scanSize || !video.videoWidth || !video.videoHeight) return
    const visible: Array<{ detection: QrDetection; phase: TrackingPhase }> = []
    for (const [key, state] of trackingRefs.current) {
      const sample = sampleTracking(state, now)
      if (!sample.detection) {
        trackingRefs.current.delete(key)
        continue
      }
      trackingRefs.current.set(key, sample.state)
      const mapped = mapDetectionToPreview(
        sample.detection,
        { width: video.videoWidth, height: video.videoHeight },
        { width, height },
        scanSize,
      )
      visible.push({ detection: mapped, phase: sample.phase })
      const corners = Object.values(mapped.location)
      context.beginPath()
      context.moveTo(corners[0].x, corners[0].y)
      corners.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.closePath()
      context.lineWidth = 4
      context.strokeStyle = sample.phase === 'tracking' ? '#ffe29a' : 'rgba(255,226,154,.55)'
      context.shadowColor = 'rgba(17, 8, 28, .8)'
      context.shadowBlur = 8
      context.stroke()
    }
    trackingPhaseRef.current = visible.length === 0
      ? 'lost'
      : visible.every(({ phase }) => phase === 'tracking') ? 'tracking' : 'coasting'

    if (visible.length === 1) {
      const corners = Object.values(visible[0].detection.location)
      const labelPosition = overlayLabelPosition(corners, { width, height }, {
        width: Math.min(240, Math.max(120, width - 16)),
        height: 58,
      })
      if (payloadLabelRef.current) {
        payloadLabelRef.current.style.transform =
          `translate3d(${labelPosition.x}px, ${labelPosition.y}px, 0)`
      }
    }

    const resolvedPlayerDetection = (detection: QrDetection): PlayerDetection[] => {
      const parsed = parseQrPayload(detection.data)
      if (parsed.kind === 'player') return [{ ...parsed.player, detection }]
      if (parsed.kind !== 'player-reference') return []
      const playerId = parsed.reference.playerId
      const cached = playerCacheRef.current.get(playerId)
      if (cached) return [{ ...cached, detection }]
      requestPlayerResolution(playerId, cameraGenerationRef.current)
      return []
    }
    const presentPlayerDetections = visible.flatMap(({ detection }) =>
      resolvedPlayerDetection(detection))
    const freshPlayerDetections = visible.flatMap(({ detection, phase }): PlayerDetection[] => {
      if (phase !== 'tracking') return []
      return resolvedPlayerDetection(detection)
    })
    const presentPlayerIds = new Set(presentPlayerDetections.map(({ playerId }) => playerId))
    const freshPlayerIds = new Set(freshPlayerDetections.map(({ playerId }) => playerId))
    presenceStateRef.current =
      `${freshPlayerIds.size} fresh / ${presentPlayerIds.size} present`
    reentryLatchRef.current = updateReentryLatch(
      reentryLatchRef.current,
      freshPlayerDetections.length,
      now,
    )
    const tooManyPlayers = freshPlayerDetections.length > 2
    const relevantPresentPlayers = presentPlayerDetections.length <= 2
      ? presentPlayerDetections
      : presentPlayerDetections.filter(({ playerId }) =>
        freshPlayerIds.has(playerId) || laneBindingRef.current.lanes[playerId] !== undefined)
    const laneBinding = updateLaneBinding(
      laneBindingRef.current,
      tooManyPlayers ? [] : relevantPresentPlayers,
      width,
    )
    laneBindingRef.current = laneBinding.state
    if (laneBinding.changed) resultHoldRef.current = emptyHoldState()
    const interactionPlayers = reentryLatchRef.current.blocked || tooManyPlayers
      ? []
      : relevantPresentPlayers
    const matchedGame = matchGameContext(
      interactionPlayers,
      gamesRef.current,
      width,
      laneBinding.state.lanes,
    )
    if (matchedGame?.resultReady) {
      checkInRequestRef.current.forEach((controller) => controller.abort())
      checkInRequestRef.current.clear()
    }
    if (tooManyPlayers) {
      checkInRequestRef.current.forEach((controller) => controller.abort())
      checkInRequestRef.current.clear()
    }
    const blockedPlayerIds = reentryLatchRef.current.blocked
      ? presentPlayerIds
      : new Set<number>()
    const checkInPlayers = checkInRequestRef.current.size > 0
      ? relevantPresentPlayers.filter(({ playerId }) => submittedCheckInRef.current.has(playerId))
      : relevantPresentPlayers
    const checkInUpdate = updateCheckInZones(
      checkInStateRef.current,
      checkInPlayers,
      width,
      height,
      now,
      {
        enabled: !matchedGame && !tooManyPlayers,
        blockedPlayerIds,
        resetKey: String(cameraGenerationRef.current),
        freshPlayerIds,
      },
    )
    checkInStateRef.current = checkInUpdate.state
    submittedCheckInRef.current.forEach((playerId) => {
      if (!freshPlayerIds.has(playerId) && !checkInRequestRef.current.has(playerId)) {
        submittedCheckInRef.current.delete(playerId)
      }
    })
    for (const completion of checkInUpdate.completed) {
      const sourceZoneId = checkInUpdate.zones.find((zone) =>
        zone.occupant?.playerId === completion.playerId)?.id ?? 'check-in-left'
      submitCheckIn({
        v: 1,
        kind: 'player',
        playerId: completion.playerId,
        name: completion.name,
      }, cameraGenerationRef.current, sourceZoneId)
    }
    let nextZones = checkInUpdate.zones
    if (tooManyPlayers) {
      resultHoldRef.current = emptyHoldState()
      updateOverlayMessage('Too many player codes — show no more than two')
      if (gameContextRef.current && !resultRequestRef.current) clearResultMode()
    } else if (!matchedGame) {
      resultHoldRef.current = emptyHoldState()
      updateOverlayMessage('')
      if (gameContextRef.current && !resultRequestRef.current) clearResultMode()
    } else {
      if (gameContextRef.current?.key !== matchedGame.key) {
        resultHoldRef.current = emptyHoldState()
        setGameContext(matchedGame)
      }
      gameContextRef.current = matchedGame
      const evaluation = evaluateResultChoices(matchedGame, width, height)
      const bothFresh = matchedGame.opponent !== null
        && freshPlayerIds.has(matchedGame.anchor.playerId)
        && freshPlayerIds.has(matchedGame.opponent.playerId)
      const assignment = bothFresh ? evaluation.assignment : null
      const hold = updateHold(resultHoldRef.current, assignment?.key ?? null, now)
      resultHoldRef.current = hold.state
      updateOverlayMessage(evaluation.status === 'conflict' && bothFresh
          ? 'Result conflict — choose Win + Lose or Draw + Draw'
          : '')
      nextZones = matchedGame.resultReady
        ? createResultZones(matchedGame, width, height, hold, evaluation, !bothFresh)
        : createDisabledResultZones(matchedGame, width, height)
      if (hold.completedNow && assignment && matchedGame.opponent) {
        submitResult(
          matchedGame.game.id,
          assignment.result,
          assignment.key,
          cameraGenerationRef.current,
        )
      }
    }
    if (actionZonesKey(nextZones) !== actionZonesKey(actionZonesRef.current)) {
      actionZonesRef.current = nextZones
      setActionZones(nextZones)
    }
    for (const zone of nextZones) {
      const progress = actionProgressRefs.current.get(zone.id)
      if (progress) {
        const percentage = Math.round(zone.progress * 100)
        progress.style.transform = `scaleX(${zone.progress})`
        progress.setAttribute('aria-valuenow', String(percentage))
      }
    }
    cadenceRef.current.paints += visible.length > 0 ? 1 : 0
  }, [clearResultMode, requestPlayerResolution, submitCheckIn, submitResult, updateOverlayMessage])

  const recordDetections = useCallback((detections: readonly QrDetection[], now: number) => {
    cadenceRef.current.decodes += 1
    for (const detection of detections) {
      const previous = trackingRefs.current.get(detection.data) ?? emptyTrackingState()
      trackingRefs.current.set(detection.data, observeDetection(previous, detection, now))
    }
    if (detections.length === 1) {
      const detection = detections[0]
      const next = { detection, seenAt: now }
      rememberedRef.current = next
      setRemembered((current) =>
        current?.detection.data === detection.data ? current : next)
    } else if (detections.length > 1) {
      rememberedRef.current = null
      setRemembered(null)
    }
  }, [])

  const scheduleScan = useCallback((generation: number, callback: (time: number) => void) => {
    const video = videoRef.current
    if (!video || generation !== cameraGenerationRef.current) return
    if (video.requestVideoFrameCallback && !timerFallbackRef.current) {
      let id = 0
      const watchdogId = window.setTimeout(() => {
        const scheduled = scheduleRef.current
        if (
          scheduled?.kind !== 'video'
          || scheduled.id !== id
          || generation !== cameraGenerationRef.current
        ) return
        video.cancelVideoFrameCallback?.(id)
        scheduleRef.current = null
        timerFallbackRef.current = true
        callback(performance.now())
      }, VIDEO_FRAME_CALLBACK_WATCHDOG_MS)
      id = video.requestVideoFrameCallback((time) => {
        const scheduled = scheduleRef.current
        if (scheduled?.kind !== 'video' || scheduled.id !== id) return
        window.clearTimeout(scheduled.watchdogId)
        scheduleRef.current = null
        callback(time)
      })
      scheduleRef.current = { kind: 'video', id, watchdogId }
    } else if (timerFallbackRef.current) {
      const id = window.setTimeout(() => callback(performance.now()), 16)
      scheduleRef.current = { kind: 'timer', id }
    } else {
      const id = window.requestAnimationFrame(callback)
      scheduleRef.current = { kind: 'animation', id }
    }
  }, [])

  const armInactivityTimer = useCallback((generation: number) => {
    clearInactivityTimer()
    inactivityTimerRef.current = window.setTimeout(() => {
      if (generation !== cameraGenerationRef.current) return
      stopCamera(true)
      drawOverlay()
      setCheckInNotice('')
      setCheckInError(false)
      setCameraState('inactive')
    }, CAMERA_INACTIVITY_MS)
  }, [clearInactivityTimer, drawOverlay, stopCamera])

  const recordQrActivity = useCallback((generation: number, detections: readonly QrDetection[]) => {
    if (detections.length === 0 || generation !== cameraGenerationRef.current) return
    armInactivityTimer(generation)
  }, [armInactivityTimer])

  const activateWorkerDecoder = useCallback((generation: number) => {
    if (generation !== cameraGenerationRef.current || decoderRef.current) return
    nativeDetectorRef.current = null
    nativePendingGenerationRef.current = null
    rememberedRef.current = null
    trackingRefs.current.clear()
    clearResultMode()
    scanSizeRef.current = null
    setRemembered(null)
    drawOverlay()
    const handleDecoderFailure = () => {
      if (generation !== cameraGenerationRef.current) return
      stopCamera(true)
      drawOverlay()
      setCameraState('error')
    }
    try {
      decoderRef.current = new WorkerDecoder(workerFactory(), handleDecoderFailure)
    } catch {
      handleDecoderFailure()
    }
  }, [clearResultMode, drawOverlay, stopCamera, workerFactory])

  const scan = useCallback(function scanFrame(time: number, generation: number) {
    if (generation !== cameraGenerationRef.current) return
    scheduleRef.current = null
    cadenceRef.current.cameraFrames += 1
    drawOverlay(time)
    if (trackingPhaseRef.current === 'lost' && rememberedRef.current) {
      rememberedRef.current = null
      setRemembered(null)
    }
    if (time - lastDiagnosticsRef.current >= 1000) {
      const rates = cadenceRates(cadenceRef.current, time)
      if (diagnosticsRef.current) {
        diagnosticsRef.current.textContent =
          `${formatCameraDiagnostics(cameraDiagnosticsRef.current)} · `
          + `${rates.cameraFps.toFixed(0)} camera / ${rates.decodeFps.toFixed(0)} decode / ${rates.paintFps.toFixed(0)} paint fps`
          + ` · ${trackingPhaseRef.current} · ${presenceStateRef.current}`
      }
      cadenceRef.current = { startedAt: time, cameraFrames: 0, decodes: 0, paints: 0 }
      lastDiagnosticsRef.current = time
    }
    const video = videoRef.current
    const nativeDetector = nativeDetectorRef.current
    const decoder = decoderRef.current
    const scanInterval = nativeDetector ? NATIVE_SCAN_INTERVAL_MS : SCAN_INTERVAL_MS
    if (
      video
      && ((nativeDetector && nativePendingGenerationRef.current === null) || (decoder && !decoder.busy))
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && video.videoWidth && video.videoHeight
      && time - lastScanRef.current >= scanInterval
    ) {
      lastScanRef.current = time
      if (nativeDetector) {
        nativePendingGenerationRef.current = generation
        scanSizeRef.current = { width: video.videoWidth, height: video.videoHeight }
        void detectNativeQrs(nativeDetector, video).then((detections) => {
          if (nativePendingGenerationRef.current === generation) {
            nativePendingGenerationRef.current = null
          }
          if (generation !== cameraGenerationRef.current) return
          recordQrActivity(generation, detections)
          recordDetections(detections, performance.now())
        }).catch(() => {
          if (nativePendingGenerationRef.current === generation) {
            nativePendingGenerationRef.current = null
          }
          if (generation !== cameraGenerationRef.current) return
          activateWorkerDecoder(generation)
        })
      } else if (decoder) {
        const capture = captureRef.current ?? document.createElement('canvas')
        captureRef.current = capture
        const size = scanDimensions(video.videoWidth, video.videoHeight)
        capture.width = size.width
        capture.height = size.height
        scanSizeRef.current = size
        const context = capture.getContext('2d', { willReadFrequently: true })
        if (context) {
          context.drawImage(video, 0, 0, size.width, size.height)
          const pixels = context.getImageData(0, 0, size.width, size.height)
          const pending = decoder.decode(pixels.data.buffer as ArrayBuffer, size.width, size.height, generation)
          pending?.then((result) => {
            if (result.generation !== cameraGenerationRef.current) return
            const detections = result.detection ? [result.detection] : []
            recordQrActivity(generation, detections)
            recordDetections(detections, performance.now())
          }).catch(() => {
            if (generation !== cameraGenerationRef.current) return
            stopCamera(true)
            drawOverlay()
            setCameraState('error')
          })
        }
      }
    }
    scheduleScan(generation, (nextTime) => scanFrame(nextTime, generation))
  }, [activateWorkerDecoder, drawOverlay, recordDetections, recordQrActivity, scheduleScan, stopCamera])

  const startCamera = useCallback(async () => {
    stopCamera(true)
    const generation = cameraGenerationRef.current
    drawOverlay()
    if (window.isSecureContext === false) return setCameraState('insecure')
    if (!navigator.mediaDevices?.getUserMedia) return setCameraState('unavailable')
    setCameraState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      if (generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const videoTrack = stream.getVideoTracks()[0]
      cameraDiagnosticsRef.current = videoTrack
        ? await configureCameraTrack(videoTrack)
        : null
      const video = videoRef.current
      if (!video) return stream.getTracks().forEach((track) => track.stop())
      const handleEnded = () => {
        if (generation !== cameraGenerationRef.current || streamRef.current !== stream) return
        stopCamera(true)
        drawOverlay()
        setCameraState('unavailable')
      }
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', handleEnded, { once: true }))
      nativeDetectorRef.current = await nativeDetectorFactory()
      if (generation !== cameraGenerationRef.current || streamRef.current !== stream) return
      if (!nativeDetectorRef.current) activateWorkerDecoder(generation)
      video.srcObject = stream
      await video.play()
      if (generation !== cameraGenerationRef.current || streamRef.current !== stream) return
      setCameraState('active')
      armInactivityTimer(generation)
      cadenceRef.current = {
        startedAt: performance.now(), cameraFrames: 0, decodes: 0, paints: 0,
      }
      lastDiagnosticsRef.current = performance.now()
      lastScanRef.current = performance.now() - SCAN_INTERVAL_MS
      scheduleScan(generation, (time) => scan(time, generation))
    } catch (error) {
      if (generation !== cameraGenerationRef.current) return
      stopCamera()
      setCameraState(classifyCameraError(error))
    }
  }, [activateWorkerDecoder, armInactivityTimer, drawOverlay, nativeDetectorFactory, scan, scheduleScan, stopCamera])

  useEffect(() => {
    const deferredStart = window.setTimeout(() => void startCamera(), 0)
    return () => window.clearTimeout(deferredStart)
  }, [startCamera])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => drawOverlay())
    if (previewRef.current) observer.observe(previewRef.current)
    if (videoRef.current) observer.observe(videoRef.current)
    return () => observer.disconnect()
  }, [drawOverlay])

  useEffect(() => () => {
    playerCreationRef.current?.abort()
    stopCamera()
  }, [stopCamera])

  const generatePlayerQr = async () => {
    const request = ++qrRequestRef.current
    playerCreationRef.current?.abort()
    const controller = new AbortController()
    playerCreationRef.current = controller
    setPlayer(null)
    setQrDataUrl('')
    setProducerError('')
    try {
      const next = await createPlayer(normalizePlayerName(name), controller.signal)
      if (controller.signal.aborted || request !== qrRequestRef.current) return
      const encoded = encodePlayerReference(next.playerId)
      const url = await qrEncoder(encoded)
      if (controller.signal.aborted || request !== qrRequestRef.current) return
      playerCacheRef.current.set(next.playerId, next)
      setPlayer(next)
      setQrDataUrl(url)
    } catch (error) {
      if (controller.signal.aborted || request !== qrRequestRef.current) return
      setPlayer(null)
      setQrDataUrl('')
      setProducerError(error instanceof Error ? error.message : 'Could not generate QR code.')
    } finally {
      if (playerCreationRef.current === controller) playerCreationRef.current = null
    }
  }

  const copy = stateCopy[cameraState]
  const parsedRaw = remembered ? parseQrPayload(remembered.detection.data) : null
  const parsed = parsedRaw?.kind === 'player-reference'
    ? playerCacheRef.current.has(parsedRaw.reference.playerId)
      ? {
          kind: 'player' as const,
          player: playerCacheRef.current.get(parsedRaw.reference.playerId)!,
          label: `${playerCacheRef.current.get(parsedRaw.reference.playerId)!.name} · #${parsedRaw.reference.playerId}`,
        }
      : parsedRaw
    : parsedRaw
  const canStart = cameraState !== 'requesting' && cameraState !== 'insecure'

  useLayoutEffect(() => {
    const checkInTransition = checkInTransitions[0]
    if (!checkInTransition) return
    const list = gamesListRef.current
    const target = gameCardRefs.current.get(gameIdentityKey(checkInTransition.game))
    const source = actionZoneRefs.current.get(checkInTransition.sourceZoneId)

    if (!list || !target) {
      setCheckInTransitions((current) => current.slice(1))
      return
    }

    list.scrollTop = 0
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    target.classList.add('check-in-arrival')
    let highlightTimer = window.setTimeout(() => {
      target.classList.remove('check-in-arrival')
      highlightTimer = 0
    }, reducedMotion ? 500 : 1100)
    let token: HTMLDivElement | null = null
    let animation: Animation | null = null
    let frame = 0

    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame)
      animation?.cancel()
      token?.remove()
      target.classList.remove('check-in-arrival')
      if (highlightTimer) window.clearTimeout(highlightTimer)
    }
    transitionCleanupRef.current.add(cleanup)

    if (!reducedMotion && source) {
      frame = requestAnimationFrame(() => {
        const sourceRect = source.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        if (!sourceRect.width || !sourceRect.height || !targetRect.width || !targetRect.height) return
        token = document.createElement('div')
        token.className = 'check-in-token'
        token.setAttribute('aria-hidden', 'true')
        token.textContent = `${checkInTransition.player.name} · #${checkInTransition.player.playerId}`
        token.style.left = `${sourceRect.left + sourceRect.width / 2}px`
        token.style.top = `${sourceRect.top + sourceRect.height / 2}px`
        document.body.append(token)
        if (typeof token.animate !== 'function') {
          token.remove()
          token = null
          return
        }
        const deltaX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2)
        const deltaY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2)
        animation = token.animate([
          { transform: 'translate(-50%, -50%) scale(.72)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.16 },
          { transform: `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) scale(.62)`, opacity: 0.92, offset: 0.84 },
          { transform: `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) scale(.35)`, opacity: 0 },
        ], { duration: 720, easing: 'cubic-bezier(.22,.75,.25,1)', fill: 'forwards' })
        void animation.finished.catch(() => undefined).finally(() => {
          token?.remove()
          token = null
        })
      })
    }
    setCheckInTransitions((current) => current.slice(1))
  }, [checkInTransitions, displayedGames])

  useEffect(() => () => {
    transitionCleanupRef.current.forEach((cleanup) => cleanup())
    transitionCleanupRef.current.clear()
  }, [])

  return (
    <main className="shell">
      <h1 className="visually-hidden">Sunset Chess</h1>
      <div className="dashboard">
        <section className="scanner-card" aria-labelledby="scanner-heading">
        <div className="preview" ref={previewRef}>
          <video ref={videoRef} muted playsInline aria-label="Mirrored live camera preview" />
          <canvas ref={overlayRef} aria-hidden="true" />
          {parsed && (
            <div
              className={`payload-label ${parsed.kind}`}
              ref={payloadLabelRef}
              data-qr-animation-source
              aria-hidden="true"
            >
              {parsed.label}
            </div>
          )}
          {cameraState !== 'active' && <div className="preview-placeholder" aria-hidden="true"><span>♙</span></div>}
          {gameContext && (
            <div
              className="camera-game-context"
              role="group"
              aria-label={`Game context for Table ${gameContext.game.tableNumber}`}
            >
              <GameCard
                game={gameContext.game}
                className=" stage-game-card"
                width="clamp(150px, 30vw, 280px)"
                height="auto"
              />
              {gameContext.waitingCopy && (
                <p className="game-waiting-header">
                  {gameContext.waitingCopy}
                </p>
              )}
            </div>
          )}
          {cameraState === 'active' && actionZones.length > 0 && (
            <div
              className="action-zones"
              role="group"
              aria-label={gameContext
                ? gameContext.resultReady
                  ? `Report result for Table ${gameContext.game.tableNumber}`
                  : `Result options for Table ${gameContext.game.tableNumber}`
                : 'Player check-in action zones'}
            >
              {actionZones.map((zone) => (
                <ActionZoneView
                  zone={zone}
                  key={zone.id}
                  zoneRef={(element) => {
                    if (element) actionZoneRefs.current.set(zone.id, element)
                    else actionZoneRefs.current.delete(zone.id)
                  }}
                  progressRef={(element) => {
                    if (element) actionProgressRefs.current.set(zone.id, element)
                    else actionProgressRefs.current.delete(zone.id)
                  }}
                />
              ))}
            </div>
          )}
          {overlayMessage && (
            <p className="action-zone-message" role="status" aria-live="polite">
              {overlayMessage}
            </p>
          )}
          {cameraState === 'active' && actionZones.length === 0 && !gameContext && !overlayMessage && (
            <p className="stage-guidance">Scan your chess piece to log in</p>
          )}
          {!gameContext?.resultReady && <div className="scan-corners" aria-hidden="true" />}
        </div>
        <div className="controls">
          <div className="status" role="status" aria-live="polite">
            <span className={`status-dot ${cameraState}`} />
            <div><h2 id="scanner-heading">{copy.title}</h2><p>{copy.detail}</p></div>
          </div>
          {canStart && (
            <button type="button" onClick={startCamera}>
              {cameraState === 'initial'
                ? 'Start camera'
                : cameraState === 'active' || cameraState === 'inactive'
                  ? 'Restart camera'
                  : 'Try again'}
            </button>
          )}
        </div>
        <p className="visually-hidden" aria-live="polite">
          {parsed ? `Detected QR code: ${parsed.label}` : ''}
        </p>
        <p className="scanner-diagnostics" aria-label="Scanner diagnostics">
          <span ref={diagnosticsRef}>Measuring camera / decode / paint cadence…</span>
        </p>
        {checkInNotice && (
          <p
            className={`check-in-notice${checkInError ? ' error' : ''}`}
            role={checkInError ? 'alert' : 'status'}
            aria-live="polite"
          >
            {checkInNotice}
          </p>
        )}
        </section>

        <section
          className="ongoing-games game-column live-games"
          aria-labelledby="ongoing-games-heading"
          aria-busy={gamesLoading}
        >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live tables</p>
            <h2 id="ongoing-games-heading">Ongoing Games</h2>
          </div>
          {gamesError && (
            <button type="button" className="secondary" onClick={() => void refreshGames()}>
              Retry
            </button>
          )}
        </div>
        {gamesLoading && games.length === 0 && <p className="games-message" role="status">Loading ongoing games…</p>}
        {gamesError && (
          <p className="games-message error" role="alert">
            Could not refresh ongoing games. {games.length > 0 ? 'Showing the last update.' : ''}
          </p>
        )}
        {!gamesLoading && !gamesError && games.length === 0 && (
          <p className="games-message">No games are ongoing yet.</p>
        )}
        {games.length > 0 && (
          <div className="games-list" ref={gamesListRef} role="region" aria-label="Ongoing games">
            {displayedGames.map((game) => (
              <GameCard
                className={featuredGame && isSameGame(game, featuredGame) ? ' featured-game' : ''}
                key={gameIdentityKey(game)}
                game={game}
                cardRef={(element) => {
                  const key = gameIdentityKey(game)
                  if (element) gameCardRefs.current.set(key, element)
                  else gameCardRefs.current.delete(key)
                }}
              />
            ))}
          </div>
        )}
        </section>

        <section className="ongoing-games game-column recent-games" aria-labelledby="recent-games-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Completed tables</p>
            <h2 id="recent-games-heading">Recent Games</h2>
          </div>
        </div>
        {recentGames.length === 0 ? (
          <p className="games-message">No finished games yet.</p>
        ) : (
          <div className="games-list" role="region" aria-label="Recent finished games">
            {recentGames.map((game) => (
              <GameCard
                className={` finished-game${game.result === '1/2-1/2' ? ' drawn-game' : ''}`}
                key={gameIdentityKey(game)}
                game={game}
                ariaLabel={`Table ${game.tableNumber}: ${game.result}`}
              />
            ))}
          </div>
        )}
        </section>
      </div>

      <section className="producer" aria-labelledby="producer-heading">
        <div className="producer-form">
          <p className="eyebrow">Player QR</p>
          <h2 id="producer-heading">Make your player card</h2>
          <p>Create a local QR identity to share with another player.</p>
          <label htmlFor="player-name">Player name</label>
          <input
            id="player-name"
            value={name}
            maxLength={81}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void generatePlayerQr() }}
          />
          {producerError && <p className="form-error" role="alert">{producerError}</p>}
          <button type="button" onClick={() => void generatePlayerQr()}>Generate</button>
        </div>
        <div className="qr-card-wrap">
          {player && qrDataUrl ? (
            <>
              <article className="qr-card" aria-label="Generated player QR card">
                <img src={qrDataUrl} alt={`QR code for ${player.name}, player ${player.playerId}`} />
                <h3>{player.name}</h3>
                <p>Player #{player.playerId}</p>
              </article>
              <div className="producer-actions">
                <button type="button" className="secondary" onClick={() => {
                  document.body.dataset.printMode = 'card'
                  window.print()
                }}>Print card</button>
                <button type="button" className="secondary" onClick={() => {
                  document.body.dataset.printMode = 'sticker'
                  window.print()
                }}>Print sticker</button>
              </div>
            </>
          ) : <p className="empty-card">Your generated card will appear here.</p>}
        </div>
      </section>
    </main>
  )
}
