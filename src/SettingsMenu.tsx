import { useEffect, useRef, useState } from 'react'

export function SettingsMenu({
  showDebugTools,
  onDebugChange,
  onCalibrate,
  error,
}: {
  showDebugTools: boolean
  onDebugChange: (value: boolean) => void
  onCalibrate: () => void
  error: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="settings-root" ref={rootRef}>
      <button
        type="button"
        className="settings-trigger secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="settings-menu"
        ref={buttonRef}
        onClick={() => setOpen((value) => !value)}
      >
        Settings
      </button>
      {open && (
        <div id="settings-menu" role="menu" className="settings-menu">
          <label>
            <input
              type="checkbox"
              checked={showDebugTools}
              onChange={(event) => onDebugChange(event.target.checked)}
            />
            Show diagnostics/debug tools
          </label>
          <button type="button" role="menuitem" className="secondary" onClick={() => {
            setOpen(false)
            onCalibrate()
          }}>
            Calibrate camera
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
