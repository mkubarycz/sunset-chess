import { useRef, useState } from 'react'
import { ModalDialog } from './ModalDialog'
import type { ClubSession } from './SessionCard'

export function SessionHeader({ session, onDelete }: {
  session: ClubSession
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await onDelete()
      setConfirming(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this session.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="session-page-header">
      <div>
        <h2>{session.name}</h2>
        <p>Started <time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleString()}</time>
          {session.closedAt && <> · Closed <time dateTime={session.closedAt}>
            {new Date(session.closedAt).toLocaleString()}
          </time></>}
          {' · '}{session.playerCount} checked in · {session.gameCount} games</p>
        {!session.active && <p>Closed session. Results are read-only; Elo and overall records show current club totals.</p>}
      </div>
      {session.playerCount === 0 && session.gameCount === 0 && (
        <button type="button" className="session-delete-button secondary" ref={triggerRef}
          aria-label="Delete empty session" title="Delete empty session"
          onClick={() => { setError(''); setConfirming(true) }}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
          </svg>
        </button>
      )}
      {confirming && <ModalDialog title="Delete empty session?"
        className=" session-delete-dialog" returnFocusRef={triggerRef} initialFocusRef={cancelRef}
        onClose={() => { if (!busy) setConfirming(false) }}>
        <p>Delete <strong>{session.name}</strong>? This hides the empty session from Club Sessions.
          Its record is retained in the database.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary" ref={cancelRef} disabled={busy}
            onClick={() => setConfirming(false)}>Keep Session</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Deleting Session...' : 'Delete Session'}
          </button>
        </div>
      </ModalDialog>}
    </header>
  )
}
