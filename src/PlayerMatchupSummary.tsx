export interface MatchupPlayer {
  id: number
  name: string
  currentRating: number
  cohort?: 'A' | 'B' | 'C' | 'D' | null
  headToHead?: Array<{
    opponentId: number
    wins: number
    losses: number
    draws: number
    lastPlayedAt: string | null
  }>
  checkedIn?: boolean
  lastResult?: {
    opponentId: number; opponentName: string; outcome: 'win' | 'loss' | 'draw'; finishedAt: string
  } | null
  assignedGame?: {
    id: number; tableNumber: number; startedAt: string | null; eventId: number | null
    opponent?: { id: number; name: string } | null
  } | null
}

function startedAgo(startedAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000))
  if (minutes === 0) return 'just now'
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
  if (minutes < 60) return formatter.format(-minutes, 'minute')
  if (minutes < 1440) return formatter.format(-Math.floor(minutes / 60), 'hour')
  return formatter.format(-Math.floor(minutes / 1440), 'day')
}

export function PlayerMatchupSummary({ player, opponent }: {
  player: MatchupPlayer
  opponent?: { id: number; name: string } | null
}) {
  const matchup = player.headToHead?.find((record) => record.opponentId === opponent?.id)
  const assignedGame = player.assignedGame
  const hasMatchup = matchup && opponent
  const hasActivity = assignedGame || player.lastResult !== undefined
  return (
    <>
      <span className="seat-player-summary">
        <span>{player.name}</span>{' '}
        <span className="player-rating">{player.currentRating}</span>
        {hasMatchup && <span>{` (vs. ${opponent.name} ${matchup.wins}-${matchup.losses}-${matchup.draws})`}</span>}
      </span>
      {(hasMatchup || hasActivity) && <small className="seat-player-context">
        {hasMatchup && <>
          Last Played: {matchup.lastPlayedAt
            ? <time dateTime={matchup.lastPlayedAt}>{new Date(matchup.lastPlayedAt).toLocaleDateString()}</time>
            : 'Never'}
          {hasActivity && ' · '}
        </>}
        {assignedGame ? <>
          Playing {assignedGame.opponent?.name ?? `at Table ${assignedGame.tableNumber}`} · {assignedGame.startedAt
            ? <>started <time dateTime={assignedGame.startedAt}>{startedAgo(assignedGame.startedAt)}</time></>
            : 'not started'}
        </> : player.lastResult ? <>
          Last Result: {player.lastResult.outcome === 'win' ? 'Won against'
            : player.lastResult.outcome === 'loss' ? 'Lost to' : 'Drew with'} {player.lastResult.opponentName}
        </> : player.lastResult === null ? 'Last Result: No completed games' : null}
      </small>}
    </>
  )
}
