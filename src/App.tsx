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
  type QrDetection,
  type RememberedDetection,
} from './scanner'
import {
  cadenceRates,
  decideDecodeReanchor,
  HOLD_QUALIFICATION_GRACE_MS,
  emptyTrackingState,
  observeDetection,
  observeVisualDetection,
  rejectVisualDetection,
  sampleTracking,
  type CadenceState,
  type TrackingPhase,
  type TrackingState,
} from './qrTracking'
import {
  rgbaToVisualFrame,
  scaleDetection,
  VisualObjectTracker,
  type VisualFrame,
} from './visualObjectTracker'
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
  emptyLaneCheckInStates,
  emptyHoldState,
  emptyLaneBindingState,
  evaluateResultChoices,
  matchIndependentLaneContexts,
  matchGameContext,
  openReentryLatch,
  shareOngoingGame,
  updateCheckInZones,
  updateIndependentCheckInZones,
  updateHold,
  updateLaneBinding,
  updateReentryLatch,
  RESULT_HOLD_RETENTION_MS,
  type ActionZone,
  type CheckInState,
  type GameContext,
  type HoldState,
  type IndependentLaneContext,
  type LaneCheckInStates,
  type LaneBindingState,
  type PlayerDetection,
  type ReentryLatchState,
  type ResultAssignment,
} from './actionZones'
import { ActionZoneView } from './ActionZoneView'
import {
  GameCard,
  type AuthoritativePlayerScan,
  type OngoingGame,
} from './GameCard'
import { createJsQrWorker, createQrWorker, WorkerDecoder } from './workerDecoder'
import { createOpenCvWorker, OpticalFlowTracker } from './opticalFlowTracker'
import {
  TRACKING_CAPTURE_BUDGET_MS,
  TRACKING_CAPTURE_MAX_INTERVAL_MS,
  TRACKING_ACTION_ANCHOR_MAX_AGE_MS,
  TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS,
  TRACKING_COAST_MS,
} from './trackingPolicy'
import {
  selectQuality,
  supportsWasmSimd,
  type QualityProfile,
} from './adaptiveQuality'
import {
  formatDecoderInputStats,
  JSQR_DECODE_INTERVAL_MS,
  JSQR_IDLE_BEFORE_ATTEMPT_MS,
  mergeTimedDecoderDetections,
  NATIVE_DECODE_INTERVAL_MS,
  RESULT_MERGE_WINDOW_MS,
  workerDecodeDimensions,
  type DecoderInputStats,
  type DecoderName,
} from './decoderOrchestration'
import {
  registerAnchor,
  TrackingFrameHistory,
  type RegisteredAnchor,
  type TrackingFrame,
} from './trackingFrameHistory'
import type { OpticalReplayAnchor } from './opticalFlowProtocol'
import type { OpticalFlowDiagnostics } from './opticalFlowProtocol'
import {
  appendDiagnosticEvent,
  appendDiagnosticSample,
  diagnosticRemainingMs,
  diagnosticSessionId,
  DiagnosticUrls,
  startDiagnostic,
  supportsDiagnosticVideo,
  type DiagnosticSession,
} from './trackingDiagnostic'
import {
  trailForIdentity,
  updateTrail,
  type TrailPoint,
} from './trackingTrail'
import { encodeQrDataUrl } from './qrArtwork'
import { Leaderboard } from './Leaderboard'
import { SunsetChessLogo } from './SunsetChessLogo'
import { DashboardTabs } from './DashboardTabs'
import { ModalDialog } from './ModalDialog'
import { SettingsMenu } from './SettingsMenu'
import {
  loadUiPreferences,
  saveUiPreferences,
  type UiPreferences,
} from './uiPreferences'
import {
  emptyPresenceState,
  updatePresenceHysteresis,
  type PresenceHysteresisState,
} from './presenceHysteresis'
import {
  emptyResultAuthorityUpdate,
  RESULT_AUTHORITY_GRACE_MS,
  updateResultAuthority,
  type ResultAuthorityUpdate,
} from './resultAuthority'
import {
  findAuthoritativeResult,
  formatResultAcknowledgement,
  formatResultNotice,
  RESULT_ACKNOWLEDGEMENT_MS,
} from './resultAcknowledgement'
import './App.css'

type CameraState = 'initial' | 'requesting' | 'active' | 'inactive' | 'denied' | 'unavailable' | 'insecure' | 'error'
type ScheduledFrame =
  | { kind: 'video'; id: number; watchdogId: number }
  | { kind: 'animation'; id: number }
  | { kind: 'timer'; id: number }
  | null

export const CAMERA_INACTIVITY_MS = 5 * 60 * 1000
export const VIDEO_FRAME_CALLBACK_WATCHDOG_MS = 500
export const PLAYER_LOOKUP_RETRY_BASE_MS = 1_000
export const PLAYER_LOOKUP_RETRY_MAX_MS = 10_000
const PLAYER_LOOKUP_REENTRY_RESET_MS = 250

const stateCopy: Record<CameraState, { title: string; detail: string }> = {
  initial: { title: 'Ready when you are', detail: 'Point your camera at a QR code. Frames stay on this device.' },
  requesting: { title: 'Waiting for camera permission', detail: 'Use your browser prompt to allow camera access.' },
  active: { title: 'Scanning for a QR code', detail: 'Hold the code steady inside the camera view.' },
  inactive: {
    title: 'Camera off',
    detail: 'Start the camera when you are ready to scan again.',
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
): Promise<OngoingGame> {
  const response = await fetch(`/api/games/${gameId}/result`, {
    method: 'PATCH',
    signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ result }),
  })
  const body = await response.json() as { game?: OngoingGame; error?: string }
  if (!response.ok || !body.game) {
    throw new Error(body.error || `Result request failed (${response.status}).`)
  }
  return body.game
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

async function defaultDeletePlayer(playerId: number, signal: AbortSignal): Promise<void> {
  const response = await fetch(`/api/players/${playerId}`, {
    method: 'DELETE',
    signal,
    headers: { accept: 'application/json' },
  })
  const body = await response.json() as { error?: string }
  if (!response.ok) {
    throw new Error(body.error || `Player cleanup failed (${response.status}).`)
  }
}

