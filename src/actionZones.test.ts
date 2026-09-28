import { describe, expect, it } from 'vitest'
import type { OngoingGame } from './App'
import {
  ACTION_HOLD_MS,
  blockReentryLatch,
  checkInZoneRect,
  createDisabledResultZones,
  createResultZones,
  emptyCheckInState,
  emptyHoldState,
  emptyLaneBindingState,
  evaluateResultChoices,
  matchGameContext,
  resultZoneRect,
  screenLane,
  updateCheckInZones,
  updateHold,
  updateLaneBinding,
  updateReentryLatch,
  type PlayerDetection,
} from './actionZones'

const game = (
  id = 1,
  black: number | null = 1000,
  white: number | null = 1001,
): OngoingGame => ({
  id,
  tableNumber: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  result: null,
  blackPlayerId: black,
  whitePlayerId: white,
  blackPlayer: black === null ? null : { id: black, name: 'Black', rating: 700 },
  whitePlayer: white === null ? null : { id: white, name: 'White', rating: 700 },
})

const player = (playerId: number, x: number, y = 150, name = `P${playerId}`): PlayerDetection => ({
  playerId,
  name,
  detection: {
    data: `${playerId}:${name}`,
    location: {
      topLeftCorner: { x: x - 5, y: y - 5 },
      topRightCorner: { x: x + 5, y: y - 5 },
      bottomRightCorner: { x: x + 5, y: y + 5 },
      bottomLeftCorner: { x: x - 5, y: y + 5 },
    },
  },
})

describe('generic ActionZone holds and lane assignment', () => {
  it('holds for exactly two seconds, completes once, and resets on assignment loss/change', () => {
    let update = updateHold(emptyHoldState(), 'a', 100)
    expect(update.progress).toBe(0)
    update = updateHold(update.state, 'a', 2_099)
    expect(update.completedNow).toBe(false)
    update = updateHold(update.state, 'a', 2_100)
    expect(update.completedNow).toBe(true)
    expect(updateHold(update.state, 'a', 2_500).completedNow).toBe(false)
    expect(updateHold(update.state, null, 2_501).state).toEqual(emptyHoldState())
    expect(updateHold(update.state, 'b', 2_501).progress).toBe(0)
    expect(ACTION_HOLD_MS).toBe(2_000)
  })

  it('accumulates qualified time, pauses a brief gap, and only completes while qualified', () => {
    let update = updateHold(emptyHoldState(), 'a', 0, 2_000, {
      qualified: true, retentionMs: 650,
    })
    update = updateHold(update.state, 'a', 500, 2_000, {
      qualified: true, retentionMs: 650,
    })
    expect(update.progress).toBe(.25)
    update = updateHold(update.state, null, 600, 2_000, {
      qualified: false, retentionMs: 650,
    })
    expect(update).toMatchObject({ progress: .25, paused: true, completedNow: false })
    update = updateHold(update.state, 'a', 1_000, 2_000, {
      qualified: true, retentionMs: 650,
    })
    expect(update.progress).toBe(.25)
    update = updateHold(update.state, 'a', 2_500, 2_000, {
      qualified: true, retentionMs: 650,
    })
    expect(update).toMatchObject({ progress: 1, holding: true, completedNow: true })
  })

  it('expires retained progress and immediately changes identity', () => {
    let update = updateHold(emptyHoldState(), 'a', 0, 2_000, {
      qualified: true, retentionMs: 650,
    })
    update = updateHold(update.state, 'a', 600, 2_000, {
      qualified: true, retentionMs: 650,
    })
    update = updateHold(update.state, null, 1_251, 2_000, {
      qualified: false, retentionMs: 650,
    })
    expect(update.state).toEqual(emptyHoldState())
    expect(update.resetReason).toBe('expired')

    const changed = updateHold(
      updateHold(emptyHoldState(), 'a', 0).state,
      'b',
      100,
      2_000,
      { qualified: true, retentionMs: 650 },
    )
    expect(changed.state.key).toBe('b')
    expect(changed.progress).toBe(0)
    expect(changed.resetReason).toBe('changed')
  })

  it('uses mapped mirrored screen centers to assign lanes', () => {
    expect(screenLane({ x: 199, y: 50 }, 400)).toBe('left')
    expect(screenLane({ x: 200, y: 50 }, 400)).toBe('right')
  })

  it('latches identity to preview lanes through crossing hysteresis and reports true rebinds', () => {
    let binding = updateLaneBinding(
      emptyLaneBindingState(),
      [player(1000, 80), player(1001, 320)],
      400,
    )
    expect(binding.state.lanes).toEqual({ 1000: 'left', 1001: 'right' })
    binding = updateLaneBinding(binding.state, [player(1000, 205), player(1001, 195)], 400)
    expect(binding.changed).toBe(false)
    expect(binding.state.lanes[1000]).toBe('left')
    binding = updateLaneBinding(binding.state, [player(1000, 260), player(1001, 140)], 400)
    expect(binding.changed).toBe(true)
    expect(binding.state.lanes).toEqual({ 1000: 'right', 1001: 'left' })
  })

  it('requires a debounced zero-detection interval before reopening after a result', () => {
    let latch = blockReentryLatch()
    latch = updateReentryLatch(latch, 2, 100)
    expect(latch).toEqual({ blocked: true, zeroSince: null })
    latch = updateReentryLatch(latch, 0, 200)
    expect(updateReentryLatch(latch, 0, 549).blocked).toBe(true)
    expect(updateReentryLatch(latch, 1, 549)).toEqual({ blocked: true, zeroSince: null })
    expect(updateReentryLatch(latch, 0, 550).blocked).toBe(false)
  })
})

