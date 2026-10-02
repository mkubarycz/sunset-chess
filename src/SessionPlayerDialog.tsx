import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { ModalDialog } from './ModalDialog'

export interface SelectablePlayer {
  id: number
  name: string
  currentRating: number
}

export function SessionPlayerDialog({
  eventId,
  returnFocusRef,
  onCheckIn,
  onClose,
}: {
  eventId: number
  returnFocusRef: RefObject<HTMLElement | null>
  onCheckIn: (player: SelectablePlayer) => Promise<void>
  onClose: () => void
}) {
  const [players, setPlayers] = useState<SelectablePlayer[]>([])
  const [checkedInIds, setCheckedInIds] = useState(new Set<number>())
  const [query, setQuery] = useState('')
  const [activeOption, setActiveOption] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      fetch('/api/players', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      }),
      fetch(`/api/leaderboard?eventId=${eventId}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      }),
    ]).then(async ([playersResponse, sessionResponse]) => {
      const playersBody = await playersResponse.json() as {
        players?: SelectablePlayer[]
        error?: string
      }
      const sessionBody = await sessionResponse.json() as {
        leaderboard?: Array<{ id: number }>
        error?: string
      }
      if (!playersResponse.ok || !playersBody.players) {
        throw new Error(playersBody.error || 'Could not load players.')
      }
      if (!sessionResponse.ok || !sessionBody.leaderboard) {
        throw new Error(sessionBody.error || 'Could not load session players.')
      }
      setPlayers(playersBody.players)
      setCheckedInIds(new Set(sessionBody.leaderboard.map(({ id }) => id)))
      setError('')
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not load players.')
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [eventId])

  const options = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return players.filter((player) =>
      !checkedInIds.has(player.id)
      && (!normalized || player.name.toLocaleLowerCase().includes(normalized)))
  }, [checkedInIds, players, query])

  const selectPlayer = async (player: SelectablePlayer) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onCheckIn(player)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check in this player.')
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveOption((index) => options.length === 0 ? -1 : (index + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveOption((index) => options.length === 0
        ? -1
        : (index - 1 + options.length) % options.length)
    } else if (event.key === 'Enter' && activeOption >= 0 && options[activeOption]) {
      event.preventDefault()
      void selectPlayer(options[activeOption])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <ModalDialog title="Add Player to Session" className=" session-player-dialog"
      closeLabel="Close player selection"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}>
      <label htmlFor={`session-player-${eventId}`}>Player</label>
      <div className="replacement-combobox">
        <input id={`session-player-${eventId}`} ref={inputRef}
          type="text" role="combobox" autoComplete="off"
          aria-autocomplete="list" aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={activeOption >= 0 && options[activeOption]
            ? `${listboxId}-option-${options[activeOption].id}`
            : undefined}
          placeholder="Search for a player"
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveOption(0)
          }}
          onKeyDown={handleKeyDown} />
        <div id={listboxId} role="listbox" aria-label="Players available for session check-in"
          className="replacement-listbox session-player-options">
          {loading ? (
            <p role="status" className="replacement-picker-message">Loading players…</p>
          ) : error && players.length === 0 ? (
            <p role="alert" className="replacement-picker-message">{error}</p>
          ) : options.length === 0 ? (
            <p role="status" className="replacement-picker-message">
              {query.trim() ? 'No matching players found.' : 'All players are already checked in.'}
            </p>
          ) : options.map((player, index) => (
            <div id={`${listboxId}-option-${player.id}`} key={player.id}
              role="option" aria-selected={index === activeOption}
              className="replacement-option"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveOption(index)}
              onClick={() => void selectPlayer(player)}>
              {player.name} ({player.currentRating} Elo)
            </div>
          ))}
        </div>
      </div>
      {error && players.length > 0 && <p className="form-error" role="alert">{error}</p>}
      {busy && <p role="status" className="session-settings-status">Checking player in…</p>}
    </ModalDialog>
  )
}
