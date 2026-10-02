import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LeaderboardEntry } from './PlayerCardDialog'
import { ModalDialog } from './ModalDialog'

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
  eventId?: number | null
  canCancel?: boolean
  blackStartingRating?: number | null
  whiteStartingRating?: number | null
  blackRatingDelta?: number | null
  whiteRatingDelta?: number | null
  blackPlayer: { id: number; name: string; rating: number } | null
  whitePlayer: { id: number; name: string; rating: number } | null
}

export interface AuthoritativePlayerScan {
  playerId: number
  token: string
}

export interface SeatScanTarget {
  gameId: number
  tableNumber: number
  side: 'black' | 'white'
}

export interface SeatScanFeedback extends SeatScanTarget {
  playerId: number
  playerName: string
  status: 'assigning' | 'success' | 'error'
  message: string
}

const backRank = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'] as const
const pieceSymbols = {
  black: ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
  white: ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'],
} as const
const noUnavailablePlayerIds: readonly number[] = []

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
  startingRating,
  result,
  ratingDelta,
  cancelled,
}: {
  side: 'black' | 'white'
  player: OngoingGame['blackPlayer']
  startingRating?: number | null
  result: OngoingGame['result']
  ratingDelta?: number | null
  cancelled: boolean
}) {
  const isWinner = (side === 'black' && result === '0-1') || (side === 'white' && result === '1-0')
  const isDraw = result === '1/2-1/2'
  const outcome = result ? isDraw ? 'D' : isWinner ? 'W' : 'L' : null
  const label = side === 'black' ? 'Black' : 'White'
  const displayedRating = startingRating ?? player?.rating
  return (
    <div
      className={`player-side table-player-side ${side}-side${isWinner ? ' winner' : ''}${isDraw ? ' draw' : ''}`}
      aria-label={player ? `${label} player: ${player.name}, rating ${displayedRating}` : `Waiting for ${label}`}
    >
      <span className="player-identity-line">
        <strong>{player?.name ?? `Waiting for ${label}`}</strong>
        {player && <span className="player-rating">{displayedRating}</span>}
      </span>
      {player && result && !cancelled && ratingDelta != null && (
        <span className={`rating-delta ${
          isDraw ? 'draw' : ratingDelta > 0 ? 'positive' : ratingDelta < 0 ? 'negative' : 'neutral'
        }`}>
          {outcome} {ratingDelta > 0 ? '+' : ''}{ratingDelta}
        </span>
      )}
    </div>
  )
}

function GameSummary({ game, detail = false }: { game: OngoingGame; detail?: boolean }) {
  const cancelled = Boolean(game.cancelledAt)
  return (
    <div className={detail ? 'game-detail-summary' : 'game-summary'}>
      <PlayerSide side="black" player={game.blackPlayer} startingRating={game.blackStartingRating}
        result={game.result} ratingDelta={game.blackRatingDelta} cancelled={cancelled} />
      <div className="mini-board-wrap">
        <MiniBoard />
        <span className={`game-table-badge${cancelled ? ' cancelled' : ''}`}>
          Table {game.tableNumber}{cancelled ? ' - Cancelled' : ''}
        </span>
      </div>
      <PlayerSide side="white" player={game.whitePlayer} startingRating={game.whiteStartingRating}
        result={game.result} ratingDelta={game.whiteRatingDelta} cancelled={cancelled} />
    </div>
  )
}