describe('check-in ActionZones', () => {
  it('uses an inset upper-left square with bounded responsive dimensions', () => {
    expect(checkInZoneRect(960, 540)).toEqual({
      x: 20, y: 20, width: 190, height: 190,
    })
    expect(checkInZoneRect(320, 480)).toEqual({
      x: 12.8, y: 12.8, width: 134.4, height: 134.4,
    })
    expect(checkInZoneRect(400, 300)).toEqual({
      x: 12, y: 12, width: 130, height: 130,
    })
    expect(checkInZoneRect(400, 300).y + 130).toBeLessThan(300 / 2)
    expect(checkInZoneRect(400, 300, 'right')).toEqual({
      x: 258, y: 12, width: 130, height: 130,
    })
  })

  it('only starts and completes the exact hold for a center inside the square', () => {
    const outside = player(1000, 300, 200)
    let update = updateCheckInZones(emptyCheckInState(), [outside], 400, 300, 100)
    expect(update.zones).toHaveLength(2)
    expect(update.zones[0]).toMatchObject({
      id: 'check-in-left',
      occupant: null,
      status: 'idle',
      progress: 0,
    })
    expect(update.completed).toEqual([])

    const inside = player(1000, 60, 60)
    update = updateCheckInZones(update.state, [outside, inside], 400, 300, 100)
    expect(update.zones[0].occupant?.playerId).toBe(1000)
    update = updateCheckInZones(update.state, [inside], 400, 300, 2_099)
    expect(update.completed).toEqual([])
    update = updateCheckInZones(update.state, [inside], 400, 300, 2_100)
    expect(update.completed.map(({ playerId }) => playerId)).toEqual([1000])
  })

  it('suppresses duplicate identities, resets on exit/generation, and guards re-entry', () => {
    let update = updateCheckInZones(
      emptyCheckInState(),
      [player(1000, 50, 50), player(1000, 80, 80)],
      400,
      300,
      0,
      { resetKey: '1' },
    )
    expect(update.zones).toHaveLength(2)
    expect(update.zones[0].occupant?.playerId).toBe(1000)
    update = updateCheckInZones(update.state, [player(1000, 300, 200)], 400, 300, 1_900, {
      resetKey: '1',
    })

    expect(update.zones[0].occupant).toBeNull()
    expect(update.zones[0].progress).toBe(0)
    expect(updateCheckInZones(update.state, [], 400, 300, 2_000).state)
      .toEqual(emptyCheckInState())
    expect(updateCheckInZones(update.state, [], 400, 300, 2_000).zones).toEqual([])
    const guarded = updateCheckInZones(emptyCheckInState(), [player(1000, 50, 50)], 400, 300, 0, {
      blockedPlayerIds: new Set([1000]),
    })
    expect(guarded.zones[0].status).toBe('complete')
    expect(guarded.zones[0].instructions).toContain('Move QR away')
    expect(guarded.completed).toEqual([])
  })

  it('keeps a coasting player zone mounted while pausing its retained hold', () => {
    const detected = player(1000, 50, 50)
    const started = updateCheckInZones(
      emptyCheckInState(), [detected], 400, 300, 0,
      { freshPlayerIds: new Set([1000]) },
    )
    const paused = updateCheckInZones(
      started.state, [detected], 400, 300, 500,
      { freshPlayerIds: new Set() },
    )
    expect(paused.zones[0]).toMatchObject({
      id: 'check-in-left',
      status: 'paused',
      instructions: 'Hold paused — keep the same piece nearby',
      progress: 0,
    })
    expect(paused.state.hold.key).not.toBeNull()
    expect(paused.state.hold.pausedAt).toBe(500)
    const reacquired = updateCheckInZones(
      paused.state, [detected], 400, 300, 600,
      { freshPlayerIds: new Set([1000]) },
    )
    expect(reacquired.zones[0].id).toBe('check-in-left')
    expect(reacquired.zones[0].progress).toBe(0)
    expect(reacquired.completed).toEqual([])
  })

  it('retains a zone occupant through small boundary jitter then pauses and expires farther out', () => {
    let update = updateCheckInZones(
      emptyCheckInState(), [player(1000, 130, 60)], 400, 300, 0,
      { freshPlayerIds: new Set([1000]) },
    )
    update = updateCheckInZones(
      update.state, [player(1000, 158, 60)], 400, 300, 500,
      { freshPlayerIds: new Set([1000]) },
    )
    expect(update.zones[0]).toMatchObject({
      status: 'holding',
      progress: .25,
      occupant: { playerId: 1000 },
    })
    update = updateCheckInZones(
      update.state, [player(1000, 180, 60)], 400, 300, 600,
      { freshPlayerIds: new Set([1000]) },
    )
    expect(update.zones[0]).toMatchObject({ status: 'paused', progress: .25 })
    update = updateCheckInZones(
      update.state, [player(1000, 180, 60)], 400, 300, 1_151,
      { freshPlayerIds: new Set([1000]) },
    )
    expect(update.zones[0]).toMatchObject({ status: 'idle', progress: 0 })
  })

  it('supports a single fallback detection but cannot create result mode', () => {
    const update = updateCheckInZones(emptyCheckInState(), [player(1002, 50, 50)], 400, 300, 0)
    expect(update.zones[0].occupant?.playerId).toBe(1002)
    expect(matchGameContext([player(1002, 350)], [game(2, 1002, 1003)], 400)?.resultReady)
      .toBe(false)
  })

  it('uses the upper-right zone for a right-lane player while retaining one hold', () => {
    const right = player(1002, 330, 60)
    const update = updateCheckInZones(emptyCheckInState(), [right], 400, 300, 0)
    expect(update.zones.map(({ id }) => id)).toEqual(['check-in-left', 'check-in-right'])
    expect(update.zones[0].occupant).toBeNull()
    expect(update.zones[1].occupant?.playerId).toBe(1002)
    expect(update.zones[1].lane).toBe('right')
  })

  it('keeps the current occupant stable while another code moves nearer', () => {
    let update = updateCheckInZones(
      emptyCheckInState(),
      [player(1001, 55, 55), player(1000, 120, 120)],
      400,
      300,
      0,
    )
    expect(update.zones[0].occupant?.playerId).toBe(1001)
    update = updateCheckInZones(
      update.state,
      [player(1001, 30, 30), player(1000, 75, 75)],
      400,
      300,
      1_000,
    )
    expect(update.zones[0].occupant?.playerId).toBe(1001)
    expect(update.zones[0].progress).toBe(.5)

    update = updateCheckInZones(
      update.state,
      [player(1000, 75, 75)],
      400,
      300,
      1_100,
    )
    expect(update.zones[0].occupant?.playerId).toBe(1000)
    expect(update.zones[0].progress).toBe(0)
  })

  it('does not assign arbitrary lanes when more than two valid codes are present', () => {
    const binding = updateLaneBinding(
      emptyLaneBindingState(),
      [player(1000, 50), player(1001, 200), player(1002, 350)],
      400,
    )
    expect(binding.state).toEqual(emptyLaneBindingState())
    expect(updateCheckInZones(
      emptyCheckInState(),
      [player(1000, 50), player(1001, 200), player(1002, 350)],
      400,
      300,
      0,
      { enabled: false },
    ).zones).toEqual([])
  })
})

