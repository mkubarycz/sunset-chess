import { describe, expect, it } from 'vitest'
import type { OngoingGame } from './App'
import {
  featuredFirst,
  mergeCheckedInGame,
  retainFeaturedGame,
  type GameIdentity,
} from './gamePresentation'

const game = (id: number): OngoingGame => ({
  id,
  tableNumber: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  result: null,
  blackPlayerId: null,
  whitePlayerId: null,
  blackPlayer: null,
  whitePlayer: null,
})

describe('game presentation ordering', () => {
  it('moves only the featured game first while preserving stable server order', () => {
    const games = [game(1), game(2), game(3), game(4)]
    expect(featuredFirst(games, games[2]).map(({ id }) => id)).toEqual([3, 1, 2, 4])
    expect(featuredFirst(games, games[1]).map(({ id }) => id)).toEqual([2, 1, 3, 4])
    expect(games.map(({ id }) => id)).toEqual([1, 2, 3, 4])
  })

  it('falls back to deterministic order and clears a deleted feature', () => {
    const games = [game(2), game(1)]
    const missing = game(99)
    expect(featuredFirst(games, missing).map(({ id }) => id)).toEqual([2, 1])
    expect(featuredFirst(games, null).map(({ id }) => id)).toEqual([2, 1])
    expect(retainFeaturedGame(games, missing)).toBeNull()
  })

  it('does not promote a reused ID but retains the exact id and creation pair', () => {
    const original = game(1)
    const identity: GameIdentity = { id: original.id, createdAt: original.createdAt }
    const reused = { ...original, createdAt: '2026-02-01T00:00:00.000Z' }
    const games = [game(2), reused]
    expect(featuredFirst(games, identity).map(({ id }) => id)).toEqual([2, 1])
    expect(retainFeaturedGame(games, identity)).toBeNull()
    expect(retainFeaturedGame([game(2), original], identity)).toEqual(identity)
  })

  it('optimistically inserts and replaces check-in games without mutating input', () => {
    const original = [game(1), game(2)]
    const updated = { ...game(2), tableNumber: 8 }
    expect(mergeCheckedInGame(original, updated).map(({ tableNumber }) => tableNumber)).toEqual([1, 8])
    expect(mergeCheckedInGame(original, game(3)).map(({ id }) => id)).toEqual([1, 2, 3])
    expect(original.map(({ tableNumber }) => tableNumber)).toEqual([1, 2])
  })
})
