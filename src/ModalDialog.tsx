import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

export function ModalDialog({
  title,
  ariaLabel,
  className = '',
  closeLabel = 'Close dialog',
  initialFocusRef,
  returnFocusRef,
  onClose,
  children,
}: {
  title?: ReactNode
  ariaLabel?: string
  className?: string
  closeLabel?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  onClose: () => void | Promise<void>
  children: ReactNode
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const returnTarget = returnFocusRef?.current
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void onCloseRef.current()
    }
    document.addEventListener('keydown', closeOnEscape)
    window.requestAnimationFrame(() => (initialFocusRef?.current ?? dialogRef.current)?.focus())
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      returnTarget?.focus()
    }
  }, [initialFocusRef, returnFocusRef])

  const requestClose = () => {
    void onCloseRef.current()
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}>
      <div className={`modal-dialog${className}`} role="dialog" aria-modal="true"
        aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : ariaLabel}
        tabIndex={-1} ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ))
          const first = focusable[0]
          const last = focusable.at(-1)
          if (!first || !last) {
            event.preventDefault()
            event.currentTarget.focus()
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}>
        <button type="button" className="modal-close" onClick={requestClose} aria-label={closeLabel}>×</button>
        {title && <h2 id={titleId}>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  )
}
