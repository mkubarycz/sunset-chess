export const PRESENCE_HIDE_DELAY_MS = 650

export interface PresenceHysteresisState {
  visible: boolean
  missingSince: number | null
  lastSeenAt: number | null
}

export const emptyPresenceState = (): PresenceHysteresisState => ({
  visible: false,
  missingSince: null,
  lastSeenAt: null,
})

export function updatePresenceHysteresis(
  state: PresenceHysteresisState,
  detected: boolean,
  now: number,
  hideDelayMs = PRESENCE_HIDE_DELAY_MS,
): { state: PresenceHysteresisState; removed: boolean } {
  if (detected) return {
    state: { visible: true, missingSince: null, lastSeenAt: now },
    removed: false,
  }
  if (!state.visible) return { state: emptyPresenceState(), removed: false }
  if (state.missingSince === null) {
    const missingSince = state.lastSeenAt ?? now
    if (now - missingSince >= hideDelayMs) {
      return { state: emptyPresenceState(), removed: true }
    }
    return { state: { ...state, missingSince }, removed: false }
  }
  if (now - state.missingSince < hideDelayMs) return { state, removed: false }
  return { state: emptyPresenceState(), removed: true }
}
