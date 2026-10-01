import { useEffect, useRef, useState } from 'react'
import {
  calibrationQuality,
  defaultCalibration,
  type CameraCalibration,
} from './calibration'

const steps = ['Frame camera', 'Place marker', 'Align ActionZones'] as const

export function CalibrationDialog({
  calibration,
  videoSize,
  playerMarkerPresent,
  onChange,
  onClose,
}: {
  calibration: CameraCalibration
  videoSize: { width: number; height: number }
  playerMarkerPresent: boolean
  onChange: (value: CameraCalibration) => void
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const quality = calibrationQuality(videoSize, playerMarkerPresent)
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])
  const set = (patch: Partial<CameraCalibration>) => onChange({ ...calibration, ...patch })
  return (
    <div className="calibration-backdrop">
      <div
        className="calibration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      >
        <button type="button" className="profile-close" aria-label="Close calibration" onClick={onClose}>×</button>
        <p className="eyebrow">Camera setup · Step {step + 1} of {steps.length}</p>
        <h2 id="calibration-title">{steps[step]}</h2>
        {step === 0 && (
          <>
            <p>Keep the board and both player lanes inside the dashed usable-area guide.</p>
            <label>Usable-area inset: {calibration.usableInsetPercent}%
              <input type="range" min="0" max="20" value={calibration.usableInsetPercent}
                onChange={(event) => set({ usableInsetPercent: Number(event.target.value) })} />
            </label>
          </>
        )}
        {step === 1 && (
          <p>Hold a representative printed player marker in the guide. Tracking must be observed; this step never claims success from a button click.</p>
        )}
        {step === 2 && (
          <div className="calibration-sliders">
            <label>Horizontal offset: {calibration.zoneOffsetXPercent}%
              <input type="range" min="-20" max="20" value={calibration.zoneOffsetXPercent}
                onChange={(event) => set({ zoneOffsetXPercent: Number(event.target.value) })} />
            </label>
            <label>Vertical offset: {calibration.zoneOffsetYPercent}%
              <input type="range" min="-20" max="20" value={calibration.zoneOffsetYPercent}
                onChange={(event) => set({ zoneOffsetYPercent: Number(event.target.value) })} />
            </label>
            <label>Zone size: {calibration.zoneScalePercent}%
              <input type="range" min="70" max="130" value={calibration.zoneScalePercent}
                onChange={(event) => set({ zoneScalePercent: Number(event.target.value) })} />
            </label>
          </div>
        )}
        <p className={`calibration-quality ${quality.level}`} role="status">{quality.message}</p>
        <div className="calibration-actions">
          <button type="button" className="secondary" onClick={() => onChange(defaultCalibration())}>Reset defaults</button>
          {step > 0 && <button type="button" className="secondary" onClick={() => setStep(step - 1)}>Back</button>}
          {step < steps.length - 1
            ? <button type="button" onClick={() => setStep(step + 1)}>Next</button>
            : <button type="button" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  )
}