describe('game context and per-lane square results', () => {
  it('centers a known game and names the absent seated opponent on the opposite lane', () => {
    const context = matchGameContext([player(1000, 50)], [game()], 400)!
    expect(context.game.id).toBe(1)
    expect(context.anchorLane).toBe('left')
    expect(context.opponentLane).toBe('right')
    expect(context.waitingCopy).toBe('Waiting for White')
    expect(context.resultReady).toBe(false)
    const waiting = matchGameContext([player(1000, 350)], [game(2, 1000, null)], 400)!
    expect(waiting.waitingCopy).toBe('Waiting for an opponent')
    expect(waiting.opponentLane).toBe('left')
    expect(matchGameContext(
      [player(1000, 50), player(1001, 350)],
      [{ ...game(), finishedAt: '2026-01-01T01:00:00.000Z' }],
      400,
    )).toBeNull()
  })

  it('places equal Win/Draw/Lose squares at responsive outer edges', () => {
    for (const [width, height] of [[960, 540], [320, 280], [320, 140]]) {
      const rectangles = (['winner', 'draw', 'loser'] as const)
        .map((choice) => resultZoneRect('left', choice, width, height))
      expect(rectangles.every((rect) => rect.width === rect.height)).toBe(true)
      expect(rectangles[0].x).toBeGreaterThanOrEqual(12)
      expect(rectangles[0].x).toBeLessThanOrEqual(20)
      expect(rectangles[0].y).toBeLessThan(rectangles[1].y)
      expect(rectangles[1].y).toBeLessThan(rectangles[2].y)
      expect(rectangles[2].y + rectangles[2].height).toBeLessThanOrEqual(height)
      const right = resultZoneRect('right', 'draw', width, height)
      expect(width - right.x - right.width).toBeCloseTo(rectangles[0].x)
      const centeredCard = { left: width / 2 - 63, right: width / 2 + 63 }
      expect(rectangles[0].x + rectangles[0].width).toBeLessThan(centeredCard.left)
      expect(right.x).toBeGreaterThan(centeredCard.right)
    }
    expect(resultZoneRect('left', 'winner', 960, 540).width).toBe(112)
    expect(resultZoneRect('left', 'winner', 320, 140).width).toBeCloseTo(34.67, 1)
    const tiny = (['winner', 'draw', 'loser'] as const)
      .map((choice) => resultZoneRect('left', choice, 320, 100))
    expect(tiny[0].width).toBeCloseTo(21.33, 1)
    expect(tiny[2].y + tiny[2].height).toBeLessThanOrEqual(100)
  })

  it('offers Win, Draw, Lose on each lane and maps decisive choices by seat', () => {
    const winnerY = resultZoneRect('left', 'winner', 400, 300).y + 10
    const loserY = resultZoneRect('right', 'loser', 400, 300).y + 10
    const context = matchGameContext([
      player(1000, 50, winnerY),
      player(1001, 350, loserY),
    ], [game()], 400)!
    expect(context.resultReady).toBe(true)
    const evaluation = evaluateResultChoices(context, 400, 300)
    const assignment = evaluation.assignment!
    expect(evaluation.status).toBe('ready')
    expect(assignment.result).toBe('0-1')
    expect(assignment.selectedZoneIds).toEqual(['winner-left', 'loser-right'])
    const zones = createResultZones(
      context,
      400,
      300,
      updateHold(emptyHoldState(), assignment.key, 0),
      evaluation,
    )
    expect(zones.map(({ id }) => id)).toEqual([
      'winner-left', 'draw-left', 'loser-left',
      'winner-right', 'draw-right', 'loser-right',
    ])
    expect(zones.map(({ label }) => label)).toEqual([
      'Win', 'Draw', 'Lose', 'Win', 'Draw', 'Lose',
    ])
    expect(zones[0].rect.y).toBeLessThan(zones[1].rect.y)
    expect(zones[1].rect.y).toBeLessThan(zones[2].rect.y)
    const pausedZones = createResultZones(
      context,
      400,
      300,
      updateHold(emptyHoldState(), null, 500),
      evaluation,
      true,
    )
    expect(pausedZones.filter(({ occupant }) => occupant).every(({ status }) =>
      status === 'paused')).toBe(true)
    expect(pausedZones.filter(({ occupant }) => occupant)[0].instructions)
      .toContain('hold paused')

    const reverse = matchGameContext([
      player(1000, 50, resultZoneRect('left', 'loser', 400, 300).y + 10),
      player(1001, 350, resultZoneRect('right', 'winner', 400, 300).y + 10),
    ], [game()], 400)!
    expect(evaluateResultChoices(reverse, 400, 300).assignment?.result).toBe('1-0')
  })

  it('retains a result choice at its small exit boundary without accepting ambiguity', () => {
    const winner = resultZoneRect('left', 'winner', 400, 300)
    const loser = resultZoneRect('right', 'loser', 400, 300)
    const initial = matchGameContext([
      player(1000, winner.x + winner.width - 2, winner.y + 10),
      player(1001, loser.x + 2, loser.y + 10),
    ], [game()], 400)!
    const assignment = evaluateResultChoices(initial, 400, 300).assignment!
    const jittered = matchGameContext([
      player(1000, winner.x + winner.width + 5, winner.y + 10),
      player(1001, loser.x - 5, loser.y + 10),
    ], [game()], 400)!
    expect(evaluateResultChoices(jittered, 400, 300, assignment).assignment?.key)
      .toBe(assignment.key)

    const conflict = matchGameContext([
      player(1000, resultZoneRect('left', 'winner', 400, 300).x + 10, winner.y + 10),
      player(1001, resultZoneRect('right', 'winner', 400, 300).x + 10, winner.y + 10),
    ], [game()], 400)!
    expect(evaluateResultChoices(conflict, 400, 300, assignment).status).toBe('conflict')
  })

  it('pauses result progress without authority, resumes, and resets a conflicting choice', () => {
    let hold = updateHold(emptyHoldState(), 'win-lose', 0, 2_000, {
      qualified: true, retentionMs: 450,
    })
    hold = updateHold(hold.state, 'win-lose', 900, 2_000, {
      qualified: true, retentionMs: 450,
    })
    hold = updateHold(hold.state, 'win-lose', 1_000, 2_000, {
      qualified: false, retentionMs: 450,
    })
    expect(hold).toMatchObject({ progress: .45, paused: true, completedNow: false })
    hold = updateHold(hold.state, 'win-lose', 1_300, 2_000, {
      qualified: true, retentionMs: 450,
    })
    expect(hold.progress).toBe(.45)
    hold = updateHold(hold.state, 'win-lose', 2_400, 2_000, {
      qualified: true, retentionMs: 450,
    })
    expect(hold.completedNow).toBe(true)
    const conflict = updateHold(hold.state, null, 2_401, 2_000, {
      qualified: false, retentionMs: 450, reset: true,
    })
    expect(conflict.state).toEqual(emptyHoldState())
  })

  it('builds disabled result choices for both lanes while an opponent is absent', () => {
    const context = matchGameContext([player(1000, 50)], [game()], 400)!
    const zones = createDisabledResultZones(context, 400, 300)
    expect(zones).toHaveLength(6)
    expect(zones.every(({ status, occupant }) => status === 'disabled' && occupant === null))
      .toBe(true)
    expect(zones.map(({ id }) => id)).toEqual([
      'winner-left', 'draw-left', 'loser-left',
      'winner-right', 'draw-right', 'loser-right',
    ])
    expect(zones[3].accessibility.label).toContain('White')
  })

  it('maps Draw + Draw and rejects every other non-decisive pair', () => {
    const evaluate = (left: 'winner' | 'draw' | 'loser', right: 'winner' | 'draw' | 'loser') => {
      const context = matchGameContext([
        player(1000, 50, resultZoneRect('left', left, 400, 300).y + 10),
        player(1001, 350, resultZoneRect('right', right, 400, 300).y + 10),
      ], [game()], 400)!
      return { context, evaluation: evaluateResultChoices(context, 400, 300) }
    }
    expect(evaluate('draw', 'draw').evaluation.assignment?.result).toBe('1/2-1/2')
    for (const choices of [
      ['winner', 'winner'], ['loser', 'loser'],
      ['draw', 'winner'], ['winner', 'draw'],
      ['draw', 'loser'], ['loser', 'draw'],
    ] as const) {
      const { context, evaluation } = evaluate(choices[0], choices[1])
      expect(evaluation.status).toBe('conflict')
      expect(evaluation.assignment).toBeNull()
      expect(createResultZones(
        context, 400, 300, updateHold(emptyHoldState(), null, 0), evaluation,
      ).filter(({ status }) => status === 'error')).toHaveLength(2)
    }
  })

  it('uses one shared exact timer and mirrors its progress into both engaged zones', () => {
    const winnerY = resultZoneRect('left', 'winner', 400, 300).y + 10
    const loserY = resultZoneRect('right', 'loser', 400, 300).y + 10
    const context = matchGameContext([
      player(1000, 50, winnerY), player(1001, 350, loserY),
    ], [game()], 400)!
    const evaluation = evaluateResultChoices(context, 400, 300)
    let hold = updateHold(emptyHoldState(), evaluation.assignment!.key, 100)
    hold = updateHold(hold.state, evaluation.assignment!.key, 1_100)
    const engaged = createResultZones(context, 400, 300, hold, evaluation)
      .filter(({ occupant }) => occupant)
    expect(engaged).toHaveLength(2)
    expect(engaged.map(({ progress }) => progress)).toEqual([.5, .5])
    expect(updateHold(hold.state, evaluation.assignment!.key, 2_100).completedNow).toBe(true)
  })

  it('resets the pair hold on coasting/loss, game, lane, or choice changes', () => {
    const first = updateHold(emptyHoldState(), 'game-1:left-winner:right-loser', 0)
    expect(updateHold(first.state, null, 1_999).state).toEqual(emptyHoldState())
    expect(updateHold(first.state, 'game-2:left-winner:right-loser', 1_999).progress).toBe(0)
    expect(updateHold(first.state, 'game-1:right-winner:left-loser', 1_999).progress).toBe(0)
    expect(updateHold(first.state, 'game-1:left-loser:right-winner', 1_999).progress).toBe(0)
  })
})
