import type { CSSProperties } from 'react'

export interface OngoingGame {
  id: number
  tableNumber: number
  createdAt: string
  blackPlayerId: number | null
  whitePlayerId: number | null
  finishedAt: string | null
  result: '1-0' | '0-1' | '1/2-1/2' | null
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
}: {
  side: 'black' | 'white'
  player: OngoingGame['blackPlayer']
  result: OngoingGame['result']
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
}: {
  game: OngoingGame
  className?: string
  cardRef?: (element: HTMLElement | null) => void
  ariaLabel?: string
  width?: CSSProperties['width']
  height?: CSSProperties['height']
}) {
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
      <h3>Table {game.tableNumber}</h3>
      {game.result && (
        <p className="game-result">
          {game.result === '1/2-1/2' ? 'Draw' : game.result === '1-0' ? 'White wins' : 'Black wins'}
          <span>{game.result}</span>
        </p>
      )}
      <PlayerSide side="black" player={game.blackPlayer} result={game.result} />
      <MiniBoard />
      <PlayerSide side="white" player={game.whitePlayer} result={game.result} />
    </article>
  )
}
