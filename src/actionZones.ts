import type { OngoingGame } from './GameCard'
import type { Point, QrDetection } from './scanner'

export const ACTION_HOLD_MS = 1_500
export const ACTION_ZONE_HORIZONTAL_INSET_RATIO = .11
export const ACTION_ZONE_HORIZONTAL_INSET_MIN_PX = 32
export const ACTION_ZONE_HORIZONTAL_INSET_MAX_PX = 112
export const ACTION_ZONE_MIN_LANE_GAP_PX = 16
export const CHECK_IN_VERTICAL_INSET_RATIO = .08
export const CHECK_IN_VERTICAL_INSET_MIN_PX = 12
export const CHECK_IN_VERTICAL_INSET_MAX_PX = 48
export const RESULT_CARD_HALF_WIDTH_RATIO = .15
export const RESULT_CARD_HALF_WIDTH_MIN_PX = 75
export const RESULT_CARD_HALF_WIDTH_MAX_PX = 140
export const LANE_HYSTERESIS_RATIO = .08
export const REENTRY_DEBOUNCE_MS = 350
export const CHECK_IN_HOLD_RETENTION_MS = 650
export const RESULT_HOLD_RETENTION_MS = 450
export const CHECK_IN_ZONE_HYSTERESIS_RATIO = .2
export const CHECK_IN_ZONE_HYSTERESIS_MIN_PX = 18
export const RESULT_ZONE_HYSTERESIS_RATIO = .08
export const RESULT_ZONE_HYSTERESIS_MIN_PX = 6

export type ResultChoice = 'winner' | 'draw' | 'loser'
export type ActionZoneAction = 'check-in' | ResultChoice
export type ActionZoneLane = 'left' | 'right'
export type ActionZoneStatus = 'idle' | 'active' | 'holding' | 'paused' | 'complete' | 'error' | 'disabled'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlayerDetection {
  playerId: number
  name: string
  detection: QrDetection
}

export interface ActionZone {
  id: string
  action: ActionZoneAction
  lane: ActionZoneLane
  rect: Rect
  label: string
  instructions: string
  occupant: PlayerDetection | null
  status: ActionZoneStatus
  holdDurationMs: number
  progress: number
  accessibility: {
    label: string
    live: 'off' | 'polite' | 'assertive'
  }
  completion: {
    completed: boolean
    resetKey: string
  }
}

export interface HoldState {
  key: string | null
  accumulatedMs: number
  lastUpdatedAt: number | null
  lastQualifiedAt: number | null
  pausedAt: number | null
  completed: boolean
}

export interface HoldUpdate {
  state: HoldState
  progress: number
  completedNow: boolean
  holding: boolean
  paused: boolean
  resetReason: 'none' | 'expired' | 'changed' | 'explicit'
}

export interface CheckInState {
  hold: HoldState
  occupantKey: string | null
  occupant: PlayerDetection | null
  occupantLane: ActionZoneLane | null
}

export interface CheckInUpdate {
  state: CheckInState
  zones: ActionZone[]
  completed: PlayerDetection[]
}

export interface GameContext {
  game: OngoingGame
  anchor: PlayerDetection
  anchorLane: ActionZoneLane
  opponent: PlayerDetection | null
  opponentLane: ActionZoneLane
  waitingCopy: string | null
  resultReady: boolean
  key: string
}

export interface LaneBindingState {
  identityKey: string | null
  lanes: Record<number, ActionZoneLane>
}

export interface LaneBindingUpdate {
  state: LaneBindingState
  changed: boolean
}

export interface ResultAssignment {
  key: string
  result: '1-0' | '0-1' | '1/2-1/2'
  choices: Record<number, ResultChoice>
  selectedZoneIds: string[]
}

export interface ResultChoiceEvaluation {
  status: 'incomplete' | 'conflict' | 'ready'
  assignment: ResultAssignment | null
  choices: Record<number, ResultChoice>
  selectedZoneIds: string[]
}

