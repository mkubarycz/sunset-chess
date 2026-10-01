export const RESULT_AUTHORITY_GRACE_MS = 180

export type ResultAuthoritySource = 'direct' | 'grace' | 'none'

export interface ResultAuthorityState {
  gameKey: string | null
  laneKey: string | null
  assignmentKey: string | null
  playerIdentityKey: string | null
  directAuthorityAt: Record<number, number>
  startedWithDirectAuthority: boolean
}

export interface ResultAuthorityInput {
  now: number
  gameKey: string
  laneKey: string
  assignmentKey: string | null
  holdKey: string | null
  playerIds: readonly number[]
  directPlayerIds: ReadonlySet<number>
  freshGeometryPlayerIds: ReadonlySet<number>
  freshActionAnchorPlayerIds: ReadonlySet<number>
  conflict: boolean
}

export interface ResultAuthorityUpdate {
  state: ResultAuthorityState
  qualified: boolean
  source: ResultAuthoritySource
  graceRemainingMs: number
}

export const emptyResultAuthorityState = (): ResultAuthorityState => ({
  gameKey: null,
  laneKey: null,
  assignmentKey: null,
  playerIdentityKey: null,
  directAuthorityAt: {},
  startedWithDirectAuthority: false,
})

export const emptyResultAuthorityUpdate = (): ResultAuthorityUpdate => ({
  state: emptyResultAuthorityState(),
  qualified: false,
  source: 'none',
  graceRemainingMs: 0,
})

export function updateResultAuthority(
  state: ResultAuthorityState,
  input: ResultAuthorityInput,
): ResultAuthorityUpdate {
  const playerIds = [...new Set(input.playerIds)].sort((a, b) => a - b)
  const playerIdentityKey = playerIds.join(':')
  const hasBothPlayers = playerIds.length === 2
  const contextUnchanged = state.gameKey === input.gameKey
    && state.laneKey === input.laneKey
    && state.playerIdentityKey === playerIdentityKey
  const assignmentUnchanged = contextUnchanged
    && input.assignmentKey !== null
    && state.assignmentKey === input.assignmentKey

  if (input.conflict) {
    return {
      state: emptyResultAuthorityState(),
      qualified: false,
      source: 'none',
      graceRemainingMs: 0,
    }
  }

  const assignmentContextUnchanged = assignmentUnchanged
  const directAuthorityAt = assignmentContextUnchanged
    ? { ...state.directAuthorityAt }
    : {}
  for (const playerId of playerIds) {
    if (input.directPlayerIds.has(playerId)
      && input.freshGeometryPlayerIds.has(playerId)
      && input.freshActionAnchorPlayerIds.has(playerId)) {
      directAuthorityAt[playerId] = input.now
    }
  }
  const bothDirect = hasBothPlayers
    && input.assignmentKey !== null
    && playerIds.every((playerId) =>
      input.directPlayerIds.has(playerId)
      && input.freshGeometryPlayerIds.has(playerId)
      && input.freshActionAnchorPlayerIds.has(playerId))
  const nextState: ResultAuthorityState = {
    gameKey: input.gameKey,
    laneKey: input.laneKey,
    assignmentKey: input.assignmentKey,
    playerIdentityKey,
    directAuthorityAt,
    startedWithDirectAuthority: bothDirect
      || (assignmentContextUnchanged && state.startedWithDirectAuthority),
  }
  if (bothDirect) {
    return {
      state: nextState,
      qualified: true,
      source: 'direct',
      graceRemainingMs: RESULT_AUTHORITY_GRACE_MS,
    }
  }

  const graceAges = playerIds.map((playerId) =>
    input.now - (directAuthorityAt[playerId] ?? Number.NEGATIVE_INFINITY))
  const graceRemainingMs = graceAges.length === 0
    ? 0
    : Math.max(0, RESULT_AUTHORITY_GRACE_MS - Math.max(...graceAges))
  const graceQualified = hasBothPlayers
    && input.holdKey !== null
    && input.holdKey === input.assignmentKey
    && assignmentUnchanged
    && state.startedWithDirectAuthority
    && graceRemainingMs > 0
    && playerIds.every((playerId) =>
      input.freshGeometryPlayerIds.has(playerId)
      && input.freshActionAnchorPlayerIds.has(playerId))

  return {
    state: nextState,
    qualified: graceQualified,
    source: graceQualified ? 'grace' : 'none',
    graceRemainingMs: graceQualified ? graceRemainingMs : 0,
  }
}
