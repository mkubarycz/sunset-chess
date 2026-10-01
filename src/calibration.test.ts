import { describe, expect, it } from 'vitest'
import {
  calibratedRect,
  defaultCalibration,
  parseCalibration,
} from './calibration'

describe('camera calibration geometry', () => {
  it('applies offsets and scaling while clamping every ActionZone to the usable preview', () => {
    expect(calibratedRect(
      { x: 850, y: 560, width: 180, height: 180 },
      { width: 1000, height: 650 },
      {
        version: 1,
        usableInsetPercent: 10,
        zoneOffsetXPercent: 20,
        zoneOffsetYPercent: 20,
        zoneScalePercent: 130,
      },
    )).toEqual({ x: 701, y: 351, width: 234, height: 234 })
  })

  it('round-trips versioned settings and rejects out-of-range calibration', () => {
    expect(parseCalibration(JSON.stringify(defaultCalibration()))).toEqual(defaultCalibration())
    expect(() => parseCalibration(JSON.stringify({
      ...defaultCalibration(), zoneScalePercent: 200,
    }))).toThrow('Invalid camera calibration')
  })
})