export interface ReentryLatchState {
  blocked: boolean
  zeroSince: number | null
}

export const emptyHoldState = (): HoldState => ({
  key: null,
  accumulatedMs: 0,
  lastUpdatedAt: null,
  lastQualifiedAt: null,
  pausedAt: null,
  completed: false,
})

export const emptyCheckInState = (): CheckInState => ({
  hold: emptyHoldState(),
  occupantKey: null,
  occupant: null,
  occupantLane: null,
})

export const emptyLaneBindingState = (): LaneBindingState => ({
  identityKey: null,
  lanes: {},
})

export const openReentryLatch = (): ReentryLatchState => ({
  blocked: false,
  zeroSince: null,
})

export const blockReentryLatch = (): ReentryLatchState => ({
  blocked: true,
  zeroSince: null,
})

export function detectionCenter(detection: QrDetection): Point {
  const points = Object.values(detection.location)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height
}

export function expandRect(rect: Rect, ratio: number, minimumPx: number): Rect {
  const xInset = Math.max(minimumPx, rect.width * ratio)
  const yInset = Math.max(minimumPx, rect.height * ratio)
  return {
    x: rect.x - xInset,
    y: rect.y - yInset,
    width: rect.width + xInset * 2,
    height: rect.height + yInset * 2,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function actionZoneHorizontalInset(width: number): number {
  return clamp(
    width * ACTION_ZONE_HORIZONTAL_INSET_RATIO,
    ACTION_ZONE_HORIZONTAL_INSET_MIN_PX,
    ACTION_ZONE_HORIZONTAL_INSET_MAX_PX,
  )
}

export function screenLane(point: Point, width: number): ActionZoneLane {
  return point.x < width / 2 ? 'left' : 'right'
}

export const oppositeLane = (lane: ActionZoneLane): ActionZoneLane =>
  lane === 'left' ? 'right' : 'left'

export function updateLaneBinding(
  state: LaneBindingState,
  players: readonly PlayerDetection[],
  width: number,
  hysteresisPx = width * LANE_HYSTERESIS_RATIO,
): LaneBindingUpdate {
  const unique = [...new Map(players.map((player) => [player.playerId, player])).values()]
  if (unique.length === 0 || unique.length > 2) {
    const next = emptyLaneBindingState()
    return { state: next, changed: state.identityKey !== null }
  }
  const sorted = [...unique].sort((a, b) =>
    detectionCenter(a.detection).x - detectionCenter(b.detection).x)
  const identityKey = sorted.map(({ playerId }) => playerId).sort((a, b) => a - b).join(':')
  if (state.identityKey !== identityKey) {
    const lanes: Record<number, ActionZoneLane> = unique.length === 1
      ? { [unique[0].playerId]: screenLane(detectionCenter(unique[0].detection), width) }
      : { [sorted[0].playerId]: 'left', [sorted[1].playerId]: 'right' }
    return { state: { identityKey, lanes }, changed: true }
  }
  if (unique.length === 1) return { state, changed: false }
  const leftPlayer = unique.find(({ playerId }) => state.lanes[playerId] === 'left')
  const rightPlayer = unique.find(({ playerId }) => state.lanes[playerId] === 'right')
  if (!leftPlayer || !rightPlayer) {
    return {
      state: {
        identityKey,
        lanes: { [sorted[0].playerId]: 'left', [sorted[1].playerId]: 'right' },
      },
      changed: true,
    }
  }
  const leftX = detectionCenter(leftPlayer.detection).x
  const rightX = detectionCenter(rightPlayer.detection).x
  if (leftX <= rightX + hysteresisPx) return { state, changed: false }
  return {
    state: {
      identityKey,
      lanes: {
        [leftPlayer.playerId]: 'right',
        [rightPlayer.playerId]: 'left',
      },
    },
    changed: true,
  }
}

export function updateReentryLatch(
  state: ReentryLatchState,
  qualifyingDetectionCount: number,
  now: number,
  debounceMs = REENTRY_DEBOUNCE_MS,
): ReentryLatchState {
  if (!state.blocked) return state
  if (qualifyingDetectionCount > 0) return { blocked: true, zeroSince: null }
  if (state.zeroSince === null) return { blocked: true, zeroSince: now }
  return now - state.zeroSince >= debounceMs ? openReentryLatch() : state
}

export function updateHold(
  state: HoldState,
  assignmentKey: string | null,
  now: number,
  holdDurationMs = ACTION_HOLD_MS,
  options: {
    qualified?: boolean
    retentionMs?: number
    reset?: boolean
  } = {},
): HoldUpdate {
  const {
    qualified = assignmentKey !== null,
    retentionMs = 0,
    reset = false,
  } = options
  const response = (
    next: HoldState,
    completedNow = false,
    resetReason: HoldUpdate['resetReason'] = 'none',
  ): HoldUpdate => ({
    state: next,
    progress: Math.min(1, Math.max(0, next.accumulatedMs / holdDurationMs)),
    completedNow,
    holding: qualified && next.key !== null,
    paused: !qualified && next.key !== null,
    resetReason,
  })
  if (reset) return response(emptyHoldState(), false, 'explicit')
  if (assignmentKey && state.key && state.key !== assignmentKey) {
    return response({
      key: assignmentKey,
      accumulatedMs: 0,
      lastUpdatedAt: now,
      lastQualifiedAt: qualified ? now : null,
      pausedAt: qualified ? null : now,
      completed: false,
    }, false, 'changed')
  }
  if (!state.key && assignmentKey) {
    return response({
      key: assignmentKey,
      accumulatedMs: 0,
      lastUpdatedAt: now,
      lastQualifiedAt: qualified ? now : null,
      pausedAt: qualified ? null : now,
      completed: false,
    })
  }
  if (!state.key) return response(state)
  const lastQualifiedAt = state.lastQualifiedAt ?? state.lastUpdatedAt ?? now
  if (!qualified) {
    if (now - lastQualifiedAt > retentionMs) {
      return response(emptyHoldState(), false, 'expired')
    }
    return response({
      ...state,
      lastUpdatedAt: now,
      pausedAt: state.pausedAt ?? now,
    })
  }
  if (!assignmentKey || assignmentKey !== state.key) {
    if (now - lastQualifiedAt > retentionMs) {
      return response(emptyHoldState(), false, 'expired')
    }
    return response({
      ...state,
      lastUpdatedAt: now,
      pausedAt: state.pausedAt ?? now,
    })
  }
  const elapsed = state.pausedAt === null && state.lastUpdatedAt !== null
    ? Math.max(0, now - state.lastUpdatedAt)
    : 0
  const accumulatedMs = Math.min(holdDurationMs, state.accumulatedMs + elapsed)
  const completedNow = accumulatedMs >= holdDurationMs && !state.completed
  return response({
    ...state,
    accumulatedMs,
    lastUpdatedAt: now,
    lastQualifiedAt: now,
    pausedAt: null,
    completed: state.completed || completedNow,
  }, completedNow)
}

export function checkInZoneRect(
  width: number,
  height: number,
  lane: ActionZoneLane = 'left',
): Rect {
  const shortestSide = Math.min(width, height)
  const targetInset = actionZoneHorizontalInset(width)
  const minimumSize = Math.min(48, Math.max(0, width / 2 - ACTION_ZONE_MIN_LANE_GAP_PX))
  const inset = Math.max(6, Math.min(
    targetInset,
    (width - minimumSize * 2 - ACTION_ZONE_MIN_LANE_GAP_PX) / 2,
  ))
  const targetVerticalInset = clamp(
    height * CHECK_IN_VERTICAL_INSET_RATIO,
    CHECK_IN_VERTICAL_INSET_MIN_PX,
    CHECK_IN_VERTICAL_INSET_MAX_PX,
  )
  const verticalInset = Math.max(6, Math.min(
    targetVerticalInset,
    height / 2 - 48 - 6,
  ))
  const preferredSize = clamp(shortestSide * .42, 130, 190)
  const horizontalFit = Math.max(0, (width - inset * 2 - ACTION_ZONE_MIN_LANE_GAP_PX) / 2)
  const verticalFit = Math.max(0, height / 2 - verticalInset - 6)
  const size = Math.min(preferredSize, horizontalFit, verticalFit)
  return {
    x: lane === 'left' ? inset : width - inset - size,
    y: verticalInset,
    width: size,
    height: size,
  }
}

function playerKey(player: PlayerDetection): string {
  return `${player.playerId}\u0000${player.name}`
}

export function updateCheckInZones(
  state: CheckInState,
  players: readonly PlayerDetection[],
  width: number,
  height: number,
  now: number,
  options: {
    enabled?: boolean
    blockedPlayerIds?: ReadonlySet<number>
    holdDurationMs?: number
    resetKey?: string
    freshPlayerIds?: ReadonlySet<number>
    transformRect?: (rect: Rect) => Rect
  } = {},
): CheckInUpdate {
  const {
    enabled = true,
    blockedPlayerIds = new Set<number>(),
    holdDurationMs = ACTION_HOLD_MS,
    resetKey = '',
    freshPlayerIds,
    transformRect = (rect) => rect,
  } = options
  if (!enabled) return { state: emptyCheckInState(), zones: [], completed: [] }
  const lanes = ['left', 'right'] as const
  const rects = Object.fromEntries(lanes.map((lane) => [
    lane,
    transformRect(checkInZoneRect(width, height, lane)),
  ])) as Record<ActionZoneLane, Rect>
  const uniqueCandidates = new Map<string, {
    player: PlayerDetection
    lane: ActionZoneLane
    distance: number
  }>()
  for (const player of players) {
    const center = detectionCenter(player.detection)
    const isCurrent = playerKey(player) === state.occupantKey
    const lane = lanes.find((candidate) => pointInRect(
      center,
      isCurrent && state.occupantLane === candidate
        ? expandRect(
            rects[candidate],
            CHECK_IN_ZONE_HYSTERESIS_RATIO,
            CHECK_IN_ZONE_HYSTERESIS_MIN_PX,
          )
        : rects[candidate],
    ))
    if (!lane) continue
    const rect = rects[lane]
    const zoneCenter = {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    }
    const key = playerKey(player)
    const distance = Math.hypot(center.x - zoneCenter.x, center.y - zoneCenter.y)
    const previous = uniqueCandidates.get(key)
    if (!previous || distance < previous.distance) {
      uniqueCandidates.set(key, { player, lane, distance })
    }
  }

  const candidates = [...uniqueCandidates.entries()]
  const current = candidates.find(([key]) => key === state.occupantKey)
  const selected = current ?? candidates.sort(([aKey, a], [bKey, b]) => {
    return a.distance - b.distance
      || a.player.playerId - b.player.playerId
      || aKey.localeCompare(bKey)
  })[0]
  const activeOccupant = selected?.[1].player ?? null
  const activeLane = selected?.[1].lane ?? null
  const activeKey = selected?.[0] ?? null
  const retainedOccupant = activeOccupant ?? state.occupant
  const retainedLane = activeLane ?? state.occupantLane
  const retainedKey = activeKey ?? state.occupantKey
  const blocked = retainedOccupant ? blockedPlayerIds.has(retainedOccupant.playerId) : false
  const fresh = activeOccupant
    ? (freshPlayerIds?.has(activeOccupant.playerId) ?? true)
    : false
  const assignmentKey = retainedOccupant && !blocked
    ? `${resetKey}:${retainedKey}`
    : null
  const hold = updateHold(state.hold, assignmentKey, now, holdDurationMs, {
    qualified: Boolean(activeOccupant && fresh && !blocked),
    retentionMs: CHECK_IN_HOLD_RETENTION_MS,
    reset: blocked,
  })
  const keepRetained = hold.state.key !== null
  const occupant = activeOccupant ?? (keepRetained ? retainedOccupant : null)
  const occupantLane = activeLane ?? (keepRetained ? retainedLane : null)
  const occupantKey = activeKey ?? (keepRetained ? retainedKey : null)
  return {
    state: { hold: hold.state, occupantKey, occupant, occupantLane },
    completed: hold.completedNow && activeOccupant ? [activeOccupant] : [],
    zones: players.length === 0 && !occupant ? [] : lanes.map((lane) => {
      const laneOccupant = occupantLane === lane ? occupant : null
      return {
        id: `check-in-${lane}`,
        action: 'check-in',
        lane,
        rect: rects[lane],
        label: laneOccupant?.name ?? 'Player check-in',
        instructions: laneOccupant
          ? blocked
            ? 'Move QR away, then re-enter to check in'
            : hold.paused ? 'Hold paused — keep the same piece nearby' : 'Hold for 1.5 seconds'
          : 'Place player QR here',
        occupant: laneOccupant,
        status: laneOccupant
          ? blocked
            ? 'complete'
            : hold.paused ? 'paused' : hold.progress > 0 ? 'holding' : 'active'
          : 'idle',
        holdDurationMs,
        progress: laneOccupant ? hold.progress : 0,
        accessibility: {
          label: laneOccupant
            ? `Check-in for ${laneOccupant.name}`
            : `${lane} player check-in target`,
          live: 'polite',
        },
        completion: {
          completed: laneOccupant ? hold.state.completed : false,
          resetKey: assignmentKey ?? `${resetKey}:${blocked ? 'blocked' : 'idle'}`,
        },
      } satisfies ActionZone
    }),
  }
}

export function matchGameContext(
  players: readonly PlayerDetection[],
  games: readonly OngoingGame[],
  width: number,
  laneBindings: Readonly<Record<number, ActionZoneLane>> = {},
): GameContext | null {
  const orderedPlayers = [...players].sort((a, b) => {
    const aLane = laneBindings[a.playerId] ?? screenLane(detectionCenter(a.detection), width)
    const bLane = laneBindings[b.playerId] ?? screenLane(detectionCenter(b.detection), width)
    return aLane === bLane ? a.playerId - b.playerId : aLane === 'left' ? -1 : 1
  })
  for (const anchor of orderedPlayers) {
    const game = games.find((candidate) =>
      candidate.result === null
      && candidate.finishedAt === null
      && (candidate.blackPlayerId === anchor.playerId || candidate.whitePlayerId === anchor.playerId))
    if (!game) continue
    const anchorLane = laneBindings[anchor.playerId]
      ?? screenLane(detectionCenter(anchor.detection), width)
    const opponentId = game.blackPlayerId === anchor.playerId
      ? game.whitePlayerId
      : game.blackPlayerId
    const opponentName = game.blackPlayerId === anchor.playerId
      ? game.whitePlayer?.name
      : game.blackPlayer?.name
    const opponent = opponentId === null
      ? null
      : players.find((candidate) => candidate.playerId === opponentId) ?? null
    const opponentLane = oppositeLane(anchorLane)
    const oppositeAndDistinct = opponent
      ? (laneBindings[opponent.playerId]
        ?? screenLane(detectionCenter(opponent.detection), width)) === opponentLane
      : false
    const fullySeated = game.blackPlayerId !== null && game.whitePlayerId !== null
    return {
      game,
      anchor,
      anchorLane,
      opponent,
      opponentLane,
      waitingCopy: opponent
        ? null
        : fullySeated && opponentName
          ? `Waiting for ${opponentName}`
          : 'Waiting for an opponent',
      resultReady: fullySeated && oppositeAndDistinct,
      key: `${game.id}:${game.createdAt}:${game.blackPlayerId}:${game.whitePlayerId}:${anchor.playerId}:${anchorLane}:${opponent?.playerId ?? 'absent'}`,
    }
  }
  return null
}

export function resultZoneRect(
  lane: ActionZoneLane,
  action: ResultChoice,
  width: number,
  height: number,
): Rect {
  const targetInset = actionZoneHorizontalInset(width)
  const gap = Math.max(6, Math.min(10, height * .02))
  const verticalInset = Math.max(12, Math.min(20, height * .04))
  const availableHeight = Math.max(0, height - verticalInset * 2 - gap * 2)
  const preferredSide = Math.max(48, width * .18)
  const cardHalfWidth = Math.min(
    width / 2,
    clamp(
      width * RESULT_CARD_HALF_WIDTH_RATIO,
      RESULT_CARD_HALF_WIDTH_MIN_PX,
      RESULT_CARD_HALF_WIDTH_MAX_PX,
    ),
  )
  const cardGap = clamp(width * .025, 6, 16)
  const horizontalCapacity = Math.max(0, width / 2 - cardHalfWidth - cardGap - 6)
  const side = Math.max(0, Math.min(
    112,
    preferredSide,
    availableHeight / 3,
    horizontalCapacity,
  ))
  const maximumInset = Math.max(0, width / 2 - cardHalfWidth - cardGap - side)
  const inset = Math.max(0, Math.min(targetInset, maximumInset))
  const stackHeight = side * 3 + gap * 2
  const y = Math.max(verticalInset, (height - stackHeight) / 2)
  const index = (['winner', 'draw', 'loser'] as const).indexOf(action)
  return {
    x: lane === 'left' ? inset : width - inset - side,
    y: y + index * (side + gap),
    width: side,
    height: side,
  }
}

export function createResultZones(
  context: GameContext,
  width: number,
  height: number,
  hold: HoldUpdate,
  evaluation: ResultChoiceEvaluation,
  paused = false,
  transformRect: (rect: Rect) => Rect = (rect) => rect,
): ActionZone[] {
  const lanePlayers: Array<[ActionZoneLane, PlayerDetection]> = [
    [context.anchorLane, context.anchor],
    [context.opponentLane, context.opponent as PlayerDetection],
  ]
  return lanePlayers.flatMap(([lane, player]) =>
    (['winner', 'draw', 'loser'] as const).map((action) => {
      const id = `${action}-${lane}`
      const selected = evaluation.selectedZoneIds.includes(id)
      const conflict = selected && evaluation.status === 'conflict'
      return {
        id,
        action,
        lane,
        rect: transformRect(resultZoneRect(lane, action, width, height)),
        label: action === 'winner' ? 'Win' : action === 'draw' ? 'Draw' : 'Lose',
        instructions: paused && selected
          ? `${player.name}: hold paused`
          : `${player.name}: hold QR here`,
        occupant: selected ? player : null,
        status: paused && selected
          ? 'paused'
          : conflict ? 'error' : selected ? (hold.progress > 0 ? 'holding' : 'active') : 'idle',
        holdDurationMs: ACTION_HOLD_MS,
        progress: selected ? hold.progress : 0,
        accessibility: {
          label: `${player.name}, ${lane} lane, choose ${action}`,
          live: 'polite',
        },
        completion: {
          completed: selected && hold.state.completed,
          resetKey: evaluation.assignment?.key ?? context.key,
        },
      } satisfies ActionZone
    }))
}

export function createDisabledResultZones(
  context: GameContext,
  width: number,
  height: number,
  transformRect: (rect: Rect) => Rect = (rect) => rect,
): ActionZone[] {
  const opponentName = context.game.blackPlayerId === context.anchor.playerId
    ? context.game.whitePlayer?.name
    : context.game.blackPlayer?.name
  const laneNames: Record<ActionZoneLane, string> = {
    left: 'Opponent',
    right: 'Opponent',
  }
  laneNames[context.anchorLane] = context.anchor.name
  laneNames[context.opponentLane] = opponentName ?? 'Opponent'
  return (['left', 'right'] as const).flatMap((lane) =>
    (['winner', 'draw', 'loser'] as const).map((action) => ({
      id: `${action}-${lane}`,
      action,
      lane,
      rect: transformRect(resultZoneRect(lane, action, width, height)),
      label: action === 'winner' ? 'Win' : action === 'draw' ? 'Draw' : 'Lose',
      instructions: `Waiting for both players`,
      occupant: null,
      status: 'disabled',
      holdDurationMs: ACTION_HOLD_MS,
      progress: 0,
      accessibility: {
        label: `${laneNames[lane]}, ${lane} lane, ${action} unavailable until both players are present`,
        live: 'off',
      },
      completion: {
        completed: false,
        resetKey: context.key,
      },
    } satisfies ActionZone)))
}

export function evaluateResultChoices(
  context: GameContext,
  width: number,
  height: number,
  previousAssignment: ResultAssignment | null = null,
  transformRect: (rect: Rect) => Rect = (rect) => rect,
): ResultChoiceEvaluation {
  const incomplete = (): ResultChoiceEvaluation => ({
    status: 'incomplete',
    assignment: null,
    choices: {},
    selectedZoneIds: [],
  })
  if (!context.resultReady || !context.opponent) return incomplete()
  const choices = new Map<number, ResultChoice>()
  const selectedZoneIds: string[] = []
  for (const [lane, player] of [
    [context.anchorLane, context.anchor],
    [context.opponentLane, context.opponent],
  ] as const) {
    const center = detectionCenter(player.detection)
    const previousChoice = previousAssignment?.choices[player.playerId]
    const action = (['winner', 'draw', 'loser'] as const).find((choice) => {
      const rect = transformRect(resultZoneRect(lane, choice, width, height))
      return pointInRect(
        center,
        previousChoice === choice
          ? expandRect(rect, RESULT_ZONE_HYSTERESIS_RATIO, RESULT_ZONE_HYSTERESIS_MIN_PX)
          : rect,
      )
    })
    if (!action) return {
      status: 'incomplete',
      assignment: null,
      choices: Object.fromEntries(choices),
      selectedZoneIds,
    }
    choices.set(player.playerId, action)
    selectedZoneIds.push(`${action}-${lane}`)
  }
  const anchorChoice = choices.get(context.anchor.playerId)
  const opponentChoice = choices.get(context.opponent.playerId)
  const choiceRecord = Object.fromEntries(choices)
  if (!anchorChoice || !opponentChoice) return incomplete()
  const isDraw = anchorChoice === 'draw' && opponentChoice === 'draw'
  const isDecisive = (anchorChoice === 'winner' && opponentChoice === 'loser')
    || (anchorChoice === 'loser' && opponentChoice === 'winner')
  if (!isDraw && !isDecisive) {
    return {
      status: 'conflict',
      assignment: null,
      choices: choiceRecord,
      selectedZoneIds,
    }
  }
  const winnerId = anchorChoice === 'winner'
    ? context.anchor.playerId
    : context.opponent.playerId
  const result: '1-0' | '0-1' | '1/2-1/2' = isDraw
    ? '1/2-1/2'
    : winnerId === context.game.whitePlayerId ? '1-0' : '0-1'
  const assignment: ResultAssignment = {
    key: `${context.key}:${context.anchorLane}:${anchorChoice}:${context.opponentLane}:${opponentChoice}`,
    result,
    choices: choiceRecord,
    selectedZoneIds,
  }
  return { status: 'ready', assignment, choices: choiceRecord, selectedZoneIds }
}
