import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ModalDialog } from './ModalDialog'
import { PlayerMatchupSummary, type MatchupPlayer } from './PlayerMatchupSummary'

export interface OngoingGame {
  id: number
  tableNumber: number
  createdAt: string
  startedAt?: string | null
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
interface SeatChoice {
  value: string
  label: string
  player?: MatchupPlayer
}

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
          {game.startedAt && !game.result && !cancelled && (
            <svg className="game-lock-icon" viewBox="0 0 24 24"
              role="img" aria-label="Locked: game has started" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <title>Locked: game has started</title>
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              <path d="M12 14v3" />
            </svg>
          )}
        </span>
      </div>
      <PlayerSide side="white" player={game.whitePlayer} startingRating={game.whiteStartingRating}
        result={game.result} ratingDelta={game.whiteRatingDelta} cancelled={cancelled} />
    </div>
  )
}

function formatGameStatus(game: OngoingGame): string {
  if (game.cancelledAt) return 'Cancelled'
  if (!game.result) return game.startedAt ? 'Playing' : 'Paired'
  return 'Completed'
}

function formatGameResult(game: OngoingGame): string {
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
  mode = 'card',
  onOpenDetails,
  onClose,
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
  mode?: 'card' | 'dialog'
  onOpenDetails?: () => void
  onClose?: () => void
  authoritativePlayerScan?: AuthoritativePlayerScan | null
  onSeatScanTargetChange?: (target: SeatScanTarget | null) => void
  onSeatScanFeedback?: (feedback: SeatScanFeedback) => void
}) {
  const [dialog, setDialog] = useState<'detail' | 'cancel' | null>(mode === 'dialog' ? 'detail' : null)
  const [activeSide, setActiveSide] = useState<'black' | 'white' | null>(null)
  const [players, setPlayers] = useState<MatchupPlayer[]>([])
  const [pendingSeat, setPendingSeat] = useState<{
    candidate: SeatChoice
    source: 'search' | 'scan'
    message: string
  } | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const confirmationPending = pendingSeat !== null || pendingSwitch !== null
  const [replacementQuery, setReplacementQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<CSSProperties>({})
  const activeInputRef = useRef<HTMLInputElement>(null)
  const [activeOption, setActiveOption] = useState(-1)
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [loadedPlayerContext, setLoadedPlayerContext] = useState<string | null>(null)
  const [playersError, setPlayersError] = useState('')
  const playerContext = `${game.id}:${game.blackPlayerId}:${game.whitePlayerId}`
  const playerContextActive = dialog === 'detail' && management && !game.cancelledAt && !game.result
  const loadingPlayerOptions = loadingPlayers || (!playersError && loadedPlayerContext !== playerContext)
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
  const canStart = !game.result && !game.startedAt && Boolean(game.blackPlayer && game.whitePlayer)
  const canUnstart = !game.result && !cancelled && Boolean(game.startedAt)
  const gameStatus = cancelled ? 'cancelled' : game.result ? 'finished' : game.startedAt ? 'started' : 'ongoing'
  const closeDialog = () => {
    onSeatScanTargetChange?.(null)
    setDialog(null)
    setPendingSeat(null)
    setPendingSwitch(null)
    onClose?.()
  }

  useLayoutEffect(() => {
    if (dialog !== 'detail' || !pickerOpen || !activeSide) return
    const reposition = () => {
      const input = activeInputRef.current
      if (!input) return
      const rect = input.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportLeft = viewport?.offsetLeft ?? 0
      const viewportHeight = viewport?.height ?? window.innerHeight
      const viewportWidth = viewport?.width ?? window.innerWidth
      const spaceBelow = Math.max(0, viewportTop + viewportHeight - rect.bottom - 12)
      const spaceAbove = Math.max(0, rect.top - viewportTop - 12)
      const above = spaceBelow < 240 && spaceAbove > spaceBelow
      const width = Math.min(rect.width, Math.max(0, viewportWidth - 16))
      setPickerPosition({
        top: above ? 'auto' : rect.bottom + 4,
        bottom: above ? window.innerHeight - rect.top + 4 : 'auto',
        left: Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8)),
        width,
        maxHeight: Math.min(340, above ? spaceAbove : spaceBelow),
      })
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.visualViewport?.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('scroll', reposition)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      window.visualViewport?.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('scroll', reposition)
    }
  }, [activeSide, dialog, pickerOpen])

  useLayoutEffect(() => {
    if (dialog === 'detail' && activeSide) activeInputRef.current?.select()
  }, [activeSide, dialog])

  useEffect(() => {
    if (!playerContextActive || loadedPlayerContext === playerContext) return
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
        if (controller.signal.aborted) return
        setLoadingPlayers(true)
        setPlayersError('')
        const response = await fetch(`/api/players?gameId=${game.id}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
        const body = await response.json() as { players?: MatchupPlayer[]; error?: string }
        if (!response.ok || !body.players) throw new Error(body.error || 'Could not load players.')
        if (controller.signal.aborted) return
        setPlayers(body.players)
        setLoadedPlayerContext(playerContext)
        setPlayersError('')
        setLoadingPlayers(false)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setPlayersError(cause instanceof Error ? cause.message : String(cause))
          setLoadingPlayers(false)
        }
      })
    return () => controller.abort()
  }, [game.id, loadedPlayerContext, playerContext, playerContextActive])

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
  const opposingPlayer = activeSide === 'black' ? game.whitePlayer : game.blackPlayer
  const opposingCohort = game.eventId != null && opponent !== null
    ? players.find((candidate) => candidate.id === opponent)?.cohort
    : null
  const current = activeSide === 'black' ? game.blackPlayerId : game.whitePlayerId
  const activePlayer = activeSide === 'black' ? game.blackPlayer : game.whitePlayer
  const activePlayerLabel = activePlayer ? `${activePlayer.name} (${activePlayer.rating} Elo)` : ''
  const assigning = current === null
  const eligiblePlayers = useMemo(() => players.filter((candidate) =>
    candidate.id !== opponent && candidate.id !== current),
  [current, opponent, players])
  const normalizedQuery = replacementQuery === activePlayerLabel
    ? ''
    : replacementQuery.trim().toLocaleLowerCase()
  const emptyOptions: SeatChoice[] = !assigning && (!normalizedQuery || 'empty'.includes(normalizedQuery))
    ? [{ value: 'empty', label: 'Empty' }] : []
  const candidateOptions = eligiblePlayers
    .filter((candidate) => !normalizedQuery || candidate.name.toLocaleLowerCase().includes(normalizedQuery))
    .map((candidate) => ({
        value: String(candidate.id),
        label: `${candidate.name} (${candidate.currentRating} Elo)`,
        player: candidate,
    }))
  const isSuggested = (candidate: SeatChoice) => Boolean(opposingCohort
    && candidate.player?.cohort === opposingCohort
    && (!candidate.player.assignedGame || candidate.player.assignedGame.eventId === game.eventId))
  const suggestedOptions = candidateOptions.filter(isSuggested)
  const otherOptions = candidateOptions.filter((candidate) => !isSuggested(candidate))
  const replacementOptions: SeatChoice[] = [...emptyOptions, ...suggestedOptions, ...otherOptions]
  const optionId = (candidate: { value: string }) => `${listboxId}-option-${candidate.value}`
  const activateSide = (side: 'black' | 'white') => {
    const player = side === 'black' ? game.blackPlayer : game.whitePlayer
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
    candidate: SeatChoice,
    source: 'search' | 'scan' = 'search',
    overrideStarted = false,
  ) => {
    if (!activeSide || busy) return
    if (candidate.player?.assignedGame
      && (candidate.player.assignedGame.eventId ?? null) !== (game.eventId ?? null)) {
      setError('Players can only move between tables in the same event.')
      return
    }
    if (!overrideStarted && (game.startedAt || candidate.player?.assignedGame?.startedAt)) {
      const tables = [
        ...(game.startedAt ? [game.tableNumber] : []),
        ...(candidate.player?.assignedGame?.startedAt ? [candidate.player.assignedGame.tableNumber] : []),
      ]
      setPendingSeat({ candidate, source,
        message: `This game has already started (Table ${[...new Set(tables)].join(', ')}). Confirm an override before modifying it.` })
      setPickerOpen(false)
      onSeatScanTargetChange?.(null)
      return
    }
    setPendingSeat(null)
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
        body: JSON.stringify({ playerId, ...(overrideStarted ? { overrideStarted: true } : {}) }),
      })
      const body = await response.json() as { game?: OngoingGame; error?: string; requiresStartedOverride?: boolean }
      if (!response.ok && body.requiresStartedOverride && !overrideStarted) {
        setPendingSeat({ candidate, source, message: body.error || 'This game has already started. Confirm an override to modify it.' })
        onSeatScanTargetChange?.(null)
        return
      }
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
    game.startedAt,
    game.eventId,
    onMutate,
    onSeatScanFeedback,
    onSeatScanTargetChange,
  ])
  const selectReplacement = (candidate: SeatChoice) => {
    void assignSeat(candidate)
  }

  useEffect(() => {
    if (
      dialog !== 'detail'
      || !activeSide
      || !authoritativePlayerScan
      || confirmationPending
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
      if (loadingPlayerOptions) {
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
      const eligiblePlayer = eligiblePlayers.find((candidate) => candidate.id === playerId)
      if (!eligiblePlayer) {
        reportScanError(`Scanned player #${playerId} is not in the loaded player list.`)
        return
      }
      if (eligiblePlayer.assignedGame
        && (eligiblePlayer.assignedGame.eventId ?? null) !== (game.eventId ?? null)) {
        reportScanError('Players can only move between tables in the same event.')
        return
      }
      void assignSeat({
        value: String(eligiblePlayer.id),
        label: `${eligiblePlayer.name} (${eligiblePlayer.currentRating} Elo)`,
        player: eligiblePlayer,
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
    loadingPlayerOptions,
    opponent,
    onSeatScanFeedback,
    players,
    pendingSeat,
    confirmationPending,
    playersError,
    game.id,
    game.tableNumber,
    game.eventId,
  ])

  const switchPlayers = async (overrideStarted = false) => {
    if (busy) return
    setPickerOpen(false)
    setActiveSide(null)
    onSeatScanTargetChange?.(null)
    setError('')
    setScanMessage('')
    setScanMessageError(false)
    if (game.startedAt && !overrideStarted) {
      setPendingSwitch('This game has already started. Confirm an override before switching white and black players.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch(`/api/games/${game.id}/switch-sides`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(overrideStarted ? { overrideStarted: true } : {}),
      })
      const body = await response.json() as { game?: OngoingGame; error?: string; requiresStartedOverride?: boolean }
      if (!response.ok && body.requiresStartedOverride && !overrideStarted) {
        setPendingSwitch(body.error || 'This game has already started. Confirm an override before switching players.')
        return
      }
      if (!response.ok || !body.game) throw new Error(body.error || `Request failed (${response.status}).`)
      await onMutate?.(body.game)
      setPendingSwitch(null)
      setScanMessage('White and black players switched.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

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
    if (!pickerOpen) {
      setReplacementQuery(activePlayerLabel)
      setPickerOpen(true)
    }
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

  const renderPlayerOption = (candidate: SeatChoice) => {
    const assignedGame = candidate.player?.assignedGame
    const seatContext = assignedGame
      ? `Table ${assignedGame.tableNumber}${assignedGame.startedAt ? ' · Started' : ''}${
        (assignedGame.eventId ?? null) !== (game.eventId ?? null)
          ? ' · Different event (unavailable)' : ' · Moves from this table'}`
      : candidate.player?.checkedIn === false ? 'Not checked in · Checks in when selected' : undefined
    return (
      <div id={optionId(candidate)} key={candidate.value} role="option"
        aria-selected={candidate.value === activeOptionValue}
        title={seatContext}
        className="replacement-option"
        aria-disabled={Boolean(candidate.player?.assignedGame
          && (candidate.player.assignedGame.eventId ?? null) !== (game.eventId ?? null))}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveOption(replacementOptions.indexOf(candidate))}
        onClick={() => {
          if (candidate.player?.assignedGame
            && (candidate.player.assignedGame.eventId ?? null) !== (game.eventId ?? null)) return
          selectReplacement(candidate)
        }}>
        {candidate.player ? <PlayerMatchupSummary player={candidate.player} opponent={opposingPlayer} />
          : <span>{candidate.label}</span>}
        {seatContext && <span className="visually-hidden">{seatContext}</span>}
      </div>
    )
  }

  return (
    <>
    {mode === 'card' && <article
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
          if (onOpenDetails) {
            onOpenDetails()
            return
          }
          dialogReturnFocusRef.current = detailTriggerRef.current
          setActiveSide(null)
          setReplacementQuery('')
          setPickerOpen(false)
          setActiveOption(-1)
          setPlayers([])
          setLoadedPlayerContext(null)
          setPlayersError('')
          setLoadingPlayers(false)
          setScanMessage('')
          setScanMessageError(false)
          setPendingSeat(null)
          handledScanTokenRef.current = authoritativePlayerScan?.token ?? null
          setDialog('detail')
        }} />}
    </article>}
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
          {management && !cancelled && !game.result && <>
            <div className="game-detail-seat-editors">
              {(['black', 'white'] as const).map((side) => {
                const player = side === 'black' ? game.blackPlayer : game.whitePlayer
                const seatOpponent = side === 'black' ? game.whitePlayer : game.blackPlayer
                const isActive = activeSide === side
                const isEditing = isActive && pickerOpen
                const inputId = `seat-player-${game.id}-${side}`
                const loadedPlayer = loadedPlayerContext === playerContext
                  ? players.find((candidate) => candidate.id === player?.id) : undefined
                const summaryPlayer: MatchupPlayer | null = player ? {
                  ...loadedPlayer, id: player.id, name: player.name,
                  currentRating: loadedPlayer?.currentRating ?? player.rating,
                  assignedGame: {
                    id: game.id, tableNumber: game.tableNumber, eventId: game.eventId ?? null,
                    startedAt: game.startedAt ?? null, opponent: seatOpponent,
                  },
                } : null
                const showSummary = summaryPlayer !== null && !isEditing
                return (
                  <Fragment key={side}>
                  <div className="game-detail-seat-editor">
                    <label htmlFor={inputId}>{side === 'black' ? 'Black' : 'White'} player</label>
                    <div className={`replacement-combobox seat-player-combobox${showSummary ? ' has-player-summary' : ''}`}>
                      <input
                        ref={isActive ? activeInputRef : undefined}
                        id={inputId}
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-describedby={showSummary ? `${inputId}-summary` : undefined}
                        aria-expanded={isActive && pickerOpen}
                        aria-controls={isActive ? listboxId : undefined}
                        aria-activedescendant={isActive && pickerOpen && activeOption >= 0
                          && replacementOptions[activeOption]
                          ? optionId(replacementOptions[activeOption])
                          : undefined}
                        autoComplete="off"
                        disabled={busy || confirmationPending}
                        placeholder={`Search or scan ${side} player`}
                        value={isEditing
                          ? replacementQuery
                          : player ? `${player.name} (${player.rating} Elo)` : ''}
                        onFocus={() => activateSide(side)}
                        onBlur={() => {
                          setPickerOpen(false)
                          setActiveOption(-1)
                        }}
                        onClick={(event) => {
                          if (!isEditing) activateSide(side)
                          else openPicker()
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
                      {showSummary && <div id={`${inputId}-summary`} className="seat-player-display" aria-hidden="true">
                        <PlayerMatchupSummary player={summaryPlayer} opponent={seatOpponent} />
                      </div>}
                      {isActive && pickerOpen && (
                        <div id={listboxId} role="listbox"
                          aria-label={`${side === 'black' ? 'Black' : 'White'} player options`}
                          className="replacement-listbox" style={pickerPosition}>
                          {loadingPlayerOptions ? (
                            <p role="status" className="replacement-picker-message">Loading players…</p>
                          ) : playersError ? (
                            <p role="alert" className="replacement-picker-message">{playersError}</p>
                          ) : replacementOptions.length === 0 ? (
                            <p role="status" className="replacement-picker-message">No replacement players found.</p>
                          ) : <>
                            {emptyOptions.map(renderPlayerOption)}
                            {opposingCohort ? <>
                              <div role="group" aria-label={`Suggested players, Cohort ${opposingCohort}`}>
                                <div className="replacement-section-heading" aria-hidden="true">
                                  Suggested · Cohort {opposingCohort}
                                </div>
                                {suggestedOptions.length > 0 ? suggestedOptions.map(renderPlayerOption)
                                  : <p className="replacement-picker-message">No suggested players match your search.</p>}
                              </div>
                              {otherOptions.length > 0 && <div role="group" aria-label="Other players">
                                <div className="replacement-section-heading" aria-hidden="true">Other players</div>
                                {otherOptions.map(renderPlayerOption)}
                              </div>}
                            </> : otherOptions.map(renderPlayerOption)}
                          </>}
                        </div>
                      )}
                    </div>
                  </div>
                  {side === 'black' && <button type="button" className="game-detail-switch secondary"
                    aria-label="Switch white and black players"
                    title="Switch white and black players"
                    disabled={busy || confirmationPending || (!game.blackPlayer && !game.whitePlayer)}
                    onClick={() => void switchPlayers()}>
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"
                      width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="m17 2 4 4-4 4M21 6H3v6m4 10-4-4 4-4M3 18h18v-6" />
                    </svg>
                  </button>}
                  </Fragment>
                )
              })}
            </div>
            {playersError && !pickerOpen && <p role="alert">{playersError}</p>}
            {pendingSwitch && <section className="started-game-confirmation" aria-label="Confirm Started game switch">
              <p role="alert">{pendingSwitch}</p>
              <div className="dialog-actions">
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => setPendingSwitch(null)}>Keep players unchanged</button>
                <button type="button" disabled={busy}
                  onClick={() => void switchPlayers(true)}>Override and switch</button>
              </div>
            </section>}
            {pendingSeat && <section className="started-game-confirmation" aria-label="Confirm Started game change">
              <p role="alert">{pendingSeat.message}</p>
              <p>{pendingSeat.candidate.label} will be assigned to the {activeSide} seat.
                {pendingSeat.candidate.player?.assignedGame
                  && pendingSeat.candidate.player.assignedGame.id !== game.id
                  ? ` Their seat at Table ${pendingSeat.candidate.player.assignedGame.tableNumber} will be left empty.` : ''}</p>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={() => setPendingSeat(null)}>Keep games unchanged</button>
                <button type="button" onClick={() => void assignSeat(pendingSeat.candidate, pendingSeat.source, true)}>
                  Override and assign
                </button>
              </div>
            </section>}
            {game.blackPlayer && game.whitePlayer && (
              <div className="game-detail-result-actions" role="group" aria-label="Declare game result">
                <button type="button" className="game-detail-result-action winner"
                  disabled={busy || confirmationPending}
                  onClick={() => void mutate(`/api/games/${game.id}/result`, {
                    method: 'PATCH',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ result: '0-1' }),
                  })}>
                  Black Wins
                </button>
                <button type="button" className="game-detail-result-action draw"
                  disabled={busy || confirmationPending}
                  onClick={() => void mutate(`/api/games/${game.id}/result`, {
                    method: 'PATCH',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ result: '1/2-1/2' }),
                  })}>
                  Draw
                </button>
                <button type="button" className="game-detail-result-action winner"
                  disabled={busy || confirmationPending}
                  onClick={() => void mutate(`/api/games/${game.id}/result`, {
                    method: 'PATCH',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ result: '1-0' }),
                  })}>
                  White Wins
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
          </>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="game-detail-overview">
            <dl className="game-detail-audit">
              <div>
                <dt>Status</dt>
                <dd className="game-detail-status">
                  {management && !cancelled && (canStart || canUnstart || canCancel) ? (
                    <select aria-label="Game status" value={gameStatus} disabled={busy || confirmationPending}
                      onChange={(event) => {
                        if (event.target.value === 'started' && canStart) {
                          void mutate(`/api/games/${game.id}/start`, { method: 'POST' })
                        } else if (event.target.value === 'ongoing' && canUnstart) {
                          void mutate(`/api/games/${game.id}/start`, {
                            method: 'POST',
                            headers: { accept: 'application/json', 'content-type': 'application/json' },
                            body: JSON.stringify({ start: false }),
                          })
                        } else if (event.target.value === 'cancelled' && canCancel) {
                          if (game.result) openManagementDialog('cancel')
                          else void mutate(`/api/games/${game.id}`, {
                            method: 'DELETE',
                            headers: { accept: 'application/json', 'content-type': 'application/json' },
                            body: JSON.stringify({ overrideStarted: true, unfinishedOnly: true }),
                          })
                        }
                      }}>
                      {!game.result && <option value="ongoing">Paired</option>}
                      {(canStart || canUnstart) && <option value="started">Playing</option>}
                      {game.result && <option value="finished">Completed</option>}
                      {canCancel && <option value="cancelled">Cancelled</option>}
                    </select>
                  ) : <span>{formatGameStatus(game)}</span>}
                </dd>
              </div>
              <div><dt>Created</dt><dd><time dateTime={game.createdAt}>{new Date(game.createdAt).toLocaleString()}</time></dd></div>
              {game.startedAt && <div><dt>Started</dt><dd><time dateTime={game.startedAt}>{new Date(game.startedAt).toLocaleString()}</time></dd></div>}
              {game.finishedAt && <div><dt>Completed</dt><dd><time dateTime={game.finishedAt}>{new Date(game.finishedAt).toLocaleString()}</time></dd></div>}
              {game.result && <div><dt>Result</dt><dd>{formatGameResult(game)}</dd></div>}
              {game.cancelledAt && <div><dt>Cancelled</dt><dd><time dateTime={game.cancelledAt}>{new Date(game.cancelledAt).toLocaleString()}</time></dd></div>}
              {game.cancellationReason && <div><dt>Reason</dt><dd>{game.cancellationReason}</dd></div>}
            </dl>
            <GameSummary game={game} detail />
          </div>
        </> : dialog === 'cancel' ? <>
          <p>Cancellation is allowed only if this is both players’ latest game. Click “Cancel Game” to proceed.</p>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={closeDialog}>Keep game</button>
            <button type="button" disabled={busy} onClick={() => void mutate(`/api/games/${game.id}`, {
              method: 'DELETE', headers: { accept: 'application/json', 'content-type': 'application/json' },
            })}>{busy ? 'Cancelling…' : 'Cancel Game'}</button>
          </div>
        </> : null}
      </ModalDialog>}
    </>
  )
}
