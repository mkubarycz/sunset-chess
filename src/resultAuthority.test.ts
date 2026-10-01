import { describe, expect, it } from 'vitest'
import {
  emptyResultAuthorityState,
  RESULT_AUTHORITY_GRACE_MS,
  updateResultAuthority,
  type ResultAuthorityInput,
  type ResultAuthorityState,
} from './resultAuthority'

const players = new Set([1000, 1001])
const input = (
  now: number,
  overrides: Partial<ResultAuthorityInput> = {},
): ResultAuthorityInput => ({
  now,
  gameKey: 'game-1',
  laneKey: '1000:left|1001:right',
  assignmentKey: 'winner-left:loser-right',
  holdKey: 'winner-left:loser-right',
  playerIds: [1000, 1001],
  directPlayerIds: players,
  freshGeometryPlayerIds: players,
  freshActionAnchorPlayerIds: players,
  conflict: false,
  ...overrides,
})

const directlyQualified = (now = 0) =>
  updateResultAuthority(emptyResultAuthorityState(), input(now))

describe('result authority grace', () => {
  it('uses direct authority normally and continues an existing hold through a short dip', () => {
    const direct = directlyQualified(100)
    expect(direct).toMatchObject({
      qualified: true,
      source: 'direct',
      graceRemainingMs: RESULT_AUTHORITY_GRACE_MS,
    })

    const grace = updateResultAuthority(direct.state, input(279, {
      directPlayerIds: new Set(),
    }))
    expect(grace).toMatchObject({
      qualified: true,
      source: 'grace',
      graceRemainingMs: 1,
    })
    expect(updateResultAuthority(grace.state, input(280, {
      directPlayerIds: new Set(),
    }))).toMatchObject({
      qualified: false,
      source: 'none',
      graceRemainingMs: 0,
    })
  })

  it('cannot seed a hold or grace a changed assignment', () => {
    const direct = directlyQualified(100)
    expect(updateResultAuthority(direct.state, input(120, {
      directPlayerIds: new Set(),
      holdKey: null,
    })).source).toBe('none')
    expect(updateResultAuthority(direct.state, input(120, {
      directPlayerIds: new Set(),
      assignmentKey: 'draw-left:draw-right',
      holdKey: 'winner-left:loser-right',
    })).source).toBe('none')
  })

  it.each(([
    ['game', { gameKey: 'game-2' }],
    ['lane', { laneKey: '1000:right|1001:left' }],
    ['identity', { playerIds: [1000, 1002] }],
  ] satisfies Array<[string, Partial<ResultAuthorityInput>]>))(
    'does not cross a %s change',
    (_name, changed) => {
      const direct = directlyQualified(100)
      expect(updateResultAuthority(direct.state, input(120, {
        directPlayerIds: new Set(),
        ...changed,
      }))).toMatchObject({ qualified: false, source: 'none' })
    },
  )

  it('requires fresh geometry and action-anchor bounds for both players', () => {
    expect(updateResultAuthority(emptyResultAuthorityState(), input(100, {
      freshGeometryPlayerIds: new Set([1000]),
    })).source).toBe('none')
    expect(updateResultAuthority(emptyResultAuthorityState(), input(100, {
      freshActionAnchorPlayerIds: new Set([1001]),
    })).source).toBe('none')

    const direct = directlyQualified(100)
    expect(updateResultAuthority(direct.state, input(120, {
      directPlayerIds: new Set(),
      freshGeometryPlayerIds: new Set([1000]),
    })).source).toBe('none')
    expect(updateResultAuthority(direct.state, input(120, {
      directPlayerIds: new Set(),
      freshActionAnchorPlayerIds: new Set([1001]),
    })).source).toBe('none')
  })

  it('tracks recent direct authority independently for each player', () => {
    let state: ResultAuthorityState = directlyQualified(0).state
    state = updateResultAuthority(state, input(100, {
      directPlayerIds: new Set([1000]),
    })).state
    const grace = updateResultAuthority(state, input(179, {
      directPlayerIds: new Set([1001]),
    }))
    expect(grace).toMatchObject({ qualified: true, source: 'grace', graceRemainingMs: 101 })
  })

  it('does not start a new assignment from authority remembered for the old assignment', () => {
    const direct = directlyQualified(100)
    const changed = updateResultAuthority(direct.state, input(110, {
      assignmentKey: 'draw-left:draw-right',
      holdKey: 'winner-left:loser-right',
      directPlayerIds: new Set(),
    }))
    const seededButNotDirect = updateResultAuthority(changed.state, input(120, {
      assignmentKey: 'draw-left:draw-right',
      holdKey: 'draw-left:draw-right',
      directPlayerIds: new Set(),
    }))
    expect(seededButNotDirect).toMatchObject({ qualified: false, source: 'none' })
  })

  it('resets all grace authority on a conflict', () => {
    const direct = directlyQualified(100)
    const conflict = updateResultAuthority(direct.state, input(110, {
      assignmentKey: null,
      directPlayerIds: new Set(),
      conflict: true,
    }))
    expect(conflict.state).toEqual(emptyResultAuthorityState())
    expect(updateResultAuthority(conflict.state, input(120, {
      directPlayerIds: new Set(),
    })).source).toBe('none')
  })
})
