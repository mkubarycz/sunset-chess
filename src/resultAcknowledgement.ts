import type { OngoingGame } from './GameCard'

export const RESULT_ACKNOWLEDGEMENT_MS = 3_000

export interface FormattedResultAcknowledgement {
  first: string
  connector: 'def.' | 'DRAW'
  second: string
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`
}

export function formatResultAcknowledgement(game: OngoingGame): FormattedResultAcknowledgement {
  const white = game.whitePlayer
  const black = game.blackPlayer
  const whiteDelta = game.whiteRatingDelta
  const blackDelta = game.blackRatingDelta
  if (!white || !black || whiteDelta == null || blackDelta == null || game.result === null) {
    throw new Error('Completed game is missing authoritative ratings or rating deltas.')
  }
  const whiteText = `${white.name} ${white.rating}(${signed(whiteDelta)})`
  const blackText = `${black.name} ${black.rating}(${signed(blackDelta)})`
  if (game.result === '1/2-1/2') {
    return { first: whiteText, connector: 'DRAW', second: blackText }
  }
  return game.result === '1-0'
    ? { first: whiteText, connector: 'def.', second: blackText }
    : { first: blackText, connector: 'def.', second: whiteText }
}

export function formatResultNotice(game: OngoingGame): string {
  const white = game.whitePlayer
  const black = game.blackPlayer
  if (!white || !black || game.result === null) {
    throw new Error('Completed game is missing players or a result.')
  }
  if (game.result === '1/2-1/2') return `${white.name} DRAW ${black.name}`
  return game.result === '1-0'
    ? `${white.name} def. ${black.name}`
    : `${black.name} def. ${white.name}`
}

export function findAuthoritativeResult(
  gameId: number,
  returnedGame: OngoingGame | null | void,
  recentGames: readonly OngoingGame[],
): OngoingGame | null {
  if (returnedGame?.id === gameId && returnedGame.result !== null) return returnedGame
  return recentGames.find((game) => game.id === gameId && game.result !== null) ?? null
}