function formatGameStatus(game: OngoingGame): string {
  if (game.cancelledAt) return 'Cancelled'
  if (!game.result) return 'Ongoing'
  if (game.result === '1/2-1/2') return 'Draw'
  const whiteRating = game.whiteStartingRating ?? game.whitePlayer?.rating
  const blackRating = game.blackStartingRating ?? game.blackPlayer?.rating
  if (!game.whitePlayer || !game.blackPlayer || whiteRating == null || blackRating == null) {
    throw new Error(`Completed game ${game.id} is missing player or rating details.`)
  }
  const [winner, winnerRating, loser, loserRating] = game.result === '1-0'
    ? [game.whitePlayer, whiteRating, game.blackPlayer, blackRating]
    : [game.blackPlayer, blackRating, game.whitePlayer, whiteRating]
  return `${winner.name} (${winnerRating}) DEF ${loser.name} (${loserRating})`
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
  selectable = true,
  unavailablePlayerIds = noUnavailablePlayerIds,
  authoritativePlayerScan = null,
  onSeatScanTargetChange,
  onSeatScanFeedback,
}: {
  game: OngoingGame
  className?: string
  cardRef?: (element: HTMLElement | null) => void
  ariaLabel?: string
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  onMutate?: (game: OngoingGame) => void | Promise<void>
  management?: boolean
  selectable?: boolean
  unavailablePlayerIds?: readonly number[]
  authoritativePlayerScan?: AuthoritativePlayerScan | null
  onSeatScanTargetChange?: (target: SeatScanTarget | null) => void
  onSeatScanFeedback?: (feedback: SeatScanFeedback) => void
}) {
  const [dialog, setDialog] = useState<'detail' | 'cancel' | null>(null)
  const [activeSide, setActiveSide] = useState<'black' | 'white' | null>(null)
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [replacementQuery, setReplacementQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeOption, setActiveOption] = useState(-1)
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [playersError, setPlayersError] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [scanMessageError, setScanMessageError] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pickerId = useId()
  const listboxId = `replacement-listbox-${pickerId}`
  const detailTriggerRef = useRef<HTMLButtonElement>(null)
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const handledScanTokenRef = useRef<string | null>(null)
  const cancelled = Boolean(game.cancelledAt)
  const canCancel = game.canCancel !== false
  const closeDialog = () => {
    onSeatScanTargetChange?.(null)
    setDialog(null)
  }

  const loadPlayers = () => {
    if (loadingPlayers || players.length > 0) return
    const controller = new AbortController()
    setLoadingPlayers(true)
    void fetch(`/api/players?gameId=${game.id}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
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
  }

  const openManagementDialog = (next: 'cancel') => {
    onSeatScanTargetChange?.(null)
    setError('')
    setReplacementQuery('')
    setPickerOpen(false)
    setActiveOption(-1)
    setScanMessage('')
    setScanMessageError(false)
    setActiveSide(null)
    handledScanTokenRef.current = authoritativePlayerScan?.token ?? null
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
  const opponent = activeSide === 'black' ? game.whitePlayerId : game.blackPlayerId
  const current = activeSide === 'black' ? game.blackPlayerId : game.whitePlayerId
  const activePlayer = activeSide === 'black' ? game.blackPlayer : game.whitePlayer
  const activePlayerLabel = activePlayer ? `${activePlayer.name} (${activePlayer.rating} Elo)` : ''
  const assigning = current === null
  const unavailablePlayers = useMemo(() => new Set(unavailablePlayerIds), [unavailablePlayerIds])
  const eligiblePlayers = useMemo(() => players.filter((candidate) =>
    candidate.id !== opponent && candidate.id !== current && !unavailablePlayers.has(candidate.id)),
  [current, opponent, players, unavailablePlayers])
  const normalizedQuery = replacementQuery === activePlayerLabel
    ? ''
    : replacementQuery.trim().toLocaleLowerCase()
  const replacementOptions = [
    ...(!assigning && (!normalizedQuery || 'empty'.includes(normalizedQuery))
      ? [{ value: 'empty', label: 'Empty' }]
      : []),
    ...eligiblePlayers
      .filter((candidate) => !normalizedQuery || candidate.name.toLocaleLowerCase().includes(normalizedQuery))
      .map((candidate) => ({
        value: String(candidate.id),
        label: `${candidate.name} (${candidate.currentRating} Elo)`,
        player: candidate,
      })),
  ]
  const optionId = (candidate: { value: string }) => `${listboxId}-option-${candidate.value}`
  const activateSide = (side: 'black' | 'white') => {
    const player = side === 'black' ? game.blackPlayer : game.whitePlayer
    loadPlayers()
    setActiveSide(side)
    setReplacementQuery(player ? `${player.name} (${player.rating} Elo)` : '')
    setPickerOpen(true)
    setActiveOption(0)
    setError('')
    setScanMessage('')
    setScanMessageError(false)
    handledScanTokenRef.current = authoritativePlayerScan?.token ?? null
    onSeatScanTargetChange?.({
      gameId: game.id,
      tableNumber: game.tableNumber,
      side,
    })
  }
  const assignSeat = useCallback(async (
    candidate: { value: string; label: string },
    source: 'search' | 'scan' = 'search',
  ) => {
    if (!activeSide || busy) return
    const side = activeSide
    const seat = side === 'black' ? 'Black' : 'White'
    const playerId = candidate.value === 'empty' ? null : Number(candidate.value)
    const playerName = candidate.label.replace(/ \(\d+ Elo\)$/, '')
    setReplacementQuery(candidate.label)
    setPickerOpen(false)
    setActiveOption(-1)
    setBusy(true)
    setError('')
    setScanMessage('')
    setScanMessageError(false)
    if (source === 'scan' && playerId !== null && onSeatScanFeedback) {
      onSeatScanFeedback({
        gameId: game.id,
        tableNumber: game.tableNumber,
        side,
        playerId,
        playerName,
        status: 'assigning',
        message: `Checking ${playerName} into the ${seat} spot on Table ${game.tableNumber}…`,
      })
    }
    try {
      const response = await fetch(`/api/games/${game.id}/seats/${side}`, {
        method: 'PATCH',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
      const body = await response.json() as { game?: OngoingGame; error?: string }
      if (!response.ok || !body.game) throw new Error(body.error || `Request failed (${response.status}).`)
      await onMutate?.(body.game)
      if (source === 'scan' && playerId !== null && onSeatScanFeedback) {
        onSeatScanFeedback({
          gameId: game.id,
          tableNumber: game.tableNumber,
          side,
          playerId,
          playerName,
          status: 'success',
          message: `${playerName} checked into the ${seat} spot on Table ${game.tableNumber}.`,
        })
      } else {
        setScanMessage(candidate.value === 'empty'
          ? `${seat} spot on Table ${game.tableNumber} is now empty.`
          : `${playerName} is now in the ${seat} spot on Table ${game.tableNumber}.`)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (source === 'scan' && playerId !== null && onSeatScanFeedback) {
        onSeatScanFeedback({
          gameId: game.id,
          tableNumber: game.tableNumber,
          side,
          playerId,
          playerName,
          status: 'error',
          message,
        })
      } else {
        setScanMessageError(true)
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }, [
    activeSide,
    busy,
    game.id,
    game.tableNumber,
    onMutate,
    onSeatScanFeedback,
  ])
  const selectReplacement = (candidate: { value: string; label: string }) => {
    void assignSeat(candidate)
  }

  useEffect(() => {
    if (
      dialog !== 'detail'
      || !activeSide
      || !authoritativePlayerScan
      || handledScanTokenRef.current === authoritativePlayerScan.token
    ) return
    handledScanTokenRef.current = authoritativePlayerScan.token
    const timer = window.setTimeout(() => {
      const playerId = authoritativePlayerScan.playerId
      const knownPlayer = players.find((candidate) => candidate.id === playerId)
      const playerName = knownPlayer?.name ?? `Player #${playerId}`
      const reportScanError = (message: string) => {
        if (onSeatScanFeedback) {
          onSeatScanFeedback({
            gameId: game.id,
            tableNumber: game.tableNumber,
            side: activeSide,
            playerId,
            playerName,
            status: 'error',
            message,
          })
        } else {
          setScanMessage(message)
          setScanMessageError(true)
        }
      }
      if (loadingPlayers) {
        reportScanError('The player list is still loading. Scan the piece again when loading is complete.')
        return
      }
      if (playersError) {
        reportScanError('The scanned player cannot be selected because the player list is unavailable.')
        return
      }
      if (playerId === current) {
        reportScanError(`${playerName} is already in this seat and cannot be selected.`)
        return
      }
      if (playerId === opponent) {
        reportScanError(`${playerName} is already in the opposing seat and cannot be selected.`)
        return
      }
      if (unavailablePlayers.has(playerId)) {
        reportScanError(`${playerName} is seated in another ongoing game and cannot be selected.`)
        return
      }
      const eligiblePlayer = eligiblePlayers.find((candidate) => candidate.id === playerId)
      if (!eligiblePlayer) {
        reportScanError(`Scanned player #${playerId} is not in the loaded player list.`)
        return
      }
      void assignSeat({
        value: String(eligiblePlayer.id),
        label: `${eligiblePlayer.name} (${eligiblePlayer.currentRating} Elo)`,
      }, 'scan')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    activeSide,
    assignSeat,
    authoritativePlayerScan,
    busy,
    current,
    dialog,
    eligiblePlayers,
    loadingPlayers,
    opponent,
    onSeatScanFeedback,
    players,
    playersError,
    game.id,
    game.tableNumber,
    unavailablePlayers,
  ])

  const openPicker = () => {
    setPickerOpen(true)
    setActiveOption((index) => replacementOptions.length === 0 ? -1 : Math.min(Math.max(index, 0), replacementOptions.length - 1))
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
      if (pickerOpen && activeOption >= 0 && replacementOptions[activeOption]) {
        event.preventDefault()
        selectReplacement(replacementOptions[activeOption])
      }
      return
    }
    event.preventDefault()
    if (!pickerOpen) setPickerOpen(true)
    if (replacementOptions.length === 0) {
      setActiveOption(-1)
    } else if (event.key === 'Home') {
      setActiveOption(0)
    } else if (event.key === 'End') {
      setActiveOption(replacementOptions.length - 1)
    } else if (event.key === 'ArrowDown') {
      setActiveOption((index) => index < 0 ? 0 : Math.min(index + 1, replacementOptions.length - 1))
    } else {
      setActiveOption((index) => index < 0 ? replacementOptions.length - 1 : Math.max(index - 1, 0))
    }
  }

  const activeOptionValue = replacementOptions[activeOption]?.value
  useEffect(() => {
    if (!pickerOpen || !activeOptionValue) return
    document.getElementById(`${listboxId}-option-${activeOptionValue}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOptionValue, pickerOpen, listboxId])

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
      <GameSummary game={game} />
      {selectable && <button type="button" className="game-card-hit"
        ref={detailTriggerRef}
        aria-label={`Open details for Table ${game.tableNumber}`}
        onClick={() => {
          dialogReturnFocusRef.current = detailTriggerRef.current
          setActiveSide(null)
          setReplacementQuery('')
          setPickerOpen(false)
          setActiveOption(-1)
          setPlayers([])
          setPlayersError('')
          setLoadingPlayers(false)
          setScanMessage('')
          setScanMessageError(false)
          handledScanTokenRef.current = authoritativePlayerScan?.token ?? null
          setDialog('detail')
        }} />}
      {dialog && <ModalDialog
        key={dialog}
        className={` game-management-dialog${dialog === 'detail' ? ' game-detail-dialog' : ''}`}
        title={dialog === 'detail'
          ? `Table ${game.tableNumber} game details`
          : `Cancel Table ${game.tableNumber}?`}
        closeLabel={dialog === 'detail'
          ? 'Close game details'
          : 'Close cancellation dialog'}
        returnFocusRef={dialogReturnFocusRef}
        onClose={closeDialog}>
        {dialog === 'detail' ? <>
          <GameSummary game={game} detail />
          <dl className="game-detail-audit">
            <div><dt>Status</dt><dd>{formatGameStatus(game)}</dd></div>
            <div><dt>Started</dt><dd><time dateTime={game.createdAt}>{new Date(game.createdAt).toLocaleString()}</time></dd></div>
            {game.finishedAt && <div><dt>Finished</dt><dd><time dateTime={game.finishedAt}>{new Date(game.finishedAt).toLocaleString()}</time></dd></div>}
            {game.cancelledAt && <div><dt>Cancelled</dt><dd><time dateTime={game.cancelledAt}>{new Date(game.cancelledAt).toLocaleString()}</time></dd></div>}
            {game.cancellationReason && <div><dt>Reason</dt><dd>{game.cancellationReason}</dd></div>}
          </dl>
          {management && !cancelled && !game.result && <>
            <div className="game-detail-seat-editors">
              {(['black', 'white'] as const).map((side) => {
                const player = side === 'black' ? game.blackPlayer : game.whitePlayer
                const isActive = activeSide === side
                const inputId = `seat-player-${game.id}-${side}`
                return (
                  <div className="game-detail-seat-editor" key={side}>
                    <label htmlFor={inputId}>{side === 'black' ? 'Black' : 'White'} player</label>
                    <div className="replacement-combobox">
                      <input
                        id={inputId}
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={isActive && pickerOpen}
                        aria-controls={isActive ? listboxId : undefined}
                        aria-activedescendant={isActive && pickerOpen && activeOption >= 0
                          && replacementOptions[activeOption]
                          ? optionId(replacementOptions[activeOption])
                          : undefined}
                        autoComplete="off"
                        placeholder={`Search or scan ${side} player`}
                        value={isActive
                          ? replacementQuery
                          : player ? `${player.name} (${player.rating} Elo)` : ''}
                        onFocus={(event) => {
                          const input = event.currentTarget
                          activateSide(side)
                          window.requestAnimationFrame(() => input.select())
                        }}
                        onClick={(event) => {
                          openPicker()
                          event.currentTarget.select()
                        }}
                        onChange={(event) => {
                          if (!isActive) setActiveSide(side)
                          setReplacementQuery(event.target.value)
                          setScanMessage('')
                          setScanMessageError(false)
                          setPickerOpen(true)
                          setActiveOption(0)
                        }}
                        onKeyDown={handlePickerKeyDown}
                      />
                      {isActive && pickerOpen && (
                        <div id={listboxId} role="listbox"
                          aria-label={`${side === 'black' ? 'Black' : 'White'} player options`}
                          className="replacement-listbox">
                          {loadingPlayers ? (
                            <p role="status" className="replacement-picker-message">Loading players…</p>
                          ) : playersError ? (
                            <p role="alert" className="replacement-picker-message">{playersError}</p>
                          ) : replacementOptions.length === 0 ? (
                            <p role="status" className="replacement-picker-message">No replacement players found.</p>
                          ) : replacementOptions.map((candidate, index) => (
                            <div
                              id={optionId(candidate)}
                              key={candidate.value}
                              role="option"
                              aria-selected={index === activeOption}
                              className="replacement-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveOption(index)}
                              onClick={() => selectReplacement(candidate)}
                            >
                              {candidate.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {game.blackPlayer && game.whitePlayer && (
              <div className="game-detail-result-actions" role="group" aria-label="Declare game result">
                <button type="button" className="game-detail-result-action winner"
                  disabled={busy}
                  onClick={() => void mutate(`/api/games/${game.id}/result`, {
                    method: 'PATCH',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ result: '0-1' }),
                  })}>
                  Declare Black Winner
                </button>
                <button type="button" className="game-detail-result-action draw"
                  disabled={busy}
                  onClick={() => void mutate(`/api/games/${game.id}/result`, {
                    method: 'PATCH',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ result: '1/2-1/2' }),
                  })}>
                  Draw
                </button>
                <button type="button" className="game-detail-result-action winner"
                  disabled={busy}
                  onClick={() => void mutate(`/api/games/${game.id}/result`, {
                    method: 'PATCH',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ result: '1-0' }),
                  })}>
                  Declare White Winner
                </button>
              </div>
            )}
            {busy && <p role="status" className="seat-scan-message">Updating game…</p>}
            {scanMessage && (
              <p role={scanMessageError ? 'alert' : 'status'} aria-live="polite"
                className={`check-in-notice seat-assignment-notice${scanMessageError ? ' error' : ''}`}>
                {scanMessage}
              </p>
            )}
            {error && <p role="alert" className="form-error">{error}</p>}
          </>}
          <div className="game-detail-actions">
            {management && !cancelled && canCancel && (
              <button type="button" className="game-detail-action cancel"
                onClick={() => openManagementDialog('cancel')}>
                Cancel Game
              </button>
            )}
            <button type="button" className="game-detail-action close" onClick={closeDialog}>Close</button>
          </div>
        </> : dialog === 'cancel' ? <>
          <p>{game.result
            ? 'Cancellation is allowed only if this is both players’ latest game. Click “Cancel Game” to proceed.'
            : 'This permanently removes the unfinished game and frees its occupied seats. No Elo event will be created.'}</p>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={closeDialog}>Keep game</button>
            <button type="button" disabled={busy} onClick={() => void mutate(`/api/games/${game.id}`, {
              method: 'DELETE', headers: { accept: 'application/json' },
            })}>{busy ? 'Cancelling…' : 'Cancel Game'}</button>
          </div>
        </> : null}
      </ModalDialog>}
    </article>
  )
}
