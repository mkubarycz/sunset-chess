export const PLAYER_ID_MIN = 1000
export const PLAYER_ID_MAX = 2000
export const PLAYER_NAME_MAX_LENGTH = 80

export interface PlayerPayload {
  v: 1
  kind: 'player'
  playerId: number
  name: string
}

export interface PlayerReferencePayload {
  v: 1
  kind: 'player-reference'
  playerId: number
}

export type ParsedQrPayload =
  | { kind: 'player'; player: PlayerPayload; label: string }
  | { kind: 'player-reference'; reference: PlayerReferencePayload; label: string }
  | { kind: 'raw'; value: string; label: string }

export type RandomUint32 = () => number

export function cryptoUint32(): number {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return value[0]
}

export function uniformInteger(
  minimum: number,
  maximum: number,
  randomUint32: RandomUint32 = cryptoUint32,
): number {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new RangeError('Invalid integer range')
  }
  const range = maximum - minimum + 1
  if (range > 0x1_0000_0000) throw new RangeError('Range is too large')
  const limit = Math.floor(0x1_0000_0000 / range) * range
  let value: number
  do {
    value = randomUint32()
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new RangeError('Random source must return an unsigned 32-bit integer')
    }
  } while (value >= limit)
  return minimum + (value % range)
}

export function normalizePlayerName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('Enter a player name.')
  if (normalized.length > PLAYER_NAME_MAX_LENGTH) {
    throw new Error(`Name must be ${PLAYER_NAME_MAX_LENGTH} characters or fewer.`)
  }
  return normalized
}

export function createPlayerPayload(
  name: string,
  randomUint32: RandomUint32 = cryptoUint32,
): PlayerPayload {
  return {
    v: 1,
    kind: 'player',
    playerId: uniformInteger(PLAYER_ID_MIN, PLAYER_ID_MAX, randomUint32),
    name: normalizePlayerName(name),
  }
}

export function encodePlayerPayload(player: PlayerPayload): string {
  validatePlayer(player)
  return JSON.stringify({
    v: 1,
    kind: 'player',
    playerId: player.playerId,
    name: player.name,
  })
}

export function encodePlayerReference(playerId: number): string {
  if (!Number.isInteger(playerId) || playerId < PLAYER_ID_MIN || playerId > PLAYER_ID_MAX) {
    throw new Error('Invalid player reference')
  }
  return `SC1:${playerId.toString(36).toUpperCase()}`
}

function validatePlayer(value: unknown): asserts value is PlayerPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid player payload')
  const candidate = value as Record<string, unknown>
  if (
    candidate.v !== 1
    || candidate.kind !== 'player'
    || !Number.isInteger(candidate.playerId)
    || (candidate.playerId as number) < PLAYER_ID_MIN
    || (candidate.playerId as number) > PLAYER_ID_MAX
    || typeof candidate.name !== 'string'
    || candidate.name !== candidate.name.trim()
    || candidate.name.length === 0
    || candidate.name.length > PLAYER_NAME_MAX_LENGTH
  ) {
    throw new Error('Invalid player payload')
  }
}

export function truncateRawPayload(value: string, maximum = 72): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, Math.max(1, maximum - 1))}…`
}

export function parseQrPayload(value: string): ParsedQrPayload {
  const compactMatch = /^SC1:([0-9A-Z]+)$/.exec(value)
  if (compactMatch) {
    const playerId = Number.parseInt(compactMatch[1], 36)
    if (
      Number.isSafeInteger(playerId)
      && playerId >= PLAYER_ID_MIN
      && playerId <= PLAYER_ID_MAX
      && encodePlayerReference(playerId) === value
    ) {
      return {
        kind: 'player-reference',
        reference: { v: 1, kind: 'player-reference', playerId },
        label: `Player #${playerId} · resolving…`,
      }
    }
  }
  try {
    const parsed: unknown = JSON.parse(value)
    validatePlayer(parsed)
    return { kind: 'player', player: parsed, label: `${parsed.name} · #${parsed.playerId}` }
  } catch {
    return { kind: 'raw', value, label: truncateRawPayload(value) }
  }
}