async function defaultResolvePlayer(playerId: number, signal: AbortSignal): Promise<PlayerPayload> {
  const response = await fetch(`/api/players/${playerId}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  const body = await response.json() as { player?: { id: number; name: string }; error?: string }
  if (!response.ok || !body.player) {
    const error = new Error(body.error || `Player lookup failed (${response.status}).`) as Error & {
      retryable?: boolean
    }
    error.retryable = response.status === 429 || response.status >= 500
    throw error
  }
  return { v: 1, kind: 'player', playerId: body.player.id, name: body.player.name }
}

function retryablePlayerLookupError(error: unknown): boolean {
  if (typeof (error as { retryable?: unknown } | null)?.retryable === 'boolean') {
    return (error as { retryable: boolean }).retryable
  }
  return !(error instanceof Error && /not found|\(4\d\d\)/i.test(error.message))
}

function classifyCameraError(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'unavailable'
  return 'error'
}

interface AppProps {
  workerFactory?: () => Worker
  jsQrWorkerFactory?: () => Worker
  openCvWorkerFactory?: () => Worker
  nativeDetectorFactory?: () => NativeBarcodeDetector | null | Promise<NativeBarcodeDetector | null>
  qrEncoder?: (value: string) => Promise<string>
  createPlayer?: (name: string, signal: AbortSignal) => Promise<PlayerPayload>
  deletePlayer?: (playerId: number, signal: AbortSignal) => Promise<void>
  resolvePlayer?: (playerId: number, signal: AbortSignal) => Promise<PlayerPayload>
  fetchGames?: (signal: AbortSignal) => Promise<GameFeed | OngoingGame[]>
  checkInPlayer?: (player: PlayerPayload, signal: AbortSignal) => Promise<CheckInResult>
  finalizeGame?: (
    gameId: number,
    result: '1-0' | '0-1' | '1/2-1/2',
    signal: AbortSignal,
  ) => Promise<OngoingGame | null | void>
  gamesPollIntervalMs?: number
  resultAcknowledgementMs?: number
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

function isPlayerPiece(data: string): boolean {
  const parsed = parseQrPayload(data)
  return parsed.kind === 'player' || parsed.kind === 'player-reference'
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
  jsQrWorkerFactory = createJsQrWorker,
  openCvWorkerFactory = createOpenCvWorker,
  nativeDetectorFactory = createNativeBarcodeDetector,
  qrEncoder = encodeQrDataUrl,
  createPlayer = defaultCreatePlayer,
  deletePlayer = defaultDeletePlayer,
  resolvePlayer = defaultResolvePlayer,
  fetchGames = defaultFetchGames,
  checkInPlayer = defaultCheckInPlayer,
  finalizeGame = defaultFinalizeGame,
  gamesPollIntervalMs = 2000,
  resultAcknowledgementMs = RESULT_ACKNOWLEDGEMENT_MS,
}: AppProps) {
  const [cameraState, setCameraState] = useState<CameraState>(
    window.isSecureContext === false ? 'insecure' : 'initial',
  )
  const initialPreferences = useMemo(() => loadUiPreferences(), [])
  const [preferences, setPreferences] = useState<UiPreferences>(initialPreferences.preferences)
  const [settingsError, setSettingsError] = useState(initialPreferences.error)
  const [remembered, setRemembered] = useState<RememberedDetection | null>(null)
  const [name, setName] = useState('')
  const [producerError, setProducerError] = useState('')
  const [player, setPlayer] = useState<PlayerPayload | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [addPlayerOpen, setAddPlayerOpen] = useState(false)
  const [, setResolverRevision] = useState(0)
  const [games, setGames] = useState<OngoingGame[]>([])
  const [recentGames, setRecentGames] = useState<OngoingGame[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [gamesError, setGamesError] = useState('')
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0)
  const [checkInNotice, setCheckInNotice] = useState('')
  const [checkInError, setCheckInError] = useState(false)
  const [cameraNotice, setCameraNotice] = useState('')
  const [featuredGame, setFeaturedGame] = useState<GameIdentity | null>(null)
  const [checkInTransitions, setCheckInTransitions] = useState<CheckInTransition[]>([])
  const [actionZones, setActionZones] = useState<ActionZone[]>([])
  const [gameContext, setGameContext] = useState<GameContext | null>(null)
  const [overlayMessage, setOverlayMessage] = useState('')
  const [independentLaneContexts, setIndependentLaneContexts] = useState<IndependentLaneContext[]>([])
  const [resultAcknowledgement, setResultAcknowledgement] = useState('')
  const [resultCameraSuppressed, setResultCameraSuppressed] = useState(false)
  const [piecePresent, setPiecePresent] = useState(false)
  const [diagnosticUi, setDiagnosticUi] = useState<{
    phase: 'idle' | 'recording' | 'ready' | 'error'
    id: string
    remainingMs: number
    videoUrl: string | null
    jsonUrl: string | null
    message: string
  }>({ phase: 'idle', id: '', remainingMs: 0, videoUrl: null, jsonUrl: null, message: '' })
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
  const visualCaptureRef = useRef<HTMLCanvasElement | null>(null)
  const visualFrameRef = useRef<VisualFrame | null>(null)
  const visualTrackerRef = useRef(new VisualObjectTracker())
  const opticalTrackerRef = useRef<OpticalFlowTracker | null>(null)
  const opticalReadyRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const scheduleRef = useRef<ScheduledFrame>(null)
  const timerFallbackRef = useRef(false)
  const inactivityTimerRef = useRef<number | null>(null)
  const lastNativeScanRef = useRef(0)
  const lastZxingScanRef = useRef(0)
  const lastJsQrScanRef = useRef(0)
  const lastFullDetailScanRef = useRef({ 'zxing-wasm': 0, jsqr: 0 })
  const lastDecodedAtRef = useRef(0)
  const rememberedRef = useRef<RememberedDetection | null>(null)
  const trackingRefs = useRef(new Map<string, TrackingState>())
  const trackingPhaseRef = useRef('lost')
  const trackingDiagnosticsRef = useRef('0 active')
  const presenceStateRef = useRef('0 fresh / 0 present')
  const piecePresentRef = useRef(false)
  const presenceHysteresisRef = useRef<PresenceHysteresisState>(emptyPresenceState())
  const cameraDiagnosticsRef = useRef<CameraDiagnostics | null>(null)
  const diagnosticsRef = useRef<HTMLSpanElement>(null)
  const cadenceRef = useRef<CadenceState>({
    startedAt: performance.now(), cameraFrames: 0, decodes: 0, paints: 0,
  })
  const lastDiagnosticsRef = useRef(0)
  const scanSizeRef = useRef<{ width: number; height: number } | null>(null)
  const cameraGenerationRef = useRef(0)
  const zxingDecoderRef = useRef<WorkerDecoder | null>(null)
  const jsQrDecoderRef = useRef<WorkerDecoder | null>(null)
  const decoderReadyRef = useRef({ zxing: false, jsqr: false })
  const decoderFailureRef = useRef(new Map<DecoderName, string>())
  const decoderInputStatsRef = useRef<Partial<Record<DecoderName, DecoderInputStats>>>({})
  const recentDecoderResultsRef = useRef(new Map<
    DecoderName,
    {
      completedAt: number
      capturedAt: number
      detections: QrDetection[]
      registration: Omit<RegisteredAnchor, 'detection' | 'capturedAt'> | null
    }
  >())
  const trackerModeRef = useRef<'opencv-lk' | 'lightweight'>('lightweight')
  const trackerFailureRef = useRef('')
  const decodeLatencyRef = useRef(0)
  const trackLatencyRef = useRef(0)
  const lastTrackRef = useRef(0)
  const trackingCaptureCostRef = useRef(0)
  const trackingCaptureCountRef = useRef(0)
  const opticalRequestsRef = useRef(0)
  const opticalCompletionsRef = useRef(0)
  const opticalAcceptedRef = useRef(0)
  const opticalRejectedRef = useRef(0)
  const opticalRejectionsRef = useRef<string[]>([])
  const pendingOpticalAnchorsRef = useRef(new Map<string, RegisteredAnchor>())
  const trackingHistoryRef = useRef(new TrackingFrameHistory())
  const registrationDiagnosticsRef = useRef({
    lagMs: 0,
    replayFrames: 0,
    replayLatencyMs: 0,
    evidenceAgeMs: 0,
    lastRejection: '',
    decodeRefreshes: 0,
    suppressedReanchors: 0,
    forcedReanchors: 0,
    lastReanchorReason: '',
  })
  const latestOpticalDiagnosticsRef = useRef<OpticalFlowDiagnostics['tracks']>([])
  const trailRef = useRef<TrailPoint[]>([])
  const lastTrailAtRef = useRef(0)
  const diagnosticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const diagnosticSessionRef = useRef<DiagnosticSession | null>(null)
  const diagnosticRecorderRef = useRef<MediaRecorder | null>(null)
  const diagnosticStreamRef = useRef<MediaStream | null>(null)
  const addPlayerInputRef = useRef<HTMLInputElement>(null)
  const addPlayerReturnFocusRef = useRef<HTMLElement | null>(null)
  const diagnosticChunksRef = useRef<Blob[]>([])
  const diagnosticUrlsRef = useRef(new DiagnosticUrls())
  const finalizeDiagnosticRef = useRef<(() => void) | null>(null)
  const diagnosticMountedRef = useRef(true)
  const qualityRef = useRef<QualityProfile>(selectQuality({
    wasm: typeof WebAssembly !== 'undefined',
    simd: supportsWasmSimd(),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    visible: document.visibilityState !== 'hidden',
  }))
  const nativeDetectorRef = useRef<NativeBarcodeDetector | null>(null)
  const nativePendingGenerationRef = useRef<number | null>(null)
  const qrRequestRef = useRef(0)
  const playerCreationRef = useRef<AbortController | null>(null)
  const playerCacheRef = useRef(new Map<number, PlayerPayload>())
  const playerLookupRef = useRef(new Map<number, AbortController>())
  const playerLookupErrorRef = useRef(new Map<number, {
    attempts: number
    message: string
    retryAt: number
  }>())
  const rememberedReferencePresenceRef = useRef<{
    playerId: number | null
    leftAt: number | null
  }>({ playerId: null, leftAt: null })
  const gamesRequestRef = useRef<AbortController | null>(null)
  const gamesRef = useRef<OngoingGame[]>([])
  const checkInRequestRef = useRef(new Map<number, AbortController>())
  const submittedCheckInRef = useRef(new Set<number>())
  const resultRequestRef = useRef<AbortController | null>(null)
  const resultAcknowledgementTimerRef = useRef<number | null>(null)
  const resultAcknowledgementSequenceRef = useRef(0)
  const resultSuppressedPlayerIdsRef = useRef(new Set<number>())
  const gameContextRef = useRef<GameContext | null>(null)
  const resultHoldRef = useRef<HoldState>(emptyHoldState())
  const resultAssignmentRef = useRef<ResultAssignment | null>(null)
  const resultAuthorityRef = useRef<ResultAuthorityUpdate>(emptyResultAuthorityUpdate())
  const submittedResultRef = useRef<string | null>(null)
  const checkInStateRef = useRef<CheckInState>(emptyCheckInState())
  const laneCheckInStatesRef = useRef<LaneCheckInStates>(emptyLaneCheckInStates())
  const actionZonesRef = useRef<ActionZone[]>([])
  const laneBindingRef = useRef<LaneBindingState>(emptyLaneBindingState())
  const reentryLatchRef = useRef<ReentryLatchState>(openReentryLatch())
  const overlayMessageRef = useRef('')
  const displayedGames = useMemo(
    () => featuredFirst(games, featuredGame),
    [featuredGame, games],
  )
  const unavailablePlayerIds = useMemo(
    () => games.flatMap((game) => [game.blackPlayerId, game.whitePlayerId])
      .filter((playerId): playerId is number => playerId !== null),
    [games],
  )

  const updatePreferences = useCallback((patch: Partial<UiPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch }
      try {
        saveUiPreferences(next)
        setSettingsError('')
      } catch {
        setSettingsError('Settings could not be saved in this browser.')
      }
      return next
    })
  }, [])

  useEffect(() => {
    gamesRef.current = games
  }, [games])

  const clearResultMode = useCallback(() => {
    gameContextRef.current = null
    resultHoldRef.current = emptyHoldState()
    resultAssignmentRef.current = null
    resultAuthorityRef.current = emptyResultAuthorityUpdate()
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
    laneCheckInStatesRef.current = emptyLaneCheckInStates()
    actionZonesRef.current = []
    setActionZones([])
    actionProgressRefs.current.forEach((progress) => {
      progress.style.transform = 'scaleX(0)'
      progress.setAttribute('aria-valuenow', '0')
    })
  }, [])

  const clearResultAcknowledgement = useCallback(() => {
    resultAcknowledgementSequenceRef.current += 1
    if (resultAcknowledgementTimerRef.current !== null) {
      window.clearTimeout(resultAcknowledgementTimerRef.current)
      resultAcknowledgementTimerRef.current = null
    }
    setResultAcknowledgement('')
    resultSuppressedPlayerIdsRef.current.clear()
    setResultCameraSuppressed(false)
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
        setLeaderboardRefresh((value) => value + 1)
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

  const handleGameMutate = useCallback(async () => {
    clearResultMode()
    resetCheckInTargets()
    setFeaturedGame(null)
    await refreshGames(true)
  }, [clearResultMode, refreshGames, resetCheckInTargets])

  const submitResult = useCallback((
    gameId: number,
    result: '1-0' | '0-1' | '1/2-1/2',
    dedupeKey: string,
    generation: number,
  ) => {
    if (resultRequestRef.current || submittedResultRef.current === dedupeKey) return
    clearResultAcknowledgement()
    submittedResultRef.current = dedupeKey
    const controller = new AbortController()
    resultRequestRef.current = controller
    setCheckInError(false)
    setCheckInNotice(`Recording ${result}…`)
    void finalizeGame(gameId, result, controller.signal).then(async (returnedGame) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      let authoritative = returnedGame ?? null
      if (!authoritative) {
        const response = await fetchGames(controller.signal)
        if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
        const next = Array.isArray(response) ? response : response.games
        const recent = Array.isArray(response) ? [] : response.recentGames
        authoritative = findAuthoritativeResult(gameId, authoritative, recent)
        setGames(next)
        setRecentGames(recent)
        setFeaturedGame((current) => retainFeaturedGame(next, current))
        setLeaderboardRefresh((value) => value + 1)
      }
      if (!authoritative) {
        throw new Error('Result was recorded, but updated ratings could not be loaded.')
      }
      const acknowledgement = formatResultAcknowledgement(authoritative)
      resultSuppressedPlayerIdsRef.current = new Set([
        authoritative.blackPlayerId,
        authoritative.whitePlayerId,
      ].filter((playerId): playerId is number => playerId !== null))
      const sequence = ++resultAcknowledgementSequenceRef.current
      if (resultAcknowledgementTimerRef.current !== null) {
        window.clearTimeout(resultAcknowledgementTimerRef.current)
      }
      setResultAcknowledgement(acknowledgement)
      resultAcknowledgementTimerRef.current = window.setTimeout(() => {
        if (resultAcknowledgementSequenceRef.current !== sequence) return
        resultAcknowledgementTimerRef.current = null
        setResultAcknowledgement('')
        const suppressCompletedPlayers = resultSuppressedPlayerIdsRef.current.size > 0
        setResultCameraSuppressed(suppressCompletedPlayers)
        if (suppressCompletedPlayers) {
          piecePresentRef.current = false
          setPiecePresent(false)
        }
      }, resultAcknowledgementMs)
      setCheckInNotice(formatResultNotice(authoritative))
      reentryLatchRef.current = blockReentryLatch()
      trackingRefs.current.clear()
      visualTrackerRef.current.clear()
      visualFrameRef.current = null
      rememberedRef.current = null
      setRemembered(null)
      clearResultMode()
      if (returnedGame) void refreshGames(true)
    }).catch((error) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      setCheckInError(true)
      setCheckInNotice(error instanceof Error ? error.message : 'Could not record the result.')
      submittedResultRef.current = null
      resultHoldRef.current = emptyHoldState()
      resultAssignmentRef.current = null
      resultAuthorityRef.current = emptyResultAuthorityUpdate()
    }).finally(() => {
      if (resultRequestRef.current === controller) resultRequestRef.current = null
    })
  }, [clearResultAcknowledgement, clearResultMode, fetchGames, finalizeGame, refreshGames, resultAcknowledgementMs])

  const requestPlayerResolution = useCallback((playerId: number, generation: number) => {
    const previousFailure = playerLookupErrorRef.current.get(playerId)
    if (
      playerCacheRef.current.has(playerId)
      || playerLookupRef.current.has(playerId)
      || (previousFailure && Date.now() < previousFailure.retryAt)
    ) return
    const controller = new AbortController()
    const attempt = (previousFailure?.attempts ?? 0) + 1
    playerLookupRef.current.set(playerId, controller)
    void resolvePlayer(playerId, controller.signal).then((resolved) => {
      if (
        controller.signal.aborted
        || generation !== cameraGenerationRef.current
        || resolved.playerId !== playerId
      ) return
      playerCacheRef.current.set(playerId, resolved)
      playerLookupErrorRef.current.delete(playerId)
      if (playerLookupErrorRef.current.size === 0) setCheckInError(false)
      setCheckInNotice((current) =>
        current.startsWith(`Player #${playerId} could not be resolved.`) ? '' : current)
      setResolverRevision((value) => value + 1)
    }).catch((error) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      const message = error instanceof Error ? error.message : `Player #${playerId} could not be resolved.`
      const retryable = retryablePlayerLookupError(error)
      const cooldown = retryable
        ? Math.min(PLAYER_LOOKUP_RETRY_BASE_MS * (2 ** (attempt - 1)), PLAYER_LOOKUP_RETRY_MAX_MS)
        : Number.POSITIVE_INFINITY
      playerLookupErrorRef.current.set(playerId, {
        attempts: attempt,
        message,
        retryAt: Date.now() + cooldown,
      })
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
      || checkInRequestRef.current.has(playerId)
    ) return
    clearResultAcknowledgement()
    submittedCheckInRef.current.add(playerId)
    const controller = new AbortController()
    checkInRequestRef.current.set(playerId, controller)
    setCheckInError(false)
    setCheckInNotice(`Checking in ${detectedPlayer.name}…`)
    void checkInPlayer(detectedPlayer, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== cameraGenerationRef.current) return
      if (result.status === 'paired') {
        setCheckInNotice(`${detectedPlayer.name} checks into Table ${result.game.tableNumber}`)
      } else if (result.status === 'waiting') {
        setCheckInNotice(
          `${detectedPlayer.name} checks into Table ${result.game.tableNumber}. Waiting for an opponent.`,
        )
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
  }, [checkInPlayer, clearResultAcknowledgement, refreshGames])

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
    finalizeDiagnosticRef.current?.()
    cancelCheckInTransition()
    cameraGenerationRef.current += 1
    clearInactivityTimer()
    checkInRequestRef.current.forEach((controller) => controller.abort())
    checkInRequestRef.current.clear()
    submittedCheckInRef.current.clear()
    laneBindingRef.current = emptyLaneBindingState()
    reentryLatchRef.current = openReentryLatch()
    clearResultAcknowledgement()
    setIndependentLaneContexts([])
    updateOverlayMessage('')
    resetCheckInTargets()
    resultRequestRef.current?.abort()
    resultRequestRef.current = null
    playerLookupRef.current.forEach((controller) => controller.abort())
    playerLookupRef.current.clear()
    playerLookupErrorRef.current.clear()
    clearResultMode()
    cancelScheduledFrame()
    zxingDecoderRef.current?.terminate()
    zxingDecoderRef.current = null
    jsQrDecoderRef.current?.terminate()
    jsQrDecoderRef.current = null
    opticalTrackerRef.current?.terminate()
    opticalTrackerRef.current = null
    opticalReadyRef.current = false
    pendingOpticalAnchorsRef.current.clear()
    trackingHistoryRef.current.clear()
    trailRef.current = []
    decoderReadyRef.current = { zxing: false, jsqr: false }
    decoderFailureRef.current.clear()
    decoderInputStatsRef.current = {}
    recentDecoderResultsRef.current.clear()
    nativeDetectorRef.current = null
    nativePendingGenerationRef.current = null
    timerFallbackRef.current = false
    cameraDiagnosticsRef.current = null
    piecePresentRef.current = false
    presenceHysteresisRef.current = emptyPresenceState()
    setPiecePresent(false)
    const stream = streamRef.current
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    stream?.getTracks().forEach((track) => track.stop())
    if (clearDetection) {
      rememberedRef.current = null
      trackingRefs.current.clear()
      visualTrackerRef.current.clear()
      visualFrameRef.current = null
      scanSizeRef.current = null
      setRemembered(null)
    }
  }, [cancelCheckInTransition, cancelScheduledFrame, clearInactivityTimer, clearResultAcknowledgement, clearResultMode, resetCheckInTargets, updateOverlayMessage])

  const finalizeDiagnostic = useCallback(() => {
    const session = diagnosticSessionRef.current
    if (!session) return
    diagnosticSessionRef.current = null
    const recorder = diagnosticRecorderRef.current
    diagnosticRecorderRef.current = null
    const finish = () => {
      diagnosticStreamRef.current?.getTracks().forEach((track) => track.stop())
      diagnosticStreamRef.current = null
      if (!diagnosticMountedRef.current) {
        diagnosticChunksRef.current = []
        return
      }
      const videoBlob = diagnosticChunksRef.current.length
        ? new Blob(diagnosticChunksRef.current, { type: recorder?.mimeType || 'video/webm' })
        : null
      diagnosticChunksRef.current = []
      const track = streamRef.current?.getVideoTracks()[0]
      const metadata = {
        schemaVersion: 1,
        sessionId: session.id,
        startedAt: session.startedAt,
        endedAt: performance.now(),
        durationMs: performance.now() - session.startedAt,
        appVersion: '1.0.0',
        commit: null,
        commitNote: 'Git metadata is not bundled into the production image.',
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio || 1,
        camera: {
          settings: track?.getSettings?.() ?? null,
          capabilities: track?.getCapabilities?.() ?? null,
          diagnostics: cameraDiagnosticsRef.current,
        },
        preview: {
          width: previewRef.current?.clientWidth ?? 0,
          height: previewRef.current?.clientHeight ?? 0,
          videoWidth: videoRef.current?.videoWidth ?? 0,
          videoHeight: videoRef.current?.videoHeight ?? 0,
          mirroredExactlyOnce: true,
        },
        quality: qualityRef.current,
        policy: {
          opticalFlow: {
            maxForwardBackwardPx: 1.5,
            maxReprojectionErrorPx: 2.5,
            minInlierRatio: .65,
            modelOrder: ['homography', 'affine', 'similarity'],
          },
          actionZoneAuthority: {
            policy: 'evidence-qualified detections only',
            holdQualificationGraceMs: HOLD_QUALIFICATION_GRACE_MS,
            resultAuthorityGraceMs: RESULT_AUTHORITY_GRACE_MS,
            resultActionAnchorMaxAgeMs: TRACKING_ACTION_ANCHOR_MAX_AGE_MS,
            resultGeometryMaxAgeMs: TRACKING_COAST_MS,
          },
        },
        samples: session.samples,
        events: session.events,
        video: {
          available: Boolean(videoBlob),
          mimeType: recorder?.mimeType ?? null,
          limitation: videoBlob ? null : 'MediaRecorder or canvas.captureStream is unavailable.',
        },
        privacy: 'Created locally after explicit click; no upload or database mutation.',
      }
      const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' })
      const urls = diagnosticUrlsRef.current.replace(videoBlob, jsonBlob)
      setDiagnosticUi({
        phase: 'ready',
        id: session.id,
        remainingMs: 0,
        videoUrl: urls.video,
        jsonUrl: urls.telemetry,
        message: videoBlob
          ? 'Diagnostic bundle ready for local download.'
          : 'JSON ready. This browser cannot record the diagnostic WebM.',
      })
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.addEventListener('stop', finish, { once: true })
      recorder.stop()
    } else {
      finish()
    }
  }, [])
  finalizeDiagnosticRef.current = finalizeDiagnostic

  const startTrackingDiagnostic = useCallback(() => {
    if (cameraState !== 'active' || diagnosticSessionRef.current) return
    diagnosticUrlsRef.current.revoke()
    const id = diagnosticSessionId()
    const now = performance.now()
    diagnosticSessionRef.current = appendDiagnosticEvent(startDiagnostic(now, id), {
      type: 'recording-started',
      at: now,
      explicitUserAction: true,
    })
    const canvas = document.createElement('canvas')
    diagnosticCanvasRef.current = canvas
    diagnosticChunksRef.current = []
    let videoSupported = false
    if (supportsDiagnosticVideo(canvas)) {
      try {
        const stream = canvas.captureStream(30)
        diagnosticStreamRef.current = stream
        const mimeType = MediaRecorder.isTypeSupported?.('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm'
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 3_000_000,
        })
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0 && diagnosticChunksRef.current.length < 40) {
            diagnosticChunksRef.current.push(event.data)
          }
        })
        recorder.start(1000)
        diagnosticRecorderRef.current = recorder
        videoSupported = true
      } catch {
        diagnosticRecorderRef.current = null
      }
    }
    setDiagnosticUi({
      phase: 'recording',
      id,
      remainingMs: 10_000,
      videoUrl: null,
      jsonUrl: null,
      message: videoSupported
        ? 'Recording camera imagery locally. Nothing is uploaded.'
        : 'Recording telemetry; WebM is unsupported in this browser.',
    })
  }, [cameraState])

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
    const visible: Array<{
      detection: QrDetection
      phase: TrackingPhase
      source: 'decoded' | 'visual'
      confidence: number
      ageMs: number
      evidenceAgeMs: number
      actionable: boolean
      holdQualified: boolean
      holdQualificationSource: ReturnType<typeof sampleTracking>['holdQualificationSource']
      holdQualificationGraceRemainingMs: number
      stabilization: ReturnType<typeof sampleTracking>['stabilization']
    }> = []
    const anchorOnlyDiagnostics: string[] = []
    for (const [key, state] of trackingRefs.current) {
      const sample = sampleTracking(state, now)
      if (sample.expired) {
        trackingRefs.current.delete(key)
        continue
      }
      trackingRefs.current.set(key, sample.state)
      const decodedAnchor = sample.decodedAnchor && mapDetectionToPreview(
        sample.decodedAnchor,
        { width: video.videoWidth, height: video.videoHeight },
        { width, height },
        scanSize,
      )
      const mapped = sample.detection && mapDetectionToPreview(
        sample.detection,
        { width: video.videoWidth, height: video.videoHeight },
        { width, height },
        scanSize,
      )
      const drawPolygon = (
        detection: QrDetection,
        strokeStyle: string,
        lineWidth: number,
        dash: number[] = [],
      ) => {
        const corners = Object.values(detection.location)
        context.beginPath()
        context.moveTo(corners[0].x, corners[0].y)
        corners.slice(1).forEach((point) => context.lineTo(point.x, point.y))
        context.closePath()
        context.lineWidth = lineWidth
        context.setLineDash?.(dash)
        context.strokeStyle = strokeStyle
        context.shadowColor = 'rgba(17, 8, 28, .65)'
        context.shadowBlur = 5
        context.stroke()
        context.setLineDash?.([])
      }
      if (decodedAnchor) {
        const anchorCenter = Object.values(decodedAnchor.location)
          .reduce((total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }), { x: 0, y: 0 })
        const trackedCenter = mapped && Object.values(mapped.location)
          .reduce((total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }), { x: 0, y: 0 })
        const displaced = !trackedCenter
          || Math.hypot(anchorCenter.x - trackedCenter.x, anchorCenter.y - trackedCenter.y) >= 4
        if (displaced && (preferences.showDebugTools || diagnosticSessionRef.current)) {
          drawPolygon(decodedAnchor, 'rgba(255, 181, 71, .72)', 2, [7, 5])
        }
      }
      if (!mapped) {
        anchorOnlyDiagnostics.push(`decoded anchor ${Math.round(sample.ageMs)}ms (object absent)`)
        continue
      }
      visible.push({
        detection: mapped,
        phase: sample.phase,
        source: sample.source,
        confidence: sample.confidence,
        ageMs: sample.ageMs,
        evidenceAgeMs: sample.evidenceAgeMs,
        actionable: sample.actionable,
        holdQualified: sample.holdQualified,
        holdQualificationSource: sample.holdQualificationSource,
        holdQualificationGraceRemainingMs: sample.holdQualificationGraceRemainingMs,
        stabilization: sample.stabilization,
      })
      if (sample.source === 'visual') {
        registrationDiagnosticsRef.current.evidenceAgeMs = sample.evidenceAgeMs
      }
      const model = (latestOpticalDiagnosticsRef.current ?? []).find(
        (item) => item.identity === mapped.data,
      )?.model ?? (sample.source === 'visual' ? 'similarity' : 'none')
      if (sample.source === 'visual' && sample.phase !== 'lost'
        && now - lastTrailAtRef.current >= 40) {
        trailRef.current = updateTrail(trailRef.current, {
          identity: mapped.data,
          detection: mapped,
          at: now,
          confidence: sample.confidence,
          model,
        }, now)
        lastTrailAtRef.current = now
      }
      const trail = trailForIdentity(trailRef.current, mapped.data, now)
      if (trail.length > 1 && (preferences.showDebugTools || diagnosticSessionRef.current)) {
        context.beginPath()
        trail.forEach((item, index) => {
          const trailCenter = Object.values(item.detection.location).reduce(
            (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
            { x: 0, y: 0 },
          )
          if (index === 0) context.moveTo(trailCenter.x, trailCenter.y)
          else context.lineTo(trailCenter.x, trailCenter.y)
        })
        context.shadowBlur = 0
        context.lineWidth = 2
        context.strokeStyle = model === 'homography'
          ? 'rgba(117,214,165,.7)'
          : model === 'affine' ? 'rgba(100,230,223,.65)' : 'rgba(255,199,125,.55)'
        context.stroke()
      }
      if (preferences.showDebugTools || diagnosticSessionRef.current) {
        drawPolygon(
          mapped,
          sample.phase === 'tracking' ? '#64e6df' : 'rgba(100,230,223,.48)',
          4,
        )
      }
    }
    trailRef.current = updateTrail(trailRef.current, null, now)
    trackingPhaseRef.current = visible.length === 0
      ? 'lost'
      : visible.every(({ phase }) => phase === 'tracking') ? 'tracking' : 'coasting'
    trackingDiagnosticsRef.current = visible.length === 0
      ? anchorOnlyDiagnostics.length > 0 ? anchorOnlyDiagnostics.join(', ') : '0 active'
      : `${visible.length} active · ${visible.map(({
        source, confidence, ageMs, evidenceAgeMs, holdQualificationSource,
        holdQualificationGraceRemainingMs, stabilization,
      }) => `${source} ${Math.round(confidence * 100)}% anchor ${Math.round(ageMs)}ms`
        + `/evidence ${Math.round(evidenceAgeMs)}ms ${stabilization.motion}`
        + ` hold ${holdQualificationSource}`
        + (holdQualificationGraceRemainingMs > 0
          ? ` ${Math.round(holdQualificationGraceRemainingMs)}ms`
          : '')
        + ` Δ${stabilization.rawFilteredDeltaPx.toFixed(2)}px`).join(', ')}`
        + `${anchorOnlyDiagnostics.length ? ` · ${anchorOnlyDiagnostics.join(', ')}` : ''}`

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
    const freshPlayerDetections = visible.flatMap(({ detection, actionable }): PlayerDetection[] => {
      if (!actionable) return []
      return resolvedPlayerDetection(detection)
    })
    const holdQualifiedPlayerIds = new Set(visible.flatMap(({ detection, holdQualified }) => {
      if (!holdQualified) return []
      return resolvedPlayerDetection(detection).map(({ playerId }) => playerId)
    }))
    const presentPlayerIds = new Set(presentPlayerDetections.map(({ playerId }) => playerId))
    const freshPlayerIds = new Set(freshPlayerDetections.map(({ playerId }) => playerId))
    const newIdentityAfterResult = [...freshPlayerIds].some(
      (playerId) => !resultSuppressedPlayerIdsRef.current.has(playerId),
    )
    if (resultSuppressedPlayerIdsRef.current.size > 0 && newIdentityAfterResult) {
      resultSuppressedPlayerIdsRef.current.clear()
      reentryLatchRef.current = openReentryLatch()
      setResultCameraSuppressed(false)
    }
    const resultGeometryFreshPlayerIds = new Set(visible.flatMap(({
      detection, evidenceAgeMs,
    }) => {
      if (evidenceAgeMs > TRACKING_COAST_MS) return []
      return resolvedPlayerDetection(detection).map(({ playerId }) => playerId)
    }))
    const resultActionAnchorFreshPlayerIds = new Set(visible.flatMap(({
      detection, ageMs,
    }) => {
      if (ageMs > TRACKING_ACTION_ANCHOR_MAX_AGE_MS) return []
      return resolvedPlayerDetection(detection).map(({ playerId }) => playerId)
    }))
    const detectedPiece = visible.some(({ detection }) => isPlayerPiece(detection.data))
    const presence = updatePresenceHysteresis(
      presenceHysteresisRef.current,
      detectedPiece,
      now,
    )
    presenceHysteresisRef.current = presence.state
    if (piecePresentRef.current !== presence.state.visible) {
      piecePresentRef.current = presence.state.visible
      setPiecePresent(presence.state.visible)
    }
    if (presence.removed) {
      checkInStateRef.current = emptyCheckInState()
      resultHoldRef.current = emptyHoldState()
      resultAssignmentRef.current = null
      resultAuthorityRef.current = emptyResultAuthorityUpdate()
      actionZonesRef.current = []
      setActionZones([])
    }
    presenceStateRef.current =
      `${freshPlayerIds.size} fresh / ${presentPlayerIds.size} present`
    const previousReentryLatch = reentryLatchRef.current
    reentryLatchRef.current = updateReentryLatch(
      previousReentryLatch,
      freshPlayerDetections.length,
      now,
    )
    if (previousReentryLatch.blocked && !reentryLatchRef.current.blocked) {
      resultSuppressedPlayerIdsRef.current.clear()
      setResultCameraSuppressed(false)
    }
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
    if (laneBinding.changed) {
      resultHoldRef.current = emptyHoldState()
      resultAssignmentRef.current = null
      resultAuthorityRef.current = emptyResultAuthorityUpdate()
    }
    const interactionPlayers = reentryLatchRef.current.blocked || tooManyPlayers
      ? []
      : relevantPresentPlayers
    const laneContexts = matchIndependentLaneContexts(
      interactionPlayers,
      gamesRef.current,
      width,
      laneBinding.state.lanes,
    )
    const independentMode = laneContexts.length === 2 && !shareOngoingGame(laneContexts)
    const matchedGame = independentMode ? null : matchGameContext(
      interactionPlayers,
      gamesRef.current,
      width,
      laneBinding.state.lanes,
    )
    const nextIndependentContexts = independentMode ? laneContexts : []
    setIndependentLaneContexts((current) => {
      const currentKey = current.map(({ lane, player, game }) =>
        `${lane}:${player.playerId}:${game?.id ?? 'check-in'}`).join('|')
      const nextKey = nextIndependentContexts.map(({ lane, player, game }) =>
        `${lane}:${player.playerId}:${game?.id ?? 'check-in'}`).join('|')
      return currentKey === nextKey ? current : nextIndependentContexts
    })
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
    const checkInPlayers = relevantPresentPlayers
    const checkInOptions = {
      enabled: !matchedGame && !tooManyPlayers,
      blockedPlayerIds,
      resetKey: String(cameraGenerationRef.current),
      freshPlayerIds: holdQualifiedPlayerIds,
    }
    const independentCheckIn = independentMode
      ? updateIndependentCheckInZones(
          laneCheckInStatesRef.current,
          laneContexts,
          width,
          height,
          now,
          checkInOptions,
        )
      : null
    if (independentCheckIn) laneCheckInStatesRef.current = independentCheckIn.states
    const regularCheckIn = independentMode ? null : updateCheckInZones(
      checkInStateRef.current,
      checkInPlayers,
      width,
      height,
      now,
      checkInOptions,
    )
    if (regularCheckIn) checkInStateRef.current = regularCheckIn.state
    const checkInUpdate = independentCheckIn
      ? {
          zones: independentCheckIn.zones,
          completed: independentCheckIn.completed,
        }
      : regularCheckIn!
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
      resultAssignmentRef.current = null
      resultAuthorityRef.current = emptyResultAuthorityUpdate()
      updateOverlayMessage('Too many player codes — show no more than two')
      if (gameContextRef.current && !resultRequestRef.current) clearResultMode()
    } else if (!matchedGame) {
      resultHoldRef.current = emptyHoldState()
      resultAssignmentRef.current = null
      resultAuthorityRef.current = emptyResultAuthorityUpdate()
      updateOverlayMessage('')
      if (gameContextRef.current && !resultRequestRef.current) clearResultMode()
    } else {
      if (gameContextRef.current?.key !== matchedGame.key) {
        resultHoldRef.current = emptyHoldState()
        resultAssignmentRef.current = null
        resultAuthorityRef.current = emptyResultAuthorityUpdate()
        setGameContext(matchedGame)
      }
      gameContextRef.current = matchedGame
      const evaluation = evaluateResultChoices(
        matchedGame,
        width,
        height,
        resultAssignmentRef.current,
      )
      const assignment = evaluation.assignment
      const resultPlayerIds = matchedGame.opponent === null
        ? [matchedGame.anchor.playerId]
        : [matchedGame.anchor.playerId, matchedGame.opponent.playerId]
      const laneKey = resultPlayerIds
        .map((playerId) => `${playerId}:${laneBinding.state.lanes[playerId] ?? 'none'}`)
        .sort()
        .join('|')
      const authority = updateResultAuthority(resultAuthorityRef.current.state, {
        now,
        gameKey: matchedGame.key,
        laneKey,
        assignmentKey: assignment?.key ?? null,
        holdKey: resultHoldRef.current.key,
        playerIds: resultPlayerIds,
        directPlayerIds: freshPlayerIds,
        freshGeometryPlayerIds: resultGeometryFreshPlayerIds,
        freshActionAnchorPlayerIds: resultActionAnchorFreshPlayerIds,
        conflict: evaluation.status === 'conflict',
      })
      resultAuthorityRef.current = authority
      const hold = updateHold(
        resultHoldRef.current,
        assignment?.key ?? null,
        now,
        undefined,
        {
          qualified: authority.qualified,
          retentionMs: RESULT_HOLD_RETENTION_MS,
          reset: evaluation.status === 'conflict',
        },
      )
      resultHoldRef.current = hold.state
      if (assignment) resultAssignmentRef.current = assignment
      else if (hold.state.key === null) resultAssignmentRef.current = null
      updateOverlayMessage(evaluation.status === 'conflict'
          ? 'Result conflict — choose Win + Lose or Draw + Draw'
          : '')
      nextZones = matchedGame.resultReady
        ? createResultZones(
            matchedGame,
            width,
            height,
            hold,
            evaluation,
            !authority.qualified,
          )
        : createDisabledResultZones(
            matchedGame,
            width,
            height,
          )
      if (hold.state.completed
        && authority.source === 'direct'
        && assignment
        && matchedGame.opponent) {
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
    const diagnostic = diagnosticSessionRef.current
    if (diagnostic) {
      const diagnosticCanvas = diagnosticCanvasRef.current
      const diagnosticContext = diagnosticCanvas?.getContext('2d')
      if (diagnosticCanvas && diagnosticContext) {
        if (diagnosticCanvas.width !== Math.round(width * ratio)
          || diagnosticCanvas.height !== Math.round(height * ratio)) {
          diagnosticCanvas.width = Math.round(width * ratio)
          diagnosticCanvas.height = Math.round(height * ratio)
        }
        diagnosticContext.setTransform(ratio, 0, 0, ratio, 0, 0)
        diagnosticContext.fillStyle = '#0d0911'
        diagnosticContext.fillRect(0, 0, width, height)
        const coverScale = Math.max(width / video.videoWidth, height / video.videoHeight)
        const drawnWidth = video.videoWidth * coverScale
        const drawnHeight = video.videoHeight * coverScale
        const offsetX = (width - drawnWidth) / 2
        const offsetY = (height - drawnHeight) / 2
        diagnosticContext.save()
        diagnosticContext.translate(width, 0)
        diagnosticContext.scale(-1, 1)
        diagnosticContext.drawImage(video, offsetX, offsetY, drawnWidth, drawnHeight)
        diagnosticContext.restore()
        diagnosticContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height)
        for (const zone of nextZones) {
          diagnosticContext.strokeStyle = zone.status === 'holding' ? '#75d6a5' : '#ffe29a'
          diagnosticContext.lineWidth = 2
          diagnosticContext.strokeRect(zone.rect.x, zone.rect.y, zone.rect.width, zone.rect.height)
          diagnosticContext.fillStyle = 'rgba(13,9,17,.76)'
          diagnosticContext.fillRect(zone.rect.x, zone.rect.y, zone.rect.width, 22)
          diagnosticContext.fillStyle = '#fff4d7'
          diagnosticContext.font = '12px sans-serif'
          diagnosticContext.fillText(
            `${zone.label} ${Math.round(zone.progress * 100)}%`,
            zone.rect.x + 5,
            zone.rect.y + 15,
          )
        }
        const modelDetails = latestOpticalDiagnosticsRef.current ?? []
        const latestDecoder = [...recentDecoderResultsRef.current.entries()]
          .sort((left, right) => right[1].completedAt - left[1].completedAt)[0]
        const lines = [
          `TRACKING DIAGNOSTIC ${diagnostic.id}  t=${(now - diagnostic.startedAt).toFixed(0)}ms`,
          `frame ${cadenceRef.current.cameraFrames}  ${video.videoWidth}×${video.videoHeight} → ${Math.round(width)}×${Math.round(height)} @ ${qualityRef.current.tier}`,
          `decoder ${latestDecoder?.[0] ?? 'none'} capture ${latestDecoder ? latestDecoder[1].capturedAt.toFixed(1) : '-'} completion ${latestDecoder ? latestDecoder[1].completedAt.toFixed(1) : '-'} latency ${decodeLatencyRef.current.toFixed(1)}ms`,
          `register Δ${registrationDiagnosticsRef.current.lagMs.toFixed(1)}ms replay ${registrationDiagnosticsRef.current.replayFrames}/${registrationDiagnosticsRef.current.replayLatencyMs.toFixed(1)}ms`,
          `decode refresh ${registrationDiagnosticsRef.current.decodeRefreshes} suppressed ${registrationDiagnosticsRef.current.suppressedReanchors} forced ${registrationDiagnosticsRef.current.forcedReanchors} ${registrationDiagnosticsRef.current.lastReanchorReason || '-'}`,
          modelDetails.length
            ? modelDetails.map((item) => `${item.identity.slice(0, 16)} ${item.model} f/s/i ${item.features}/${item.survivors}/${item.inliers} cells ${item.distributedCells ?? '-'} mask-out ${item.maskViolations ?? 0} reproj ${item.reprojectionError.toFixed(2)} [${Object.entries(item.candidateErrors ?? {}).map(([model, error]) => `${model[0]}=${error.toFixed(2)}`).join(' ')}] FB ${item.forwardBackwardError.toFixed(2)} conf ${(item.confidence * 100).toFixed(0)}%${item.rejectionReason ? ` reject ${item.rejectionReason}` : ''}`).join(' | ')
            : `model none · reject ${opticalRejectionsRef.current.at(-1) ?? 'none'}`,
          `selection ${modelDetails.map((item) => item.selectedModelReason ?? 'none').join(' | ') || 'none'}`,
          `stabilizer ${visible.map((item) => `${item.detection.data.slice(0, 10)} ${item.stabilization.motion} Δ${item.stabilization.rawFilteredDeltaPx.toFixed(2)}px speed ${item.stabilization.normalizedSpeed.toFixed(2)}/s cutoff ${item.stabilization.cutoffHz.toFixed(2)}Hz gain ${item.stabilization.gain.toFixed(2)}`).join(' | ') || 'none'}`,
          `qualification ${visible.map((item) => `${item.detection.data.slice(0, 10)} ${item.holdQualificationSource} conf ${(item.confidence * 100).toFixed(0)}% grace ${Math.round(item.holdQualificationGraceRemainingMs)}ms`).join(' | ') || 'none'}`,
          `result authority ${resultAuthorityRef.current.source} grace ${Math.round(resultAuthorityRef.current.graceRemainingMs)}ms`,
          `ActionZone ${nextZones.map((zone) => `${zone.id}:${zone.occupant?.playerId ?? '-'} ${zone.status} ${Math.round(zone.progress * 100)}%`).join(' | ') || 'none'}`,
          'LEGEND amber dashed=decoded anchor · cyan/green=current planar fit · trail=model confidence',
        ]
        const lineHeight = 18
        diagnosticContext.fillStyle = 'rgba(8,5,12,.8)'
        diagnosticContext.fillRect(8, 8, width - 16, lines.length * lineHeight + 12)
        diagnosticContext.font = '12px ui-monospace, monospace'
        lines.forEach((line, index) => {
          diagnosticContext.fillStyle = index === lines.length - 1 ? '#ffe29a' : '#f4eff7'
          diagnosticContext.fillText(line.slice(0, 180), 14, 24 + index * lineHeight)
        })
        const sample = {
          at: now,
          frameSequence: cadenceRef.current.cameraFrames,
          decoder: latestDecoder && {
            source: latestDecoder[0],
            capturedAt: latestDecoder[1].capturedAt,
            completedAt: latestDecoder[1].completedAt,
            latencyMs: latestDecoder[1].completedAt - latestDecoder[1].capturedAt,
          },
          registration: { ...registrationDiagnosticsRef.current },
          tracking: modelDetails,
          stabilization: visible.map((item) => ({
            identity: item.detection.data,
            state: item.stabilization.motion,
            rawQuad: item.stabilization.raw,
            filteredQuad: item.stabilization.filtered,
            rawCenter: item.stabilization.raw && Object.values(item.stabilization.raw.location)
              .reduce((sum, point) => ({
                x: sum.x + point.x / 4,
                y: sum.y + point.y / 4,
              }), { x: 0, y: 0 }),
            filteredCenter: item.stabilization.filtered
              && Object.values(item.stabilization.filtered.location).reduce((sum, point) => ({
                x: sum.x + point.x / 4,
                y: sum.y + point.y / 4,
              }), { x: 0, y: 0 }),
            rawFilteredDeltaPx: item.stabilization.rawFilteredDeltaPx,
            normalizedSpeed: item.stabilization.normalizedSpeed,
            cutoffHz: item.stabilization.cutoffHz,
            gain: item.stabilization.gain,
          })),
          qualification: visible.map((item) => ({
            identity: item.detection.data,
            qualified: item.holdQualified,
            source: item.holdQualificationSource,
            confidence: item.confidence,
            graceRemainingMs: item.holdQualificationGraceRemainingMs,
            decodedAnchorAgeMs: item.ageMs,
            visualEvidenceAgeMs: item.evidenceAgeMs,
          })),
          resultAuthority: {
            qualified: resultAuthorityRef.current.qualified,
            source: resultAuthorityRef.current.source,
            graceRemainingMs: resultAuthorityRef.current.graceRemainingMs,
            gameKey: resultAuthorityRef.current.state.gameKey,
            laneKey: resultAuthorityRef.current.state.laneKey,
            assignmentKey: resultAuthorityRef.current.state.assignmentKey,
            playerIdentityKey: resultAuthorityRef.current.state.playerIdentityKey,
            directAuthorityAt: resultAuthorityRef.current.state.directAuthorityAt,
          },
          dimensions: {
            source: scanSize,
            video: { width: video.videoWidth, height: video.videoHeight },
            preview: { width, height },
          },
          cadence: cadenceRates(cadenceRef.current, now),
          actionZones: nextZones.map((zone) => ({
            id: zone.id,
            occupant: zone.occupant?.playerId ?? null,
            progress: zone.progress,
            status: zone.status,
            qualified: holdQualifiedPlayerIds.has(zone.occupant?.playerId ?? -1),
            reason: overlayMessageRef.current || null,
          })),
          identity: visible.map((item) => item.detection.data),
          rejectionReason: opticalRejectionsRef.current.at(-1) ?? null,
        }
        diagnosticSessionRef.current = appendDiagnosticSample(diagnostic, sample)
        const remainingMs = diagnosticRemainingMs(diagnostic, now)
        setDiagnosticUi((current) => {
          const rounded = Math.ceil(remainingMs / 1000) * 1000
          return current.remainingMs === rounded ? current : { ...current, remainingMs: rounded }
        })
        if (remainingMs === 0) queueMicrotask(() => finalizeDiagnosticRef.current?.())
      }
    }
    cadenceRef.current.paints += visible.length > 0 ? 1 : 0
  }, [
    clearResultMode,
    preferences.showDebugTools,
    requestPlayerResolution,
    submitCheckIn,
    submitResult,
    updateOverlayMessage,
  ])

  const captureTrackingFrame = useCallback((
    source: CanvasImageSource,
    capturedAt: number,
    generation: number,
  ): TrackingFrame | null => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight || generation !== cameraGenerationRef.current) {
      return null
    }
    const profile = qualityRef.current
    const size = scanDimensions(video.videoWidth, video.videoHeight, profile.trackMaxDimension)
    if (!size.width || !size.height) return null
    const latest = trackingHistoryRef.current.latest()
    if (
      latest
      && latest.capturedAt === capturedAt
      && latest.generation === generation
      && latest.width === size.width
      && latest.height === size.height
      && latest.tier === profile.tier
    ) return latest
    const canvas = visualCaptureRef.current ?? document.createElement('canvas')
    visualCaptureRef.current = canvas
    if (canvas.width !== size.width) canvas.width = size.width
    if (canvas.height !== size.height) canvas.height = size.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    const startedAt = performance.now()
    context.drawImage(source, 0, 0, size.width, size.height)
    const image = context.getImageData(0, 0, size.width, size.height)
    trackingCaptureCostRef.current = performance.now() - startedAt
    trackingCaptureCountRef.current += 1
    const frame = {
      generation,
      capturedAt,
      width: size.width,
      height: size.height,
      tier: profile.tier,
      pixels: new Uint8ClampedArray(image.data),
    }
    trackingHistoryRef.current.add(frame)
    return frame
  }, [])

  const recordDetections = useCallback((
    detections: readonly {
      detection: QrDetection
      capturedAt: number
      registration: Omit<RegisteredAnchor, 'detection' | 'capturedAt'> | null
    }[],
    now: number,
  ) => {
    cadenceRef.current.decodes += 1
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    for (const { detection, capturedAt, registration } of detections) {
      const existing = trackingRefs.current.get(detection.data)
      const latestFrame = trackingHistoryRef.current.latest()
      const dimensionsAndGenerationMatch = Boolean(
        registration
        && registration.generation === cameraGenerationRef.current
        && (!latestFrame || (
          registration.width === latestFrame.width
          && registration.height === latestFrame.height
          && registration.tier === latestFrame.tier
        )),
      )
      const decision = decideDecodeReanchor(existing, detection, capturedAt, {
        registered: registration !== null,
        dimensionsAndGenerationMatch,
      })
      const registrationDiagnostics = registrationDiagnosticsRef.current
      registrationDiagnostics.decodeRefreshes += 1
      registrationDiagnostics.lastReanchorReason = decision.reason
      const forced = decision.reason !== 'consistent-refresh'
        && decision.reason !== 'unregistered-refresh'
      if (forced) registrationDiagnostics.forcedReanchors += 1
      else registrationDiagnostics.suppressedReanchors += 1
      const previous = existing ?? emptyTrackingState()
      const refreshed = observeDetection(previous, detection, capturedAt)
      trackingRefs.current.set(detection.data, decision.reanchor
        ? { ...refreshed, lastReanchorAt: capturedAt }
        : refreshed)
      if (!decision.reanchor) {
        visualTrackerRef.current.refreshAuthority(detection.data, capturedAt)
      }
      if (decision.reanchor && registration) {
        pendingOpticalAnchorsRef.current.set(detection.data, {
          detection,
          capturedAt,
          ...registration,
        })
      } else if (forced && !registration) {
        registrationDiagnosticsRef.current.lastRejection = 'decoder-frame-not-registered'
      }
    }
    if (detections.length === 1) {
      const detection = detections[0].detection
      const next = { detection, seenAt: now }
      rememberedRef.current = next
      setRemembered((current) =>
        current?.detection.data === detection.data ? current : next)
    } else if (detections.length > 1) {
      rememberedRef.current = null
      setRemembered(null)
    }
    if (!piecePresentRef.current
      && detections.some(({ detection }) => isPlayerPiece(detection.data))) {
      presenceHysteresisRef.current = {
        visible: true,
        missingSince: null,
        lastSeenAt: now,
      }
      piecePresentRef.current = true
      setPiecePresent(true)
    }
  }, [])

  const updateVisualTracking = useCallback((
    video: HTMLVideoElement,
    now: number,
    forceAnchorCapture = false,
  ) => {
    const profile = qualityRef.current
    const adaptiveInterval = Math.min(
      TRACKING_CAPTURE_MAX_INTERVAL_MS,
      Math.max(
        profile.trackIntervalMs,
        trackingCaptureCostRef.current > TRACKING_CAPTURE_BUDGET_MS
          ? trackingCaptureCostRef.current * 3
          : 0,
      ),
    )
    if (!forceAnchorCapture && now - lastTrackRef.current < adaptiveInterval) return
    const optical = opticalTrackerRef.current
    if (opticalReadyRef.current && optical?.busy) return
    lastTrackRef.current = now
    try {
      const historyFrame = captureTrackingFrame(video, now, cameraGenerationRef.current)
      if (!historyFrame) return
      const size = { width: historyFrame.width, height: historyFrame.height }
      const frame = rgbaToVisualFrame(historyFrame.pixels, size.width, size.height, now)
      if (!frame) return
      if (
        visualFrameRef.current
        && (visualFrameRef.current.width !== frame.width
          || visualFrameRef.current.height !== frame.height)
      ) {
        visualTrackerRef.current.clear()
      }
      visualFrameRef.current = frame
      const applyObservations = (observations: ReturnType<VisualObjectTracker['update']>) => {
        const visualIdentities = new Set(observations.map(({ detection }) => detection.data))
        for (const [identity, state] of trackingRefs.current) {
          if (state.source === 'visual' && !visualIdentities.has(identity)) {
            trackingRefs.current.set(identity, rejectVisualDetection(state))
          }
        }
        const videoSize = { width: video.videoWidth, height: video.videoHeight }
        for (const tracked of observations) {
          if (tracked.source !== 'visual') continue
          const previous = trackingRefs.current.get(tracked.detection.data)
          if (!previous) continue
          trackingRefs.current.set(tracked.detection.data, observeVisualDetection(
            previous,
            scaleDetection(tracked.detection, frame, videoSize),
            tracked.updatedAt,
            tracked.confidence,
            tracked.actionable,
          ))
        }
      }
      const pendingAnchors = [...pendingOpticalAnchorsRef.current.values()]
      const replayAnchors: OpticalReplayAnchor[] = []
      const fallbackRegistrations: Array<{
        anchor: RegisteredAnchor
        frames: TrackingFrame[]
      }> = []
      for (const anchor of pendingAnchors) {
        if (now - anchor.capturedAt > TRACKING_BRIDGE_MAX_ANCHOR_AGE_MS) {
          pendingOpticalAnchorsRef.current.delete(anchor.detection.data)
          registrationDiagnosticsRef.current.lastRejection = 'anchor-expired'
          continue
        }
        const registered = registerAnchor(trackingHistoryRef.current, anchor)
        if (!registered.matched) {
          pendingOpticalAnchorsRef.current.delete(anchor.detection.data)
          registrationDiagnosticsRef.current.lastRejection = registered.reason
          continue
        }
        registrationDiagnosticsRef.current.lagMs = registered.deltaMs
        registrationDiagnosticsRef.current.replayFrames = registered.frames.length
        fallbackRegistrations.push({ anchor, frames: registered.frames })
        const videoSize = { width: video.videoWidth, height: video.videoHeight }
        replayAnchors.push({
          detection: scaleDetection(anchor.detection, videoSize, registered.frames[0]),
          anchoredAt: anchor.capturedAt,
          frames: registered.frames.map((item) => ({
            width: item.width,
            height: item.height,
            capturedAt: item.capturedAt,
            pixels: new Uint8Array(item.pixels).slice().buffer,
          })),
        })
      }
      if (opticalReadyRef.current && optical && !optical.busy) {
        const generation = cameraGenerationRef.current
        const replayStartedAt = performance.now()
        const request = replayAnchors.length > 0
          ? optical.reanchor(replayAnchors, generation)
          : optical.process(
              new Uint8Array(historyFrame.pixels).slice().buffer,
              size.width,
              size.height,
              now,
              generation,
              [],
              Object.fromEntries([...trackingRefs.current].map(([identity, state]) => [
                identity,
                state.decodedAt,
              ])),
            )
        if (request) {
          opticalRequestsRef.current += 1
          replayAnchors.forEach(({ detection }) =>
            pendingOpticalAnchorsRef.current.delete(detection.data))
        }
        request?.then((result) => {
            if (result.generation !== cameraGenerationRef.current) return
            trackLatencyRef.current = result.elapsedMs
            if (replayAnchors.length > 0) {
              registrationDiagnosticsRef.current.replayLatencyMs =
                performance.now() - replayStartedAt
              registrationDiagnosticsRef.current.lastRejection =
                result.observations.length > 0
                  ? ''
                  : result.diagnostics.rejectionReasons.at(-1) ?? 'replay-no-observation'
            }
            opticalCompletionsRef.current += 1
            opticalAcceptedRef.current += result.diagnostics.accepted
            opticalRejectedRef.current += result.diagnostics.rejected
            opticalRejectionsRef.current = result.diagnostics.rejectionReasons
            latestOpticalDiagnosticsRef.current = result.diagnostics.tracks ?? []
            applyObservations(result.observations)
                  }).catch(() => {
                    if (generation !== cameraGenerationRef.current) return
                    opticalReadyRef.current = false
            trackerModeRef.current = 'lightweight'
          })
        return
      }
      if (replayAnchors.length > 0) {
        const replayFrames = [...new Map(fallbackRegistrations
          .flatMap(({ frames }) => frames)
          .map((item) => [item.capturedAt, item])).values()]
          .sort((left, right) => left.capturedAt - right.capturedAt)
        let fallbackObservations: ReturnType<VisualObjectTracker['update']> = []
        for (const replayFrame of replayFrames) {
          const visualFrame = rgbaToVisualFrame(
            replayFrame.pixels,
            replayFrame.width,
            replayFrame.height,
            replayFrame.capturedAt,
          )
          if (!visualFrame) continue
          const starting = fallbackRegistrations
            .filter(({ frames }) => frames[0].capturedAt === replayFrame.capturedAt)
            .map(({ anchor }) => scaleDetection(
              anchor.detection,
              { width: video.videoWidth, height: video.videoHeight },
              visualFrame,
            ))
          if (starting.length > 0) {
            visualTrackerRef.current.anchor(
              starting,
              visualFrame,
              replayFrame.capturedAt,
              Object.fromEntries(fallbackRegistrations.map(({ anchor }) => [
                anchor.detection.data,
                anchor.capturedAt,
              ])),
            )
          }
          fallbackObservations = visualTrackerRef.current.update(
            visualFrame,
            replayFrame.capturedAt,
          )
        }
        replayAnchors.forEach(({ detection }) =>
          pendingOpticalAnchorsRef.current.delete(detection.data))
        applyObservations(fallbackObservations)
        registrationDiagnosticsRef.current.lastRejection =
          fallbackObservations.length > 0 ? '' : 'fallback-replay-failed'
        return
      }
      const observations = visualTrackerRef.current.update(frame, now)
      applyObservations(observations)
    } catch (error) {
      visualFrameRef.current = null
      trackerFailureRef.current = error instanceof Error ? error.message : 'frame capture failed'
    }
  }, [captureTrackingFrame])

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
      setCameraNotice('Camera paused after 5 minutes without a QR code. Start it when you are ready to scan again.')
      setCameraState('inactive')
    }, CAMERA_INACTIVITY_MS)
  }, [clearInactivityTimer, drawOverlay, stopCamera])

  const recordQrActivity = useCallback((generation: number, detections: readonly QrDetection[]) => {
    if (detections.length === 0 || generation !== cameraGenerationRef.current) return
    armInactivityTimer(generation)
  }, [armInactivityTimer])

  const recordDecoderResult = useCallback((
    name: DecoderName,
    detections: readonly QrDetection[],
    completedAt: number,
    sourceSize: { width: number; height: number },
    generation: number,
    capturedAt = completedAt,
    registration: Omit<RegisteredAnchor, 'detection' | 'capturedAt'> | null = null,
  ) => {
    if (generation !== cameraGenerationRef.current) return
    decodeLatencyRef.current = completedAt - capturedAt
    const stats = decoderInputStatsRef.current[name]
    if (stats) stats.completedAt = completedAt
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const videoSize = { width: video.videoWidth, height: video.videoHeight }
    const normalized = detections.map((detection) =>
      scaleDetection(detection, sourceSize, videoSize))
    recentDecoderResultsRef.current.set(name, {
      completedAt, capturedAt, detections: normalized, registration,
    })
    for (const [decoder, result] of recentDecoderResultsRef.current) {
      if (completedAt - result.completedAt > RESULT_MERGE_WINDOW_MS) {
        recentDecoderResultsRef.current.delete(decoder)
      }
    }
    const merged = normalized.length === 0
      ? []
      : mergeTimedDecoderDetections(
          [...recentDecoderResultsRef.current.entries()].map(([decoder, item]) => ({
            decoder,
            capturedAt: item.capturedAt,
            detections: item.detections,
          })),
        )
    if (merged.length > 0) lastDecodedAtRef.current = completedAt
    recordQrActivity(generation, merged.map(({ detection }) => detection))
    recordDetections(merged.map((item) => {
      const source = recentDecoderResultsRef.current.get(item.decoder)
      return {
        detection: item.detection,
        capturedAt: item.capturedAt,
        registration: source?.capturedAt === item.capturedAt
          ? source?.registration ?? null
          : null,
      }
    }), completedAt)
  }, [recordDetections, recordQrActivity])

  const activateWorkerDecoder = useCallback(function activateWorkerDecoder(
    generation: number,
    kind: 'zxing-wasm' | 'jsqr' = 'zxing-wasm',
  ) {
    if (generation !== cameraGenerationRef.current) return
    const ref = kind === 'zxing-wasm' ? zxingDecoderRef : jsQrDecoderRef
    if (ref.current) return
    const handleDecoderFailure = (error: Error) => {
      if (generation !== cameraGenerationRef.current) return
      decoderFailureRef.current.set(kind, error.message)
      ref.current?.terminate()
      ref.current = null
      if (kind === 'zxing-wasm') {
        decoderReadyRef.current.zxing = false
        activateWorkerDecoder(generation, 'jsqr')
      } else {
        decoderReadyRef.current.jsqr = false
        if (!nativeDetectorRef.current) setCameraState('error')
      }
    }
    try {
      const decoder = new WorkerDecoder(
        kind === 'zxing-wasm' ? workerFactory() : jsQrWorkerFactory(),
        handleDecoderFailure,
      )
      ref.current = decoder
      void decoder.initialize(generation).then(() => {
        if (generation !== cameraGenerationRef.current || ref.current !== decoder) return
        if (kind === 'zxing-wasm') decoderReadyRef.current.zxing = true
        else decoderReadyRef.current.jsqr = true
      }).catch(handleDecoderFailure)
    } catch (error) {
      handleDecoderFailure(error instanceof Error ? error : new Error('decoder startup failed'))
    }
  }, [jsQrWorkerFactory, workerFactory])

  const scan = useCallback(function scanFrame(time: number, generation: number) {
    if (generation !== cameraGenerationRef.current) return
    scheduleRef.current = null
    cadenceRef.current.cameraFrames += 1
    const video = videoRef.current
    if (trackingPhaseRef.current === 'lost' && rememberedRef.current) {
      rememberedRef.current = null
      setRemembered(null)
    }
    if (time - lastDiagnosticsRef.current >= 1000) {
      const rates = cadenceRates(cadenceRef.current, time)
      const history = trackingHistoryRef.current.stats()
      const registration = registrationDiagnosticsRef.current
      if (diagnosticsRef.current) {
        diagnosticsRef.current.textContent =
          `${formatCameraDiagnostics(cameraDiagnosticsRef.current)} · `
          + `${decoderReadyRef.current.zxing ? 'zxing' : 'no-zxing'}`
          + `+${nativeDetectorRef.current ? 'native' : 'no-native'}`
          + `+${decoderReadyRef.current.jsqr ? 'jsqr' : 'no-jsqr'}`
          + `/${trackerModeRef.current} · ${qualityRef.current.tier} · `
          + `${decodeLatencyRef.current.toFixed(0)}ms decode/${trackLatencyRef.current.toFixed(0)}ms track · `
          + `${rates.cameraFps.toFixed(0)} camera / ${rates.decodeFps.toFixed(0)} decode / ${rates.paintFps.toFixed(0)} paint / ${trackingCaptureCountRef.current} track-capture fps`
          + ` · optical ${opticalRequestsRef.current}/${opticalCompletionsRef.current}`
          + ` accepted ${opticalAcceptedRef.current}/rejected ${opticalRejectedRef.current}`
          + ` · capture ${trackingCaptureCostRef.current.toFixed(1)}ms`
          + ` · history ${history.count}/${history.ageMs.toFixed(0)}ms/`
          + `${(history.bytes / 1024 / 1024).toFixed(1)}MiB`
          + ` · register Δ${registration.lagMs.toFixed(0)}ms`
          + ` replay ${registration.replayFrames}/${registration.replayLatencyMs.toFixed(0)}ms`
          + ` evidence ${registration.evidenceAgeMs.toFixed(0)}ms`
          + ` decode ${registration.decodeRefreshes}`
          + ` suppress ${registration.suppressedReanchors}`
          + ` force ${registration.forcedReanchors}`
          + `${registration.lastReanchorReason
            ? ` (${registration.lastReanchorReason})` : ''}`
          + `${registration.lastRejection ? ` reject ${registration.lastRejection}` : ''}`
          + ` · tracker ${opticalReadyRef.current ? 'ready' : 'fallback'}`
          + `${opticalTrackerRef.current?.busy ? '/busy' : '/idle'}`
          + `${opticalRejectionsRef.current.length
            ? ` (${opticalRejectionsRef.current.join(',')})` : ''}`
          + ` · ${formatDecoderInputStats(
            video?.videoWidth ?? 0,
            video?.videoHeight ?? 0,
            decoderInputStatsRef.current,
          )}`
          + ` · ${trackingPhaseRef.current} · ${presenceStateRef.current}`
          + ` · ${trackingDiagnosticsRef.current}`
          + `${decoderFailureRef.current.size || trackerFailureRef.current
            ? ` · fallback: ${[
              ...decoderFailureRef.current.entries(),
            ].map(([name, message]) => `${name}: ${message}`).join('; ')
              || trackerFailureRef.current}` : ''}`
      }
      cadenceRef.current = { startedAt: time, cameraFrames: 0, decodes: 0, paints: 0 }
      trackingCaptureCountRef.current = 0
      opticalRequestsRef.current = 0
      opticalCompletionsRef.current = 0
      opticalAcceptedRef.current = 0
      opticalRejectedRef.current = 0
      lastDiagnosticsRef.current = time
    }
    let workerDecodeLaunched = false
    const usableVideo = video
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && video.videoWidth && video.videoHeight
    if (usableVideo) {
      scanSizeRef.current = { width: video.videoWidth, height: video.videoHeight }
      const reanchorPending = pendingOpticalAnchorsRef.current.size > 0
      const nativeDetector = nativeDetectorRef.current
      if (
        !reanchorPending
        && nativeDetector
        && nativePendingGenerationRef.current === null
        && time - lastNativeScanRef.current >= NATIVE_DECODE_INTERVAL_MS
      ) {
        lastNativeScanRef.current = time
        nativePendingGenerationRef.current = generation
        const previousNativeAttempt = decoderInputStatsRef.current.native?.attemptedAt
        decoderInputStatsRef.current.native = {
          width: video.videoWidth, height: video.videoHeight, attemptedAt: time,
          intervalMs: previousNativeAttempt === undefined ? undefined : time - previousNativeAttempt,
        }
        const nativeFrame = captureTrackingFrame(video, time, generation)
        const nativeRegistration = nativeFrame ? {
          generation: nativeFrame.generation,
          width: nativeFrame.width,
          height: nativeFrame.height,
          tier: nativeFrame.tier,
        } : null
        void detectNativeQrs(nativeDetector, video).then((detections) => {
          if (nativePendingGenerationRef.current === generation) {
            nativePendingGenerationRef.current = null
          }
          if (generation !== cameraGenerationRef.current) return
          recordDecoderResult(
            'native', detections, performance.now(),
            { width: video.videoWidth, height: video.videoHeight }, generation, time,
            nativeRegistration,
          )
        }).catch((error) => {
          if (nativePendingGenerationRef.current === generation) {
            nativePendingGenerationRef.current = null
          }
          if (generation !== cameraGenerationRef.current) return
          decoderFailureRef.current.set(
            'native',
            error instanceof Error ? error.message : 'decode failed',
          )
          nativeDetectorRef.current = null
        })
      }

      const runWorkerDecode = (
        name: 'zxing-wasm' | 'jsqr',
        decoder: WorkerDecoder,
      ): boolean => {
        const capture = captureRef.current ?? document.createElement('canvas')
        captureRef.current = capture
        const dimensions = workerDecodeDimensions(
          video.videoWidth,
          video.videoHeight,
          qualityRef.current,
          time,
          lastFullDetailScanRef.current[name],
        )
        if (dimensions.fullDetail) lastFullDetailScanRef.current[name] = time
        capture.width = dimensions.width
        capture.height = dimensions.height
        const previousAttempt = decoderInputStatsRef.current[name]?.attemptedAt
        decoderInputStatsRef.current[name] = {
          width: dimensions.width, height: dimensions.height, attemptedAt: time,
          intervalMs: previousAttempt === undefined ? undefined : time - previousAttempt,
        }
        const context = capture.getContext('2d', { willReadFrequently: true })
        if (context) {
          context.drawImage(video, 0, 0, dimensions.width, dimensions.height)
          const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height)
          const decoderFrame = captureTrackingFrame(capture, time, generation)
          const decoderRegistration = decoderFrame ? {
            generation: decoderFrame.generation,
            width: decoderFrame.width,
            height: decoderFrame.height,
            tier: decoderFrame.tier,
          } : null
          const pending = decoder.decode(
            pixels.data.buffer as ArrayBuffer,
            dimensions.width,
            dimensions.height,
            generation,
          )
          pending?.then((result) => {
            if (result.generation !== cameraGenerationRef.current) return
            decodeLatencyRef.current = result.elapsedMs
            if (name === 'zxing-wasm') qualityRef.current = selectQuality({
              cameraWidth: cameraDiagnosticsRef.current?.width ?? video.videoWidth,
              cameraHeight: cameraDiagnosticsRef.current?.height ?? video.videoHeight,
              frameRate: cameraDiagnosticsRef.current?.frameRate,
              hardwareConcurrency: navigator.hardwareConcurrency,
              deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
              wasm: typeof WebAssembly !== 'undefined',
              simd: supportsWasmSimd(),
              offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
              visible: document.visibilityState !== 'hidden',
              decodeLatencyMs: result.elapsedMs,
              trackLatencyMs: trackLatencyRef.current,
            })
            recordDecoderResult(
              name,
              result.detections,
              performance.now(),
              { width: dimensions.width, height: dimensions.height },
              generation,
              time,
              decoderRegistration,
            )
          }).catch((error) => {
            if (generation !== cameraGenerationRef.current) return
            decoderFailureRef.current.set(
              name,
              error instanceof Error ? error.message : 'decode failed',
            )
            decoder.terminate()
            if (name === 'zxing-wasm') {
              if (zxingDecoderRef.current === decoder) zxingDecoderRef.current = null
              decoderReadyRef.current.zxing = false
              activateWorkerDecoder(generation, 'jsqr')
            } else {
              if (jsQrDecoderRef.current === decoder) jsQrDecoderRef.current = null
              decoderReadyRef.current.jsqr = false
              if (!nativeDetectorRef.current && !zxingDecoderRef.current) setCameraState('error')
            }
          })
          return pending !== null
        }
        return false
      }

      const zxing = zxingDecoderRef.current
      if (
        !reanchorPending
        && zxing
        && decoderReadyRef.current.zxing
        && !zxing.busy
        && time - lastZxingScanRef.current >= qualityRef.current.decodeIntervalMs
      ) {
        lastZxingScanRef.current = time
        workerDecodeLaunched = runWorkerDecode('zxing-wasm', zxing)
      }
      const jsQrDue = !reanchorPending
        && time - lastDecodedAtRef.current >= JSQR_IDLE_BEFORE_ATTEMPT_MS
        && time - lastJsQrScanRef.current >= JSQR_DECODE_INTERVAL_MS
      if (jsQrDue && !jsQrDecoderRef.current) activateWorkerDecoder(generation, 'jsqr')
      const jsqr = jsQrDecoderRef.current
      if (!workerDecodeLaunched && jsQrDue && jsqr && decoderReadyRef.current.jsqr && !jsqr.busy) {
        lastJsQrScanRef.current = time
        workerDecodeLaunched = runWorkerDecode('jsqr', jsqr)
      }
    }
    if (usableVideo && (!workerDecodeLaunched || !opticalReadyRef.current)) {
      updateVisualTracking(video, time, pendingOpticalAnchorsRef.current.size > 0)
    }
    drawOverlay(time)
    scheduleScan(generation, (nextTime) => scanFrame(nextTime, generation))
  }, [
    activateWorkerDecoder,
    drawOverlay,
    recordDecoderResult,
    captureTrackingFrame,
    scheduleScan,
    updateVisualTracking,
  ])

  const startCamera = useCallback(async () => {
    setCameraNotice('')
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
      qualityRef.current = selectQuality({
        cameraWidth: cameraDiagnosticsRef.current?.width,
        cameraHeight: cameraDiagnosticsRef.current?.height,
        frameRate: cameraDiagnosticsRef.current?.frameRate,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        wasm: typeof WebAssembly !== 'undefined',
        simd: supportsWasmSimd(),
        offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
        visible: document.visibilityState !== 'hidden',
      })
      decoderReadyRef.current = { zxing: false, jsqr: false }
      decoderFailureRef.current.clear()
      decoderInputStatsRef.current = {}
      recentDecoderResultsRef.current.clear()
      activateWorkerDecoder(generation)
      try {
        const tracker = new OpticalFlowTracker(openCvWorkerFactory(), (error) => {
          if (generation !== cameraGenerationRef.current) return
          opticalReadyRef.current = false
          trackerModeRef.current = 'lightweight'
          trackerFailureRef.current = `opencv-lk: ${error.message}`
        })
        opticalTrackerRef.current = tracker
        void tracker.initialize(generation).then(() => {
          if (generation !== cameraGenerationRef.current || opticalTrackerRef.current !== tracker) return
          opticalReadyRef.current = true
          trackerModeRef.current = 'opencv-lk'
          trackerFailureRef.current = ''
        }).catch(() => undefined)
      } catch (error) {
        trackerFailureRef.current =
          `opencv-lk: ${error instanceof Error ? error.message : 'worker startup failed'}`
        trackerModeRef.current = 'lightweight'
      }
      video.srcObject = stream
      await video.play()
      if (generation !== cameraGenerationRef.current || streamRef.current !== stream) return
      setCameraState('active')
      armInactivityTimer(generation)
      cadenceRef.current = {
        startedAt: performance.now(), cameraFrames: 0, decodes: 0, paints: 0,
      }
      lastDiagnosticsRef.current = performance.now()
      const startedAt = performance.now()
      lastNativeScanRef.current = startedAt - NATIVE_DECODE_INTERVAL_MS
      lastZxingScanRef.current = startedAt - qualityRef.current.decodeIntervalMs
      lastJsQrScanRef.current = startedAt
      lastFullDetailScanRef.current = { 'zxing-wasm': 0, jsqr: 0 }
      lastDecodedAtRef.current = startedAt
      scheduleScan(generation, (time) => scan(time, generation))
    } catch (error) {
      if (generation !== cameraGenerationRef.current) return
      stopCamera()
      setCameraState(classifyCameraError(error))
    }
  }, [
    activateWorkerDecoder,
    armInactivityTimer,
    drawOverlay,
    nativeDetectorFactory,
    openCvWorkerFactory,
    scan,
    scheduleScan,
    stopCamera,
  ])

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

  useEffect(() => {
    const updateVisibilityTier = () => {
      const camera = cameraDiagnosticsRef.current
      qualityRef.current = selectQuality({
        cameraWidth: camera?.width,
        cameraHeight: camera?.height,
        frameRate: camera?.frameRate,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        wasm: typeof WebAssembly !== 'undefined',
        simd: supportsWasmSimd(),
        offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
        visible: document.visibilityState !== 'hidden',
        decodeLatencyMs: decodeLatencyRef.current,
        trackLatencyMs: trackLatencyRef.current,
      })
    }
    document.addEventListener('visibilitychange', updateVisibilityTier)
    return () => document.removeEventListener('visibilitychange', updateVisibilityTier)
  }, [])

  useEffect(() => () => {
    playerCreationRef.current?.abort()
    stopCamera()
  }, [stopCamera])

  useEffect(() => {
    const parsed = remembered ? parseQrPayload(remembered.detection.data) : null
    const currentReference = parsed?.kind === 'player-reference'
      ? parsed.reference.playerId
      : null
    const presence = rememberedReferencePresenceRef.current
    if (currentReference === null) {
      if (presence.playerId !== null && presence.leftAt === null) presence.leftAt = Date.now()
      return
    }
    if (presence.playerId === currentReference) {
      if (presence.leftAt !== null
        && Date.now() - presence.leftAt >= PLAYER_LOOKUP_REENTRY_RESET_MS) {
        playerLookupErrorRef.current.delete(currentReference)
      }
      presence.leftAt = null
      return
    }
    presence.playerId = currentReference
    presence.leftAt = null
  }, [remembered])

  useEffect(() => {
    diagnosticMountedRef.current = true
    const urls = diagnosticUrlsRef.current
    return () => {
      diagnosticMountedRef.current = false
      diagnosticSessionRef.current = null
      if (diagnosticRecorderRef.current?.state !== 'inactive') diagnosticRecorderRef.current?.stop()
      diagnosticStreamRef.current?.getTracks().forEach((track) => track.stop())
      diagnosticStreamRef.current = null
      urls.revoke()
    }
  }, [])

  const generatePlayerQr = async () => {
    const request = ++qrRequestRef.current
    playerCreationRef.current?.abort()
    const controller = new AbortController()
    playerCreationRef.current = controller
    setPlayer(null)
    setQrDataUrl('')
    setProducerError('')
    let createdPlayer: PlayerPayload | null = null
    let displayed = false
    let generationError = ''
    try {
      const next = await createPlayer(normalizePlayerName(name), controller.signal)
      createdPlayer = next
      if (controller.signal.aborted || request !== qrRequestRef.current) return
      const encoded = encodePlayerReference(next.playerId)
      const url = await qrEncoder(encoded)
      if (controller.signal.aborted || request !== qrRequestRef.current) return
      displayed = true
      playerCacheRef.current.set(next.playerId, next)
      setPlayer(next)
      setQrDataUrl(url)
      setLeaderboardRefresh((value) => value + 1)
    } catch (error) {
      if (controller.signal.aborted || request !== qrRequestRef.current) return
      setPlayer(null)
      setQrDataUrl('')
      generationError = error instanceof Error ? error.message : 'Could not generate QR code.'
      setProducerError(generationError)
    } finally {
      if (createdPlayer && !displayed) {
        try {
          await deletePlayer(createdPlayer.playerId, new AbortController().signal)
        } catch (error) {
          const cleanupError = error instanceof Error ? error.message : 'Unknown cleanup failure.'
          const prefix = generationError ? `${generationError} ` : ''
          setProducerError(
            `${prefix}Player #${createdPlayer.playerId} cleanup failed: ${cleanupError}`,
          )
        }
      }
      if (playerCreationRef.current === controller) playerCreationRef.current = null
    }
  }

  const copy = stateCopy[cameraState]
  const parsedRaw = remembered ? parseQrPayload(remembered.detection.data) : null
  const authoritativePlayerScan: AuthoritativePlayerScan | null = remembered
    && (parsedRaw?.kind === 'player' || parsedRaw?.kind === 'player-reference')
    ? {
        playerId: parsedRaw.kind === 'player'
          ? parsedRaw.player.playerId
          : parsedRaw.reference.playerId,
        token: `${remembered.detection.data}:${remembered.seenAt}`,
      }
    : null
  const parsed = parsedRaw?.kind === 'player-reference'
    ? playerCacheRef.current.has(parsedRaw.reference.playerId)
      ? {
          kind: 'player' as const,
          player: playerCacheRef.current.get(parsedRaw.reference.playerId)!,
          label: `${playerCacheRef.current.get(parsedRaw.reference.playerId)!.name} · #${parsedRaw.reference.playerId}`,
        }
      : parsedRaw
    : parsedRaw
  const diagnosticRecording = diagnosticUi.phase === 'recording'
  const interactionVisible = cameraState === 'active'
    && ((piecePresent && !resultCameraSuppressed)
      || diagnosticRecording
      || Boolean(resultAcknowledgement))
  const cameraUnavailable = cameraState === 'insecure' || cameraState === 'unavailable'
  const cameraButtonLabel = cameraState === 'active'
    ? 'Stop Camera'
    : cameraState === 'requesting'
      ? 'Starting…'
      : cameraUnavailable
        ? 'Camera unavailable'
        : 'Start Camera'
  const cameraActionRequired = cameraNotice || (
    ['denied', 'unavailable', 'insecure', 'error'].includes(cameraState)
      ? `${copy.title}. ${copy.detail}`
      : ''
  )
  const handleStopCamera = () => {
    stopCamera(true)
    drawOverlay()
    setCameraNotice('')
    setCheckInNotice('')
    setCheckInError(false)
    setCameraState('inactive')
  }

  useLayoutEffect(() => {
    const checkInTransition = checkInTransitions[0]
    if (!checkInTransition || interactionVisible) return
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
  }, [checkInTransitions, displayedGames, interactionVisible])

  useEffect(() => () => {
    transitionCleanupRef.current.forEach((cleanup) => cleanup())
    transitionCleanupRef.current.clear()
  }, [])

  const recentGamesPanel = (
    <section className="recent-games-tab" aria-labelledby="recent-games-heading">
      <div className="section-heading"><div>
        <p className="eyebrow">Completed tables</p>
        <h2 id="recent-games-heading">Recent Games</h2>
      </div></div>
      {recentGames.length === 0
        ? <p className="games-message">No finished games yet.</p>
        : <div className="recent-games-grid" role="region" aria-label="Recent finished games">
            {recentGames.map((game) => (
              <GameCard
                className={` finished-game${game.result === '1/2-1/2' ? ' drawn-game' : ''}`}
                key={gameIdentityKey(game)}
                game={game}
                ariaLabel={`Table ${game.tableNumber}: ${game.result}`}
                onMutate={handleGameMutate}
              />
            ))}
          </div>}
    </section>
  )

  const playerCreator = addPlayerOpen && (
    <ModalDialog className=" add-player-dialog"
      ariaLabel="Add player" initialFocusRef={addPlayerInputRef}
      returnFocusRef={addPlayerReturnFocusRef} onClose={() => setAddPlayerOpen(false)}>
    <section className="producer" aria-labelledby="producer-heading">
      <div className="producer-form">
        <p className="eyebrow">Player QR</p>
        <h2 id="producer-heading">Add New Player</h2>
        <p>Create a local QR identity.</p>
        <label htmlFor="player-name">Player name</label>
        <input id="player-name" ref={addPlayerInputRef} value={name} maxLength={81}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void generatePlayerQr() }} />
        <fieldset className="marker-shape">
          <legend>Print shape</legend>
          {(['square', 'round'] as const).map((shape) => (
            <label key={shape}><input type="radio" name="marker-shape" value={shape}
              checked={preferences.markerShape === shape}
              onChange={() => updatePreferences({ markerShape: shape })} />
              {shape === 'square' ? 'Square' : 'Round sticker'}</label>
          ))}
        </fieldset>
        {producerError && <p className="form-error" role="alert">{producerError}</p>}
        <button type="button" onClick={() => void generatePlayerQr()}>Generate</button>
      </div>
      <div className="qr-card-wrap">
        {player && qrDataUrl ? <>
          <article className={`qr-card marker-${preferences.markerShape}`} aria-label="Generated player QR card">
            <div className="marker-substrate">
              <img src={qrDataUrl} alt={`QR code for ${player.name}, player ${player.playerId}`} />
            </div>
            <h3>{player.name}</h3><p>Player #{player.playerId}</p>
          </article>
          <div className="producer-actions">
            <button type="button" className="secondary" onClick={() => {
              document.body.dataset.printMode = 'card'; window.print()
            }}>Print card</button>
            <button type="button" className="secondary" onClick={() => {
              document.body.dataset.printMode = 'sticker'
              document.body.dataset.markerShape = preferences.markerShape
              window.print()
            }}>Print {preferences.markerShape === 'round' ? '1 inch round sticker' : '1×1 inch sticker'}</button>
          </div>
        </> : <p className="empty-card">Generated card appears here.</p>}
      </div>
    </section>
    </ModalDialog>
  )

  return (
    <main className="shell">
      <h1 className="visually-hidden">Sunset Chess</h1>
      <div
        className="dashboard"
        aria-hidden={interactionVisible || undefined}
        inert={interactionVisible ? true : undefined}
      >
        <section className="main-column" aria-label="Sunset Chess dashboard">
          <header className="brand-header">
            <SunsetChessLogo compact />
            <div><p className="eyebrow">Club play</p><p className="brand-name">Sunset Chess</p></div>
            <div className="header-actions">
              <button
                type="button"
                className="camera-lifecycle-button secondary"
                disabled={cameraState === 'requesting' || cameraUnavailable}
                onClick={cameraState === 'active' ? handleStopCamera : startCamera}
                aria-describedby="camera-state-description"
                title={`${copy.title}. ${copy.detail}`}
              >
                <span className={`status-dot ${cameraState}`} aria-hidden="true" />
                <span>{cameraButtonLabel}</span>
              </button>
              <SettingsMenu
                showDebugTools={preferences.showDebugTools}
                onDebugChange={(showDebugTools) => updatePreferences({ showDebugTools })}
                error={settingsError}
              />
            </div>
          </header>

          <p id="camera-state-description" className="visually-hidden" role="status" aria-live="polite">
            {copy.title}. {copy.detail}
          </p>
          <p className="visually-hidden" aria-live="polite">
            {interactionVisible
              ? 'Piece detected — camera interaction shown'
              : cameraState === 'active' ? 'No piece detected — camera interaction hidden' : ''}
          </p>
          {cameraActionRequired && (
            <p className="camera-action-notice" role="alert">{cameraActionRequired}</p>
          )}
          {preferences.showDebugTools && (
            <aside className="camera-debug-strip" aria-label="Camera debug tools">
              <p className="scanner-diagnostics" aria-label="Scanner diagnostics">
                <span ref={diagnosticsRef}>Measuring camera / decode / paint cadence…</span>
              </p>
              <div className="tracking-diagnostic-controls">
                <button
                  type="button"
                  className="secondary"
                  disabled={cameraState !== 'active' || diagnosticUi.phase === 'recording'}
                  onClick={startTrackingDiagnostic}
                >
                  {diagnosticUi.phase === 'recording'
                    ? `Recording… ${Math.ceil(diagnosticUi.remainingMs / 1000)}s`
                    : 'Record 10s tracking diagnostic'}
                </button>
                <p aria-live="polite" aria-label="Tracking diagnostic status">
                  {diagnosticUi.phase === 'idle'
                    ? 'Explicit click records camera imagery locally for 10 seconds; nothing uploads automatically.'
                    : diagnosticUi.message}
                </p>
                {diagnosticUi.videoUrl && (
                  <a download={`sunset-chess-tracking-${diagnosticUi.id}.webm`} href={diagnosticUi.videoUrl}>
                    Download {diagnosticUi.id}.webm
                  </a>
                )}
                {diagnosticUi.jsonUrl && (
                  <a download={`sunset-chess-tracking-${diagnosticUi.id}.json`} href={diagnosticUi.jsonUrl}>
                    Download {diagnosticUi.id}.json
                  </a>
                )}
              </div>
            </aside>
          )}
          {checkInNotice && (
            <p
              className={`check-in-notice${checkInError ? ' error' : ''}`}
              role={checkInError ? 'alert' : 'status'}
              aria-live="polite"
            >
              {checkInNotice}
            </p>
          )}
          <DashboardTabs
            selected={preferences.selectedTab}
            onSelect={(selectedTab) => updatePreferences({ selectedTab })}
          >{{
            leaderboard: <Leaderboard refreshKey={leaderboardRefresh} variant="rail"
              onAddPlayer={() => {
                addPlayerReturnFocusRef.current = document.activeElement as HTMLElement | null
                setAddPlayerOpen(true)
              }} />,
            'recent-games': recentGamesPanel,
          }}</DashboardTabs>
          {playerCreator}
        </section>

        <aside className="game-column ongoing-column" aria-labelledby="ongoing-games-heading">
          <section className="ongoing-games live-games" aria-busy={gamesLoading}>
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
                    onMutate={handleGameMutate}
                    unavailablePlayerIds={unavailablePlayerIds}
                    authoritativePlayerScan={authoritativePlayerScan}
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
        </aside>

      </div>

      <section
        className={`camera-interaction-layer fullscreen-camera-overlay${interactionVisible ? ' is-visible' : ' is-hidden'}`}
        ref={previewRef}
        aria-hidden={!interactionVisible}
        aria-label={interactionVisible ? 'Full-screen camera interaction' : undefined}
        data-testid="camera-interaction-layer"
        data-coordinate-space="full-viewport"
      >
        <video ref={videoRef} muted playsInline aria-label="Mirrored live camera preview" />
        <canvas ref={overlayRef} aria-hidden="true" />
        {interactionVisible && (
          <>
            <div className="overlay-control-strip">
              <span><i className={`status-dot ${cameraState}`} />{diagnosticRecording ? 'Recording diagnostic' : 'Piece detected'}</span>
              <button type="button" className="secondary" onClick={handleStopCamera}>Stop Camera</button>
            </div>
            {preferences.showDebugTools && <div className="tracking-legend" aria-label="Tracking overlay legend">
              <span><i className="decoded-anchor-key" />Last decoded QR</span>
              <span><i className="tracked-object-key" />Tracked object</span>
            </div>}
          </>
        )}
        {interactionVisible && !resultAcknowledgement && parsed && (
          <div
            className={`payload-label ${parsed.kind}`}
            ref={payloadLabelRef}
            data-qr-animation-source
            aria-hidden="true"
          >
            {parsed.label}
          </div>
        )}
        {interactionVisible && !resultAcknowledgement && gameContext && (
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
              management={false}
            />
            {gameContext.waitingCopy && <p className="game-waiting-header">{gameContext.waitingCopy}</p>}
          </div>
        )}
        {interactionVisible && !resultAcknowledgement && independentLaneContexts.length > 0 && (
          <div className="camera-lane-contexts" role="group" aria-label="Detected player game contexts">
            {independentLaneContexts.flatMap(({ lane, player: detectedPlayer, game }) =>
              game ? [(
                <div className={`camera-lane-game lane-${lane}`} key={`${lane}:${detectedPlayer.playerId}:${game.id}`}>
                  <GameCard
                    game={game}
                    className=" stage-game-card"
                    width="clamp(140px, 28vw, 260px)"
                    height="auto"
                    management={false}
                  />
                </div>
              )] : [])}
          </div>
        )}
        {interactionVisible && !resultAcknowledgement && actionZones.length > 0 && (
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
        {interactionVisible && !resultAcknowledgement && overlayMessage && (
          <p className="action-zone-message" role="status" aria-live="polite">{overlayMessage}</p>
        )}
        {interactionVisible && resultAcknowledgement && (
          <p className="result-acknowledgement" role="status" aria-live="assertive">
            {resultAcknowledgement.includes(' DRAW ')
              ? <>
                  {resultAcknowledgement.split(' DRAW ')[0]}{' '}
                  <span className="result-acknowledgement-draw">DRAW</span>{' '}
                  {resultAcknowledgement.split(' DRAW ')[1]}
                </>
              : resultAcknowledgement}
          </p>
        )}
        {interactionVisible && !resultAcknowledgement && !gameContext?.resultReady && <div className="scan-corners" aria-hidden="true" />}
      </section>
    </main>
  )
}
