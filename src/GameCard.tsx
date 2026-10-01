import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LeaderboardEntry } from './PlayerCardDialog'

export interface OngoingGame {
  id: number
  tableNumber: number
  createdAt: string
  blackPlayerId: number | null
  whitePlayerId: number | null
  finishedAt: string | null
  result: '1-0' | '0-1' | '1/2-1/2' | null
  cancelledAt?: string | null
  cancellationReason?: string | null
  blackRatingDelta?: number | null
  whiteRatingDelta?: number | null
  blackPlayer: { id: number; name: string; rating: number } | null
  whitePlayer: { id: number; name: string; rating: number } | null
}

const backRank = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'] as const
const pieceSymbols = {
  black: ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
  white: ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'],
} as const

function MiniBoard() {
  return (
    <div className="mini-board" aria-label="Two-rank chess board">
      {(['black', 'white'] as const).map((side) => (
        <div className={`mini-rank ${side}-rank`} key={side}>
          {pieceSymbols[side].map((piece, index) => (
            <span
              className="mini-square"
              aria-label={`${side} ${backRank[index]}`}
              key={`${side}-${backRank[index]}-${index}`}
            >
              {piece}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function PlayerSide({
  side,
  player,
  result,
  ratingDelta,
  cancelled,
  onEdit,
  tableNumber,
}: {
  side: 'black' | 'white'
  player: OngoingGame['blackPlayer']
  result: OngoingGame['result']
  ratingDelta?: number | null
  cancelled: boolean
  onEdit?: () => void
  tableNumber?: number
}) {
  const isWinner = (side === 'black' && result === '0-1') || (side === 'white' && result === '1-0')
  const isDraw = result === '1/2-1/2'
  const label = side === 'black' ? 'Black' : 'White'
  return (
    <div
      className={`player-side table-player-side ${side}-side${isWinner ? ' winner' : ''}${isDraw ? ' draw' : ''}`}
      aria-label={player ? `${label} player: ${player.name}, rating ${player.rating}` : `Waiting for ${label}`}
    >
      <strong>{player?.name ?? `Waiting for ${label}`}</strong>
      {player && <span className="player-rating">{player.rating} Elo</span>}
      {player && result && !cancelled && ratingDelta != null && (
        <span className={`rating-delta ${ratingDelta > 0 ? 'positive' : ratingDelta < 0 ? 'negative' : 'neutral'}`}>
          {ratingDelta > 0 ? '+' : ''}{ratingDelta}
        </span>
      )}
      {!result && onEdit && (
        <button type="button" className="seat-edit-button" onClick={onEdit}
          aria-label={`${player ? 'Edit' : 'Assign'} ${label} player${tableNumber ? ` on Table ${tableNumber}` : ''}`}>
          {player ? '✎' : '＋'}
        </button>
      )}
    </div>
  )
}

export function GameCard({
  game,
  className = '',
  cardRef,
  ariaLabel,
  width,
  height,
  onMutate,
  management = true,
  unavailablePlayerIds = [],
}: {
  game: OngoingGame
  className?: string
  cardRef?: (element: HTMLElement | null) => void
  ariaLabel?: string
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  onMutate?: (game: OngoingGame) => void | Promise<void>
  management?: boolean
  unavailablePlayerIds?: readonly number[]
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'cancel' | 'black' | 'white' | null>(null)
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [replacement, setReplacement] = useState('')
  const [replacementQuery, setReplacementQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeOption, setActiveOption] = useState(-1)
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [playersError, setPlayersError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pickerId = useId()
  const listboxId = `replacement-listbox-${pickerId}`
  const menuRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelled = Boolean(game.cancelledAt)
  const closeDialog = () => {
    if (typeof dialogRef.current?.close === 'function') dialogRef.current.close()
    else dialogRef.current?.removeAttribute('open')
    setDialog(null)
    gearRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); gearRef.current?.focus() }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!dialog) return
    const element = dialogRef.current
    if (typeof element?.showModal === 'function') element.showModal()
    else element?.setAttribute('open', '')
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
      }
    }
    document.addEventListener('keydown', escape)
    if (dialog !== 'cancel') {
      const controller = new AbortController()
      void fetch('/api/players', { signal: controller.signal, headers: { accept: 'application/json' } })
        .then(async (response) => {
          const body = await response.json() as { players?: LeaderboardEntry[]; error?: string }
          if (!response.ok || !body.players) throw new Error(body.error || 'Could not load players.')
          setPlayers(body.players)
          setPlayersError('')
        })
        .catch((cause: unknown) => {
          if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
            setPlayersError(cause instanceof Error ? cause.message : String(cause))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingPlayers(false)
        })
      return () => {
        controller.abort()
        document.removeEventListener('keydown', escape)
      }
    }
    return () => document.removeEventListener('keydown', escape)
  }, [dialog])

  const openDialog = (next: 'cancel' | 'black' | 'white') => {
    setError('')
    setReplacement('')
    setReplacementQuery('')
    setPickerOpen(false)
    setActiveOption(-1)
    setPlayers([])
    setPlayersError('')
    setLoadingPlayers(next !== 'cancel')
    setDialog(next)
  }
  const mutate = async (url: string, init: RequestInit) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(url, init)
      const body = await response.json() as { game?: OngoingGame; error?: string }
      if (!response.ok || !body.game) throw new Error(body.error || `Request failed (${response.status}).`)
      await onMutate?.(body.game)
      closeDialog()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const editSide = (side: 'black' | 'white') => {
    setMenuOpen(false)
    openDialog(side)
  }
  const opponent = dialog === 'black' ? game.whitePlayerId : game.blackPlayerId
  const current = dialog === 'black' ? game.blackPlayerId : game.whitePlayerId
  const assigning = current === null
  const unavailablePlayers = new Set(unavailablePlayerIds)
  const eligiblePlayers = players.filter((candidate) =>
    candidate.id !== opponent && candidate.id !== current && !unavailablePlayers.has(candidate.id))
  const normalizedQuery = replacementQuery.trim().toLocaleLowerCase()
  const filteredPlayers = eligiblePlayers.filter((candidate) =>
    !normalizedQuery || candidate.name.toLocaleLowerCase().includes(normalizedQuery))
  const optionId = (candidate: LeaderboardEntry) => `${listboxId}-option-${candidate.id}`
  const selectReplacement = (candidate: LeaderboardEntry) => {
    setReplacement(String(candidate.id))
    setReplacementQuery(`${candidate.name} (${candidate.currentRating} Elo)`)
    setPickerOpen(false)
    setActiveOption(-1)
  }
  const openPicker = () => {
    setPickerOpen(true)
    setActiveOption((index) => filteredPlayers.length === 0 ? -1 : Math.min(Math.max(index, 0), filteredPlayers.length - 1))
  }
  const handlePickerKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && pickerOpen) {
      event.preventDefault()
      event.stopPropagation()
      setPickerOpen(false)
      setActiveOption(-1)
      return
    }
    if (event.key === 'Tab') {
      setPickerOpen(false)
      setActiveOption(-1)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return
    if (event.key === 'Enter') {
      if (pickerOpen && activeOption >= 0 && filteredPlayers[activeOption]) {
        event.preventDefault()
        selectReplacement(filteredPlayers[activeOption])
      }
      return
    }
    event.preventDefault()
    if (!pickerOpen) setPickerOpen(true)
    if (filteredPlayers.length === 0) {
      setActiveOption(-1)
    } else if (event.key === 'Home') {
      setActiveOption(0)
    } else if (event.key === 'End') {
      setActiveOption(filteredPlayers.length - 1)
    } else if (event.key === 'ArrowDown') {
      setActiveOption((index) => index < 0 ? 0 : Math.min(index + 1, filteredPlayers.length - 1))
    } else {
      setActiveOption((index) => index < 0 ? filteredPlayers.length - 1 : Math.max(index - 1, 0))
    }
  }

  useEffect(() => {
    const candidate = filteredPlayers[activeOption]
    if (!pickerOpen || activeOption < 0 || !candidate) return
    document.getElementById(`${listboxId}-option-${candidate.id}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOption, pickerOpen, filteredPlayers, listboxId])

  return (
    <article
      className={`game-card${className}`}
      data-game-id={game.id}
      data-game-created-at={game.createdAt}
      ref={cardRef}
      style={{ width, height }}
      aria-label={ariaLabel ?? `Table ${game.tableNumber}: ${
        game.blackPlayer ? `${game.blackPlayer.name} plays black` : 'waiting for Black'
      }, ${game.whitePlayer ? `${game.whitePlayer.name} plays white` : 'waiting for White'}`}
    >
      <div className="game-card-header">
        <h3>Table {game.tableNumber}</h3>
        {management && !cancelled && <div className="game-card-menu" ref={menuRef}>
          <button type="button" className="game-card-gear" aria-label={`Manage Table ${game.tableNumber}`}
            aria-haspopup="menu" aria-expanded={menuOpen} ref={gearRef}
            onClick={() => setMenuOpen((open) => !open)}>⚙</button>
          {menuOpen && <div role="menu" className="game-card-menu-popover">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); openDialog('cancel') }}>
              Cancel game
            </button>
          </div>}
        </div>}
      </div>
      {cancelled && <p className="cancelled-status">Cancelled</p>}
      {game.result && (
        <p className={`game-result${cancelled ? ' cancelled-result' : ''}`}>
          {game.result === '1/2-1/2' ? 'Draw' : game.result === '1-0' ? 'White wins' : 'Black wins'}
          <span>{game.result}</span>
        </p>
      )}
      <PlayerSide side="black" player={game.blackPlayer} result={game.result}
        ratingDelta={game.blackRatingDelta} cancelled={cancelled}
        tableNumber={game.tableNumber}
        onEdit={management && !cancelled && !game.result ? () => editSide('black') : undefined} />
      <MiniBoard />
      <PlayerSide side="white" player={game.whitePlayer} result={game.result}
        ratingDelta={game.whiteRatingDelta} cancelled={cancelled}
        tableNumber={game.tableNumber}
        onEdit={management && !cancelled && !game.result ? () => editSide('white') : undefined} />
      {cancelled && game.cancelledAt && (
        <p className="cancelled-at">Cancelled {new Date(game.cancelledAt).toLocaleString()}</p>
      )}
      <dialog ref={dialogRef}
        className={`game-management-dialog${dialog && dialog !== 'cancel' ? ' seat-management-dialog' : ''}`}
        aria-labelledby={`game-dialog-title-${game.id}`}
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === dialogRef.current) closeDialog() }}>
        {dialog === 'cancel' ? <>
          <h2 id={`game-dialog-title-${game.id}`}>Cancel Table {game.tableNumber}?</h2>
          <p>{game.result
            ? 'Cancellation is allowed only if this is both players’ latest game. Elo changes will be reversed with auditable compensation events; otherwise an administrator-contact error will explain the block.'
            : 'This removes the game from ongoing play and frees its occupied seats. No Elo event will be created.'}</p>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={closeDialog}>Keep game</button>
            <button type="button" disabled={busy} onClick={() => void mutate(`/api/games/${game.id}`, {
              method: 'DELETE', headers: { accept: 'application/json' },
            })}>{busy ? 'Cancelling…' : 'Cancel game'}</button>
          </div>
        </> : dialog ? <>
          <h2 id={`game-dialog-title-${game.id}`}>
            {assigning ? 'Assign' : 'Edit'} {dialog === 'black' ? 'Black' : 'White'} player
          </h2>
          <label htmlFor={`seat-player-${game.id}`}>Replacement player</label>
          <div className="replacement-combobox">
            <input
              id={`seat-player-${game.id}`}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={pickerOpen}
              aria-controls={listboxId}
              aria-activedescendant={pickerOpen && activeOption >= 0 && filteredPlayers[activeOption]
                ? optionId(filteredPlayers[activeOption])
                : undefined}
              autoComplete="off"
              placeholder="Search replacement player"
              value={replacementQuery}
              onFocus={openPicker}
              onClick={openPicker}
              onChange={(event) => {
                setReplacementQuery(event.target.value)
                setReplacement('')
                setPickerOpen(true)
                setActiveOption(0)
              }}
              onKeyDown={handlePickerKeyDown}
            />
            {pickerOpen && (
              <div id={listboxId} role="listbox" aria-label="Replacement players"
                className="replacement-listbox">
                {loadingPlayers ? (
                  <p role="status" className="replacement-picker-message">Loading players…</p>
                ) : playersError ? (
                  <p role="alert" className="replacement-picker-message">{playersError}</p>
                ) : filteredPlayers.length === 0 ? (
                  <p role="status" className="replacement-picker-message">No replacement players found.</p>
                ) : filteredPlayers.map((candidate, index) => (
                  <div
                    id={optionId(candidate)}
                    key={candidate.id}
                    role="option"
                    aria-selected={index === activeOption}
                    className="replacement-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveOption(index)}
                    onClick={() => selectReplacement(candidate)}
                  >
                    {candidate.name} ({candidate.currentRating} Elo)
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={closeDialog}>Close</button>
            {!assigning && (
              <button type="button" className="secondary" disabled={busy}
                onClick={() => void mutate(`/api/games/${game.id}/seats/${dialog}`, {
                  method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' },
                  body: JSON.stringify({ playerId: null }),
                })}>Remove player</button>
            )}
            <button type="button" disabled={busy || !replacement}
              onClick={() => void mutate(`/api/games/${game.id}/seats/${dialog}`, {
                method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify({ playerId: Number(replacement) }),
              })}>{busy ? 'Saving…' : assigning ? 'Assign player' : 'Replace player'}</button>
          </div>
        </> : null}
      </dialog>
    </article>
  )
}
