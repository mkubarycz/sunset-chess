import type { OngoingGame } from './GameCard'

export const RESULT_ACKNOWLEDGEMENT_MS = 3_000

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`
}

export function formatResultAcknowledgement(game: OngoingGame): string {
  const white = game.whitePlayer
  const black = game.blackPlayer
  const whiteDelta = game.whiteRatingDelta
  const blackDelta = game.blackRatingDelta
  if (!white || !black || whiteDelta == null || blackDelta == null || game.result === null) {
    throw new Error('Completed game is missing authoritative ratings or rating deltas.')
  }
  const whiteText = `${white.name} ${white.rating}(${signed(whiteDelta)})`
  const blackText = `${black.name} ${black.rating}(${signed(blackDelta)})`
  if (game.result === '1/2-1/2') return `${whiteText} drew ${blackText}`
  return game.result === '1-0'
    ? `${whiteText} def. ${blackText}`
    : `${blackText} def. ${whiteText}`
}

export function findAuthoritativeResult(
  gameId: number,
  returnedGame: OngoingGame | null | void,
  recentGames: readonly OngoingGame[],
): OngoingGame | null {
  if (returnedGame?.id === gameId && returnedGame.result !== null) return returnedGame
  return recentGames.find((game) => game.id === gameId && game.result !== null) ?? null
}
