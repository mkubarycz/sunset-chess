import type { OngoingGame } from './GameCard'

export type GameIdentity = Pick<OngoingGame, 'id' | 'createdAt'>

export function isSameGame(
  game: GameIdentity,
  identity: GameIdentity,
): boolean {
  return game.id === identity.id && game.createdAt === identity.createdAt
}

export function gameIdentityKey(identity: GameIdentity): string {
  return `${identity.id}\u0000${identity.createdAt}`
}

export function retainFeaturedGame(
  games: readonly OngoingGame[],
  featuredGame: GameIdentity | null,
): GameIdentity | null {
  return featuredGame && games.some((game) => isSameGame(game, featuredGame))
    ? featuredGame
    : null
}

export function featuredFirst(
  games: readonly OngoingGame[],
  featuredGame: GameIdentity | null,
): OngoingGame[] {
  if (featuredGame === null) return [...games]
  const featuredIndex = games.findIndex((game) => isSameGame(game, featuredGame))
  if (featuredIndex <= 0) return [...games]
  return [
    games[featuredIndex],
    ...games.slice(0, featuredIndex),
    ...games.slice(featuredIndex + 1),
  ]
}

export function mergeCheckedInGame(
  games: readonly OngoingGame[],
  checkedInGame: OngoingGame,
): OngoingGame[] {
  const existingIndex = games.findIndex((game) => game.id === checkedInGame.id)
  if (existingIndex < 0) return [...games, checkedInGame]
  return games.map((game, index) => index === existingIndex ? checkedInGame : game)
}
