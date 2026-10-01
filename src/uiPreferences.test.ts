import { describe, expect, it } from 'vitest'
import {
  defaultUiPreferences,
  loadUiPreferences,
  parseUiPreferences,
} from './uiPreferences'

describe('versioned UI preferences', () => {
  it('defaults diagnostics off and recovers visibly from corrupt storage', () => {
    expect(defaultUiPreferences().showDebugTools).toBe(false)
    const loaded = loadUiPreferences({ getItem: () => '{bad json' })
    expect(loaded.preferences).toEqual(defaultUiPreferences())
    expect(loaded.error).toMatch(/corrupt/)
  })

  it('validates tabs and marker shapes instead of silently accepting unknown settings', () => {
    expect(() => parseUiPreferences(JSON.stringify({
      ...defaultUiPreferences(), selectedTab: 'unknown',
    }))).toThrow()
  })

  it('loads valid 1.0 preferences while ignoring obsolete extra fields', () => {
    expect(parseUiPreferences(JSON.stringify({
      ...defaultUiPreferences(),
      cameraSetup: { insetPercent: 12 },
      legacyOffsetPercent: 5,
    }))).toEqual(defaultUiPreferences())
  })
})
