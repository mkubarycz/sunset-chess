import type { CSSProperties, Ref } from 'react'
import type { ActionZone } from './actionZones'

export function ActionZoneView({
  zone,
  zoneRef,
  progressRef,
}: {
  zone: ActionZone
  zoneRef?: Ref<HTMLDivElement>
  progressRef?: Ref<HTMLDivElement>
}) {
  const style = {
    '--zone-x': `${zone.rect.x}px`,
    '--zone-y': `${zone.rect.y}px`,
    '--zone-width': `${zone.rect.width}px`,
    '--zone-height': `${zone.rect.height}px`,
  } as CSSProperties
  const compactResult = zone.action !== 'check-in'
    && Math.min(zone.rect.width, zone.rect.height) < 96
  return (
    <div
      className={`action-zone action-${zone.action} lane-${zone.lane} status-${zone.status}${compactResult ? ' result-zone-compact' : ''}`}
      data-action-zone-id={zone.id}
      data-action={zone.action}
      data-lane={zone.lane}
      style={style}
      ref={zoneRef}
      role="group"
      aria-label={zone.accessibility.label}
      aria-disabled={zone.status === 'disabled' || undefined}
      aria-live={zone.accessibility.live}
    >
      <strong>{zone.label}</strong>
      <span aria-hidden={compactResult || undefined}>{zone.instructions}</span>
      <div className="action-zone-hold-track">
        <div
          className="action-zone-hold-progress"
          role="progressbar"
          aria-label={`${zone.label} hold progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(zone.progress * 100)}
          ref={progressRef}
        />
      </div>
    </div>
  )
}
