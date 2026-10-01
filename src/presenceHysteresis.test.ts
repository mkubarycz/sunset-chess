import { describe, expect, it } from 'vitest'
import {
  emptyPresenceState,
  PRESENCE_HIDE_DELAY_MS,
  updatePresenceHysteresis,
} from './presenceHysteresis'

describe('piece-presence hysteresis', () => {
  it('appears immediately, survives a 649ms gap, and cancels pending hide on reacquisition', () => {
    let update = updatePresenceHysteresis(emptyPresenceState(), true, 0)
    expect(update.state.visible).toBe(true)
    update = updatePresenceHysteresis(update.state, false, 10)
    update = updatePresenceHysteresis(update.state, false, PRESENCE_HIDE_DELAY_MS - 1)
    expect(update.state.visible).toBe(true)
    update = updatePresenceHysteresis(update.state, true, 700)
    expect(update.state).toEqual({ visible: true, missingSince: null, lastSeenAt: 700 })
  })

  it('reports true removal after 650ms so callers clear stale ActionZone state', () => {
    let update = updatePresenceHysteresis({
      visible: true, missingSince: null, lastSeenAt: 100,
    }, false, 100)
    update = updatePresenceHysteresis(update.state, false, 750)
    expect(update).toEqual({ state: emptyPresenceState(), removed: true })
  })
})
