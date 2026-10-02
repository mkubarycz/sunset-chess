import { useRef, useState, type RefObject } from 'react'
import { ModalDialog } from './ModalDialog'

export interface ClubSession {
  id: number
  type: 'club-session'
  name: string
  createdAt: string
  active: boolean
  closedAt: string | null
  playerCount: number
  gameCount: number
  activeGameCount: number
  pairingMode: 'club-session-pairing-1'
}

export function SessionCard({
  session,
  open,
  onClose,
  returnFocusRef,
  onRename,
  onPairingModeChange,
  onCloseSession,
}: {
  session: ClubSession
  open: boolean
  onClose: () => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onRename: (name: string) => Promise<void>
  onPairingModeChange: (pairingMode: 'club-session-pairing-1') => Promise<void>
  onCloseSession: (resolution: 'draw' | 'cancel') => Promise<void>
}) {
  const [name, setName] = useState(session.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pairingBusy, setPairingBusy] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeError, setCloseError] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    const nextName = name.trim()
    if (!nextName) {
      setName(session.name)
      setError('Session title is required.')
      return
    }
    if (nextName === session.name || busy) return
    setBusy(true)
    setError('')
    try {
      await onRename(nextName)
      setName(nextName)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const closeSession = async (resolution: 'draw' | 'cancel') => {
    setCloseBusy(true)
    setCloseError('')
    try {
      await onCloseSession(resolution)
      onClose()
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCloseBusy(false)
    }
  }

  const updatePairingMode = async (pairingMode: 'club-session-pairing-1') => {
    setPairingBusy(true)
    setError('')
    try {
      await onPairingModeChange(pairingMode)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPairingBusy(false)
    }
  }

  const countLabel = session.activeGameCount === 1
    ? 'one'
    : session.activeGameCount === 2 ? 'two' : String(session.activeGameCount)
  const activeGameWarning = session.activeGameCount === 1
    ? 'There is one active game in the current session.'
    : `There are ${countLabel} active games in the current session.`

  if (!open) return null

  return (
    <ModalDialog
      title={confirmingClose ? 'Close Club Session?' : 'Club Session Settings'}
      className={confirmingClose ? ' session-close-dialog' : ' session-config-dialog'}
      closeLabel={confirmingClose ? 'Keep Club Session open' : 'Close Club Session settings'}
      initialFocusRef={confirmingClose ? undefined : nameInputRef}
      returnFocusRef={returnFocusRef}
      onClose={() => {
        setConfirmingClose(false)
        onClose()
      }}
    >
      {confirmingClose ? (
        <>
          {session.activeGameCount > 0 ? (
            <p>{activeGameWarning} Click Draw or Cancel to proceed with closing these games out.</p>
          ) : (
            <p>There are no active games in the current session. Close this session?</p>
          )}
          {closeError && <p className="form-error" role="alert">{closeError}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary" disabled={closeBusy}
              onClick={() => setConfirmingClose(false)}>
              Keep Session
            </button>
            <button type="button" className="danger" disabled={closeBusy}
              onClick={() => void closeSession('cancel')}>
              {session.activeGameCount > 0 ? 'Cancel Games and Close' : 'Close Session'}
            </button>
            {session.activeGameCount > 0 && (
              <button type="button" disabled={closeBusy}
                onClick={() => void closeSession('draw')}>
                Draw Games and Close
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="session-settings">
          <label htmlFor={`session-${session.id}-name`}>Session title</label>
          <input id={`session-${session.id}-name`} ref={nameInputRef}
            value={name} maxLength={120} disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void save()} />
          <label htmlFor={`session-${session.id}-pairing-mode`}>Pairing mode</label>
          <select id={`session-${session.id}-pairing-mode`}
            value={session.pairingMode} disabled={pairingBusy}
            onChange={(event) =>
              void updatePairingMode(event.target.value as 'club-session-pairing-1')}>
            <option value="club-session-pairing-1">Club Session Pairing 1</option>
          </select>
          <p className="session-settings-summary">
            Started <time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleString()}</time>
            {' · '}{session.playerCount} checked in · {session.gameCount} games
          </p>
          {busy && <p className="session-settings-status" role="status">Saving…</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="button" className="danger session-settings-close"
            onClick={() => {
              setCloseError('')
              setConfirmingClose(true)
            }}>
            Close Session
          </button>
        </div>
      )}
    </ModalDialog>
  )
}
