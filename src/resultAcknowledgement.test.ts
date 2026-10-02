import { describe, expect, it } from 'vitest'
import type { OngoingGame } from './GameCard'
import {
  findAuthoritativeResult,
  formatResultAcknowledgement,
  formatResultNotice,
  RESULT_ACKNOWLEDGEMENT_MS,
} from './resultAcknowledgement'

function completed(result: OngoingGame['result'] = '1-0'): OngoingGame {
  return {
    id: 7,
    tableNumber: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T01:00:00.000Z',
    result,
    blackPlayerId: 2,
    whitePlayerId: 1,
    whitePlayer: { id: 1, name: 'White Bishop', rating: 707 },
    blackPlayer: { id: 2, name: 'Black Knight', rating: 698 },
    whiteRatingDelta: result === '1/2-1/2' ? 2 : 14,
    blackRatingDelta: result === '1/2-1/2' ? -2 : -14,
  }
}

describe('result acknowledgement', () => {
  it('formats decisive and draw summaries from authoritative post-result values', () => {
    expect(formatResultAcknowledgement(completed()))
      .toBe('White Bishop 707(+14) def. Black Knight 698(-14)')
    expect(formatResultAcknowledgement(completed('1/2-1/2')))
      .toBe('White Bishop 707(+2) DRAW Black Knight 698(-2)')
    expect(formatResultAcknowledgement({
      ...completed('0-1'),
      whiteRatingDelta: -14,
      blackRatingDelta: 14,
    })).toBe('Black Knight 698(+14) def. White Bishop 707(-14)')
    expect(RESULT_ACKNOWLEDGEMENT_MS).toBe(3_000)
  })

  it('formats concise result activity messages', () => {
    expect(formatResultNotice(completed())).toBe('White Bishop def. Black Knight')
    expect(formatResultNotice(completed('1/2-1/2'))).toBe('White Bishop DRAW Black Knight')
    expect(formatResultNotice(completed('0-1'))).toBe('Black Knight def. White Bishop')
  })

  it('prefers the returned authoritative game and otherwise uses the matching refresh only', () => {
    const returned = completed()
    const refreshed = { ...completed(), whitePlayer: { id: 1, name: 'Refreshed', rating: 708 } }
    expect(findAuthoritativeResult(7, returned, [refreshed])).toBe(returned)
    expect(findAuthoritativeResult(7, undefined, [refreshed])).toBe(refreshed)
    expect(findAuthoritativeResult(8, returned, [refreshed])).toBeNull()
  })

  it('rejects incomplete data rather than guessing Elo changes', () => {
    expect(() => formatResultAcknowledgement({
      ...completed(),
      whiteRatingDelta: null,
    })).toThrow(/authoritative ratings/)
  })
})
