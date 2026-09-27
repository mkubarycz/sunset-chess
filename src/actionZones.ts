import type { OngoingGame } from './GameCard'
import type { Point, QrDetection } from './scanner'

export const ACTION_HOLD_MS = 2_000
export const LANE_HYSTERESIS_RATIO = .08
export const REENTRY_DEBOUNCE_MS = 350

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
  startedAt: number | null
  completed: boolean
}

export interface HoldUpdate {
  state: HoldState
  progress: number
  completedNow: boolean
}

export interface CheckInState {
  hold: HoldState
  occupantKey: string | null
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
  startedAt: null,
  completed: false,
})

export const emptyCheckInState = (): CheckInState => ({
  hold: emptyHoldState(),
  occupantKey: null,
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
): HoldUpdate {
  if (!assignmentKey) {
    return { state: emptyHoldState(), progress: 0, completedNow: false }
  }
  if (state.key !== assignmentKey || state.startedAt === null) {
    return {
      state: { key: assignmentKey, startedAt: now, completed: false },
      progress: 0,
      completedNow: false,
    }
  }
  const progress = Math.min(1, Math.max(0, (now - state.startedAt) / holdDurationMs))
  const completedNow = progress >= 1 && !state.completed
  return {
    state: { ...state, completed: state.completed || completedNow },
    progress,
    completedNow,
  }
}

export function checkInZoneRect(
  width: number,
  height: number,
  lane: ActionZoneLane = 'left',
): Rect {
  const shortestSide = Math.min(width, height)
  const inset = Math.min(20, Math.max(12, shortestSide * .04))
  const size = Math.min(190, Math.max(130, shortestSide * .42))
  return {
    x: lane === 'left' ? inset : width - inset - size,
    y: inset,
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
  } = {},
): CheckInUpdate {
  const {
    enabled = true,
    blockedPlayerIds = new Set<number>(),
    holdDurationMs = ACTION_HOLD_MS,
    resetKey = '',
    freshPlayerIds,
  } = options
  if (!enabled) return { state: emptyCheckInState(), zones: [], completed: [] }

  if (players.length === 0) {
    return { state: emptyCheckInState(), zones: [], completed: [] }
  }
  const lanes = ['left', 'right'] as const
  const rects = Object.fromEntries(lanes.map((lane) => [
    lane,
    checkInZoneRect(width, height, lane),
  ])) as Record<ActionZoneLane, Rect>
  const uniqueCandidates = new Map<string, {
    player: PlayerDetection
    lane: ActionZoneLane
    distance: number
  }>()
  for (const player of players) {
    const center = detectionCenter(player.detection)
    const lane = lanes.find((candidate) => pointInRect(center, rects[candidate]))
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
  const occupant = selected?.[1].player ?? null
  const occupantLane = selected?.[1].lane ?? null
  const occupantKey = selected?.[0] ?? null
  const blocked = occupant ? blockedPlayerIds.has(occupant.playerId) : false
  const fresh = occupant
    ? (freshPlayerIds?.has(occupant.playerId) ?? true)
    : false
  const assignmentKey = occupant && !blocked && fresh
    ? `${resetKey}:${occupantKey}`
    : null
  const hold = updateHold(state.hold, assignmentKey, now, holdDurationMs)
  return {
    state: { hold: hold.state, occupantKey },
    completed: hold.completedNow && occupant ? [occupant] : [],
    zones: lanes.map((lane) => {
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
            : fresh ? 'Hold steady for 2 seconds' : 'Hold paused'
          : 'Place player QR here',
        occupant: laneOccupant,
        status: laneOccupant
          ? blocked
            ? 'complete'
            : !fresh ? 'paused' : hold.progress > 0 ? 'holding' : 'active'
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
  const inset = Math.max(12, Math.min(20, width * .025))
  const gap = Math.max(6, Math.min(10, height * .02))
  const availableHeight = Math.max(0, height - inset * 2 - gap * 2)
  const preferredSide = Math.max(48, width * .18)
  const side = Math.max(0, Math.min(112, preferredSide, availableHeight / 3))
  const stackHeight = side * 3 + gap * 2
  const y = Math.max(inset, (height - stackHeight) / 2)
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
        rect: resultZoneRect(lane, action, width, height),
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
      rect: resultZoneRect(lane, action, width, height),
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
    const action = (['winner', 'draw', 'loser'] as const).find((choice) =>
      pointInRect(center, resultZoneRect(lane, choice, width, height)))
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
