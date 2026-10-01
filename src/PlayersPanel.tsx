import { useEffect, useRef, useState } from 'react'
import { normalizePlayerName } from './qrPayload'
import type { LeaderboardEntry } from './Leaderboard'

async function responseBody(response: Response) {
  return response.json() as Promise<{ player?: unknown; players?: LeaderboardEntry[]; error?: string }>
}

export function PlayersPanel({
  refreshKey,
  onMutate,
}: {
  refreshKey: number
  onMutate: () => void
}) {
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirming, setConfirming] = useState<LeaderboardEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)

  const refresh = async (signal?: AbortSignal) => {
    const response = await fetch('/api/players', { signal, headers: { accept: 'application/json' } })
    const body = await responseBody(response)
    if (!response.ok || !body.players) throw new Error(body.error || 'Could not load players.')
    setPlayers(body.players)
    setError('')
  }
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => refresh(controller.signal)).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load players.')
    })
    return () => controller.abort()
  }, [refreshKey])

  const rename = async (player: LeaderboardEntry) => {
    setBusy(true)
    setError('')
    try {
      const name = normalizePlayerName(editName)
      const response = await fetch(`/api/players/${player.id}`, {
        method: 'PATCH',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error || `Rename failed (${response.status}).`)
      setEditing(null)
      await refresh()
      onMutate()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename player.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirming) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/players/${confirming.id}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error || `Delete failed (${response.status}).`)
      setConfirming(null)
      await refresh()
      onMutate()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete player.')
    } finally {
      setBusy(false)
      window.requestAnimationFrame(() => returnFocusRef.current?.focus())
    }
  }
  return (
    <section className="players-panel" aria-labelledby="players-heading" aria-busy={busy}>
      <div><p className="eyebrow">Club roster</p><h2 id="players-heading">Players</h2></div>
      {error && <p className="games-message error" role="alert">{error}</p>}
      <div className="players-table-wrap">
        <table className="players-table" aria-label="All players">
          <thead><tr><th>Player</th><th>ID</th><th>Elo</th><th>W/L/D</th><th>Actions</th></tr></thead>
          <tbody>{players.map((player) => (
            <tr key={player.id}>
              <td>{editing === player.id
                ? <input aria-label={`New name for ${player.name}`} maxLength={80} value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void rename(player) }} />
                : <strong>{player.name}</strong>}</td>
              <td>#{player.id}</td><td>{player.currentRating}</td>
              <td>{player.wins}/{player.losses}/{player.draws}</td>
              <td className="player-actions">
                {editing === player.id ? <>
                  <button type="button" disabled={busy} onClick={() => void rename(player)}>Save</button>
                  <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                </> : <>
                  <button type="button" className="secondary" onClick={() => {
                    setEditing(player.id); setEditName(player.name)
                  }}>Edit {player.name}</button>
                  <button type="button" className="danger" ref={returnFocusRef} onClick={() => setConfirming(player)}>
                    Delete {player.name}
                  </button>
                </>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {confirming && (
        <div className="confirm-delete" role="alertdialog" aria-modal="true"
          aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-copy">
          <h3 id="confirm-delete-title">Delete {confirming.name}?</h3>
          <p id="confirm-delete-copy">Only players with no game references and baseline-only rating history can be deleted.</p>
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Confirm delete</button>
          <button type="button" className="secondary" onClick={() => setConfirming(null)}>Cancel</button>
        </div>
      )}
    </section>
  )
}
