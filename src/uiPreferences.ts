export const UI_PREFERENCES_KEY = 'sunset-chess:preferences'
export const UI_PREFERENCES_VERSION = 1

export type DashboardTab = 'leaderboard' | 'recent-games' | 'players'
export type MarkerShape = 'square' | 'round'

export interface UiPreferences {
  version: 1
  showDebugTools: boolean
  selectedTab: DashboardTab
  markerShape: MarkerShape
}

export const defaultUiPreferences = (): UiPreferences => ({
  version: UI_PREFERENCES_VERSION,
  showDebugTools: false,
  selectedTab: 'leaderboard',
  markerShape: 'square',
})

export function parseUiPreferences(raw: string | null): UiPreferences {
  if (raw === null) return defaultUiPreferences()
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Settings are not an object.')
  const value = parsed as Partial<UiPreferences>
  if (value.version !== UI_PREFERENCES_VERSION
    || typeof value.showDebugTools !== 'boolean'
    || !['leaderboard', 'recent-games', 'players'].includes(value.selectedTab ?? '')
    || !['square', 'round'].includes(value.markerShape ?? '')) {
    throw new Error('Settings use an unsupported or invalid format.')
  }
  return value as UiPreferences
}

export function loadUiPreferences(storage: Pick<Storage, 'getItem'> = localStorage): {
  preferences: UiPreferences
  error: string
} {
  try {
    return { preferences: parseUiPreferences(storage.getItem(UI_PREFERENCES_KEY)), error: '' }
  } catch {
    return {
      preferences: defaultUiPreferences(),
      error: 'Saved settings were corrupt and have been reset safely.',
    }
  }
}

export function saveUiPreferences(
  preferences: UiPreferences,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences))
}
