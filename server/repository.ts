import type { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { ConflictError, NotFoundError, StartedGameError, ValidationError } from './errors.js';
import { calculateElo, INITIAL_RATING } from './ratings.js';

export interface PlayerResource {
  id: number;
  name: string;
  rating: number;
  scanningIdentifier: string | null;
}
export type Player = PlayerResource;

export type GameResult = '1-0' | '0-1' | '1/2-1/2';
export type PairingMode = 'club-session-pairing-1';
type PairingCohortCode = 'A' | 'B' | 'C' | 'D';

export interface GameResource {
  id: number;
  tableNumber: number;
  createdAt: string;
  startedAt: string | null;
  blackPlayerId: number | null;
  whitePlayerId: number | null;
  finishedAt: string | null;
  result: GameResult | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  eventId: number | null;
}
export type ChessGame = GameResource;

export interface JoinedChessGame extends GameResource {
  canCancel: boolean;
  blackPlayer: Omit<PlayerResource, 'scanningIdentifier'> | null;
  whitePlayer: Omit<PlayerResource, 'scanningIdentifier'> | null;
  blackStartingRating: number | null;
  whiteStartingRating: number | null;
  blackRatingDelta: number | null;
  whiteRatingDelta: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  cohort?: PairingCohortCode | null;
  id: number;
  name: string;
  currentRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastPlayedAt: string | null;
  checkInStatus: 'not-checked-in' | 'waiting' | 'paired' | 'playing' | 'available' | 'checked-out';
  tableNumber: number | null;
  opponentName: string | null;
  sessionGamesPlayed: number;
  sessionWins: number;
  sessionLosses: number;
  sessionDraws: number;
  scanningIdentifier: string | null;
}

export interface ClubSession {
  id: number;
  type: 'club-session';
  name: string;
  createdAt: string;
  closedAt: string | null;
  deletedAt: string | null;
  active: boolean;
  playerCount: number;
  gameCount: number;
  activeGameCount: number;
  pairingMode: PairingMode;
}

export interface RatingEvent {
  id: number;
  gameId: number | null;
  previousRating: number;
  rating: number;
  delta: number;
  recordedAt: string;
  reason: 'baseline' | 'game' | 'migration' | 'compensation';
  opponentId: number | null;
  result: GameResult | null;
}

export interface PairingCohort {
  eventId: number;
  playerId: number;
  cohort: PairingCohortCode;
  snapshotRating: number;
}

export interface PlayerProfile extends LeaderboardEntry {
  ongoingGames: JoinedChessGame[];
  recentGames: Array<{
    id: number;
    tableNumber: number;
    opponent: { id: number; name: string; rating: number; delta: number };
    color: 'black' | 'white';
    result: GameResult;
    outcome: 'W' | 'L' | 'D';
    finishedAt: string;
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
  }>;
  ratingHistory: Array<RatingEvent & {
    opponentName: string | null;
    opponentRatingBefore: number | null;
    opponentDelta: number | null;
    outcome: 'win' | 'draw' | 'loss' | null;
  }>;
}

export type RandomIndex = (maxExclusive: number) => number;
export type CheckInSide = 'black' | 'white';
export interface CheckIn {
  id: number;
  eventId: number | null;
  playerId: number;
  checkedInAt: string;
  checkedOutAt: string | null;
  gameId: number | null;
  placement: 'paired' | 'waiting' | 'already-checked-in' | null;
  side: CheckInSide | null;
}
export type CheckInResult = {
  status: 'paired' | 'waiting' | 'already-checked-in';
  game: JoinedChessGame;
  side: CheckInSide;
  checkIn: CheckIn;
};
export type GameResourceUpdate = {
  swapSides?: boolean;
  blackPlayerId?: number | null;
  whitePlayerId?: number | null;
  result?: GameResult;
  cancel?: boolean;
  cancellationReason?: string;
  start?: boolean;
  overrideStarted?: boolean;
};

function playerRow(row: unknown): PlayerResource {
  return row as PlayerResource;
}

function gameRow(row: unknown): GameResource {
  return row as GameResource;
}

function validateSessionName(rawName: string): string {
  const name = rawName.trim();
  if (!name || name.length > 120) {
    throw new ValidationError('Club session name must contain 1 to 120 characters.');
  }
  return name;
}

function sqliteMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validatePlayerInput(id: number, rawName: string): string {
  const name = rawName.trim();
  if (!Number.isInteger(id) || id < 1000 || id > 2000) {
    throw new ValidationError('Player id must be between 1000 and 2000.');
  }

  if (!name || name.length > 80) throw new ValidationError('Player name must contain 1 to 80 characters.');
  return name;
}

function validateScanningIdentifier(value: string): string {
  if (value.length < 1 || value.length > 2048) {
    throw new ValidationError('Scanning identifier must contain 1 to 2048 characters.');
  }
  return value;
}

export class ChessRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly randomIndex: RandomIndex = randomInt,
  ) {}

  listClubSessions(): ClubSession[] {
    return (this.db.prepare(`
      SELECT e.id, e.type, e.name, e.createdAt, e.closedAt, e.deletedAt, e.active, e.pairingMode,
        COUNT(DISTINCT ep.playerId) AS playerCount,
        COUNT(DISTINCT g.id) AS gameCount,
        COUNT(DISTINCT CASE
          WHEN g.result IS NULL AND g.cancelledAt IS NULL THEN g.id
        END) AS activeGameCount
      FROM ClubSessionResource AS e
      LEFT JOIN CheckInResource AS ep ON ep.eventId = e.id
      LEFT JOIN GameResource AS g ON g.eventId = e.id
      WHERE e.type = 'club-session' AND e.deletedAt IS NULL
      GROUP BY e.id
      ORDER BY e.active DESC, e.createdAt DESC, e.id DESC
    `).all() as unknown as Array<Omit<ClubSession, 'active'> & { active: number }>)
      .map((session) => ({ ...session, active: session.active === 1 }));
  }

  listCheckIns(eventId?: number, playerId?: number): CheckIn[] {
    const conditions: string[] = [];
    const parameters: number[] = [];
    if (eventId !== undefined) {
      conditions.push('eventId = ?');
      parameters.push(eventId);
    }
    if (playerId !== undefined) {
      conditions.push('playerId = ?');
      parameters.push(playerId);
    }
    return this.db.prepare(`
      SELECT id, eventId, playerId, checkedInAt, checkedOutAt, gameId, placement, side
      FROM CheckInResource
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY checkedInAt DESC, id DESC
    `).all(...parameters) as unknown as CheckIn[];
  }

  getCheckIn(id: number): CheckIn {
    const checkIn = this.db.prepare(`
      SELECT id, eventId, playerId, checkedInAt, checkedOutAt, gameId, placement, side
      FROM CheckInResource WHERE id = ?
    `).get(id) as unknown as CheckIn | undefined;
    if (!checkIn) throw new NotFoundError(`Check-in ${id} was not found.`);
    return checkIn;
  }

  getActiveClubSession(): ClubSession | null {
    return this.listClubSessions().find((session) => session.active) ?? null;
  }

  getClubSession(id: number): ClubSession {
    const session = this.listClubSessions().find((candidate) => candidate.id === id);
    if (!session) throw new NotFoundError(`Club session ${id} was not found.`);
    return session;
  }

  softDeleteClubSession(id: number, now = () => new Date().toISOString()): ClubSession {
    const deletedAt = now();
    if (typeof deletedAt !== 'string' || Number.isNaN(Date.parse(deletedAt))) {
      throw new Error('Clock source returned an invalid ISO timestamp.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const session = this.getClubSession(id);
      if (session.playerCount !== 0 || session.gameCount !== 0) {
        throw new ConflictError('Only a session with zero check-ins and zero games can be deleted.');
      }
      const closedAt = session.closedAt ?? deletedAt;
      this.db.prepare(`
        UPDATE ClubSessionResource SET deletedAt = ?, active = 0, closedAt = ? WHERE id = ?
      `).run(deletedAt, closedAt, id);
      this.db.exec('COMMIT');
      return { ...session, active: false, closedAt, deletedAt };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listRatingEvents(playerId?: number): Array<RatingEvent & { playerId: number }> {
    return this.db.prepare(`
      SELECT id, playerId, gameId, previousRating, rating, delta, recordedAt,
             reason, opponentId, result
      FROM RatingEventResource
      ${playerId === undefined ? '' : 'WHERE playerId = ?'}
      ORDER BY recordedAt ASC, id ASC
    `).all(...(playerId === undefined ? [] : [playerId])) as unknown as
      Array<RatingEvent & { playerId: number }>;
  }

  getRatingEvent(id: number): RatingEvent & { playerId: number } {
    const event = this.listRatingEvents().find((candidate) => candidate.id === id);
    if (!event) throw new NotFoundError(`Rating event ${id} was not found.`);
    return event;
  }

  listPairingCohorts(eventId?: number, playerId?: number): PairingCohort[] {
    const conditions: string[] = [
      'eventId IN (SELECT id FROM ClubSessionResource WHERE deletedAt IS NULL)',
    ];
    const parameters: number[] = [];
    if (eventId !== undefined) {
      conditions.push('eventId = ?');
      parameters.push(eventId);
    }
    if (playerId !== undefined) {
      conditions.push('playerId = ?');
      parameters.push(playerId);
    }
    return this.db.prepare(`
      SELECT eventId, playerId, cohort, snapshotRating
      FROM PairingCohortResource
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY eventId, cohort, snapshotRating DESC, playerId
    `).all(...parameters) as unknown as PairingCohort[];
  }

  createClubSession(
    rawName?: string,
    now: () => string = () => new Date().toISOString(),
  ): ClubSession {
    const createdAt = now();
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
      throw new Error('Clock source returned an invalid ISO timestamp.');
    }
    const defaultName = `${new Date(createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} Club Session`;
    const name = validateSessionName(rawName ?? defaultName);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT 1 FROM ClubSessionResource WHERE active = 1').get()) {
        throw new ConflictError('Close the active Club Session before creating another one.');
      }
      const result = this.db.prepare(`
        INSERT INTO ClubSessionResource(type, name, createdAt, active, pairingMode)
        VALUES ('club-session', ?, ?, 1, 'club-session-pairing-1')
      `).run(name, createdAt);
      const eventId = Number(result.lastInsertRowid);
      this.db.prepare(`
        INSERT INTO PairingCohortResource(eventId, playerId, cohort, snapshotRating)
        SELECT ?, id,
          CASE NTILE(4) OVER (ORDER BY rating DESC, id ASC)
            WHEN 1 THEN 'A' WHEN 2 THEN 'B' WHEN 3 THEN 'C' ELSE 'D'
          END,
          rating
        FROM PlayerResource
        ORDER BY rating DESC, id ASC
      `).run(eventId);
      const session = this.listClubSessions().find(({ id }) => id === eventId);
      if (!session) throw new Error('Created club session disappeared.');
      this.db.exec('COMMIT');
      return session;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateClubSessionName(id: number, rawName: string): ClubSession {
    const name = validateSessionName(rawName);
    const result = this.db.prepare(`
      UPDATE ClubSessionResource SET name = ?
      WHERE id = ? AND type = 'club-session' AND deletedAt IS NULL
    `).run(name, id);
    if (result.changes === 0) throw new NotFoundError(`Club session ${id} was not found.`);
    const session = this.listClubSessions().find((candidate) => candidate.id === id);
    if (!session) throw new Error(`Club session ${id} disappeared after update.`);
    return session;
  }

  updateClubSessionPairingMode(id: number, pairingMode: PairingMode): ClubSession {
    if (pairingMode !== 'club-session-pairing-1') {
      throw new ValidationError('Pairing mode must be club-session-pairing-1.');
    }
    const result = this.db.prepare(`
      UPDATE ClubSessionResource SET pairingMode = ?
      WHERE id = ? AND type = 'club-session' AND deletedAt IS NULL
    `).run(pairingMode, id);
    if (result.changes === 0) throw new NotFoundError(`Club session ${id} was not found.`);
    const session = this.listClubSessions().find((candidate) => candidate.id === id);
    if (!session) throw new Error(`Club session ${id} disappeared after update.`);
    return session;
  }

  closeClubSession(
    id: number,
    resolution: 'draw' | 'cancel',
    now: () => string = () => new Date().toISOString(),
  ): ClubSession {
    if (resolution !== 'draw' && resolution !== 'cancel') {
      throw new ValidationError('Session resolution must be draw or cancel.');
    }
    const closedAt = now();
    if (typeof closedAt !== 'string' || Number.isNaN(Date.parse(closedAt))) {
      throw new Error('Clock source returned an invalid ISO timestamp.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const session = this.db.prepare(`
        SELECT id, active FROM ClubSessionResource
        WHERE id = ? AND type = 'club-session' AND deletedAt IS NULL
      `).get(id) as { id: number; active: number } | undefined;
      if (!session) throw new NotFoundError(`Club session ${id} was not found.`);
      if (session.active !== 1) throw new ConflictError(`Club session ${id} is already closed.`);
      const games = this.db.prepare(`
        SELECT id, blackPlayerId, whitePlayerId
        FROM GameResource
        WHERE eventId = ? AND result IS NULL AND cancelledAt IS NULL
        ORDER BY tableNumber, id
      `).all(id) as unknown as Array<{
        id: number; blackPlayerId: number | null; whitePlayerId: number | null
      }>;
      for (const game of games) {
        if (resolution === 'cancel' || game.blackPlayerId === null || game.whitePlayerId === null) {
          this.db.prepare('DELETE FROM GameResource WHERE id = ?').run(game.id);
        } else {
          this.finalizeGameInTransaction(game.id, '1/2-1/2', closedAt, false);
        }
      }
      this.db.prepare(`
        UPDATE ClubSessionResource SET active = 0, closedAt = ? WHERE id = ? AND active = 1
      `).run(closedAt, id);
      this.db.prepare(`
        UPDATE CheckInResource
        SET checkedOutAt = COALESCE(checkedOutAt, ?), gameId = NULL, placement = NULL, side = NULL
        WHERE eventId = ?
      `).run(closedAt, id);
      const closed = this.listClubSessions().find((candidate) => candidate.id === id);
      if (!closed) throw new Error(`Club session ${id} disappeared after close.`);
      this.db.exec('COMMIT');
      return closed;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listPlayers(): PlayerResource[] {
    this.assertRatingProjectionIntegrity();
    return this.db.prepare(`
      SELECT p.id, p.name, p.scanningIdentifier, COALESCE((
        SELECT rating FROM RatingEventResource
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS rating
      FROM PlayerResource p ORDER BY p.id
    `).all().map(playerRow);
  }

  listSeatOptions(gameId: number) {
    const game = this.getGame(gameId);
    if (game.result !== null || game.cancelledAt !== null) {
      throw new ConflictError('Player options are available only for an ongoing game.');
    }
    const activeGames = this.listGames().filter((candidate) => !candidate.result && !candidate.cancelledAt);
    const attendance = this.listCheckIns(game.eventId ?? undefined);
    const checkedIn = new Set(attendance.filter((entry) => entry.checkedOutAt === null).map(({ playerId }) => playerId));
    const checkedOut = new Set(game.eventId === null ? []
      : attendance.filter((entry) => entry.checkedOutAt !== null).map(({ playerId }) => playerId));
    const cohorts = new Map(game.eventId === null ? []
      : this.listPairingCohorts(game.eventId).map(({ playerId, cohort }) => [playerId, cohort]));
    const opponents = [game.blackPlayerId, game.whitePlayerId].filter((id): id is number => id !== null);
    const placeholders = opponents.map(() => '?').join(', ');
    const history = opponents.length === 0 ? [] : this.db.prepare(`
      WITH encounters AS (
        SELECT blackPlayerId AS playerId, whitePlayerId AS opponentId,
          CASE WHEN result = '0-1' THEN 1 ELSE 0 END AS wins,
          CASE WHEN result = '1-0' THEN 1 ELSE 0 END AS losses,
          CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END AS draws,
          finishedAt
        FROM GameResource
        WHERE result IS NOT NULL AND cancelledAt IS NULL
          AND whitePlayerId IN (${placeholders})
        UNION ALL
        SELECT whitePlayerId AS playerId, blackPlayerId AS opponentId,
          CASE WHEN result = '1-0' THEN 1 ELSE 0 END AS wins,
          CASE WHEN result = '0-1' THEN 1 ELSE 0 END AS losses,
          CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END AS draws,
          finishedAt
        FROM GameResource
        WHERE result IS NOT NULL AND cancelledAt IS NULL
          AND blackPlayerId IN (${placeholders})
      )
      SELECT playerId, opponentId, SUM(wins) AS wins, SUM(losses) AS losses,
        SUM(draws) AS draws, MAX(finishedAt) AS lastPlayedAt
      FROM encounters GROUP BY playerId, opponentId
    `).all(...opponents, ...opponents) as Array<{
      playerId: number; opponentId: number; wins: number; losses: number;
      draws: number; lastPlayedAt: string | null;
    }>;
    const matchups = new Map(history.map((record) => [`${record.playerId}:${record.opponentId}`, record]));
    const latestResults = this.db.prepare(`
      WITH outcomes AS (
        SELECT id AS gameId, blackPlayerId AS playerId, whitePlayerId AS opponentId,
          CASE result WHEN '0-1' THEN 'win' WHEN '1-0' THEN 'loss' ELSE 'draw' END AS outcome,
          finishedAt
        FROM GameResource WHERE result IS NOT NULL AND cancelledAt IS NULL
        UNION ALL
        SELECT id AS gameId, whitePlayerId AS playerId, blackPlayerId AS opponentId,
          CASE result WHEN '1-0' THEN 'win' WHEN '0-1' THEN 'loss' ELSE 'draw' END AS outcome,
          finishedAt
        FROM GameResource WHERE result IS NOT NULL AND cancelledAt IS NULL
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY playerId ORDER BY finishedAt DESC, gameId DESC
        ) AS position FROM outcomes
      )
      SELECT r.playerId, r.opponentId, p.name AS opponentName, r.outcome, r.finishedAt
      FROM ranked r JOIN PlayerResource p ON p.id = r.opponentId WHERE r.position = 1
    `).all() as Array<{
      playerId: number; opponentId: number; opponentName: string;
      outcome: 'win' | 'loss' | 'draw'; finishedAt: string;
    }>;
    const lastResults = new Map(latestResults.map(({ playerId, ...result }) => [playerId, result]));
    const players = this.listPlayers();
    const playersById = new Map(players.map((player) => [player.id, player]));
    return players.filter((player) => !checkedOut.has(player.id)).map((player) => {
      const assigned = activeGames.find((candidate) =>
        candidate.blackPlayerId === player.id || candidate.whitePlayerId === player.id);
      const assignedOpponentId = assigned?.blackPlayerId === player.id
        ? assigned.whitePlayerId : assigned?.blackPlayerId;
      const assignedOpponent = assignedOpponentId == null ? null : playersById.get(assignedOpponentId);
      return {
        id: player.id,
        name: player.name,
        currentRating: player.rating,
        cohort: cohorts.get(player.id) ?? null,
        headToHead: opponents.map((opponentId) => {
          const record = matchups.get(`${player.id}:${opponentId}`);
          return {
            opponentId, wins: record?.wins ?? 0, losses: record?.losses ?? 0,
            draws: record?.draws ?? 0, lastPlayedAt: record?.lastPlayedAt ?? null,
          };
        }),
        checkedIn: checkedIn.has(player.id),
        lastResult: lastResults.get(player.id) ?? null,
        assignedGame: assigned ? {
          id: assigned.id, tableNumber: assigned.tableNumber,
          startedAt: assigned.startedAt, eventId: assigned.eventId,
          opponent: assignedOpponent ? { id: assignedOpponent.id, name: assignedOpponent.name } : null,
        } : null,
      };
    });
  }

  getPlayer(id: number): PlayerResource {
    const row = this.db.prepare(`
      SELECT p.id, p.name, p.scanningIdentifier, p.rating AS cachedRating, COALESCE((
        SELECT rating FROM RatingEventResource
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS rating
      FROM PlayerResource p WHERE p.id = ?
    `).get(id) as unknown as (PlayerResource & { cachedRating: number }) | undefined;
    if (!row) throw new NotFoundError(`Player ${id} was not found.`);
    if (row.cachedRating !== row.rating) {
      throw new Error(`Rating projection divergence for player ${id}: cache ${row.cachedRating}, ledger ${row.rating}.`);
    }
    return {
      id: row.id,
      name: row.name,
      rating: row.rating,
      scanningIdentifier: row.scanningIdentifier,
    };
  }

  getPlayerByScanningIdentifier(scanningIdentifier: string): PlayerResource {
    const identifier = validateScanningIdentifier(scanningIdentifier);
    const row = this.db.prepare(`
      SELECT id
      FROM PlayerResource
      WHERE scanningIdentifier = ?
        OR (scanningIdentifier IS NULL AND CAST(id AS TEXT) = ?)
      LIMIT 1
    `).get(identifier, identifier) as { id: number } | undefined;
    if (!row) {
      throw new NotFoundError(`No player is assigned to scanning identifier ${identifier}.`);
    }
    return this.getPlayer(row.id);
  }

  assignPlayerScanningIdentifier(
    id: number,
    scanningIdentifier: string,
    transfer = false,
  ): { player: PlayerResource; previousOwner: PlayerResource | null } {
    const identifier = validateScanningIdentifier(scanningIdentifier);
    const player = this.getPlayer(id);
    let previousOwner: PlayerResource | null = null;
    try {
      previousOwner = this.getPlayerByScanningIdentifier(identifier);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }

    if (previousOwner?.id === id) return { player, previousOwner: null };
    if (previousOwner && !transfer) {
      throw new ConflictError(
        `Scanning identifier is already assigned to ${previousOwner.name}.`,
      );
    }

    const previousIdentifier = player.scanningIdentifier ?? String(player.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (previousOwner) {
        const temporaryIdentifier = `transfer:${crypto.randomUUID()}`;
        this.db.prepare(`
          UPDATE PlayerResource SET scanningIdentifier = ? WHERE id = ?
        `).run(temporaryIdentifier, previousOwner.id);
        this.db.prepare(`
          UPDATE PlayerResource SET scanningIdentifier = ? WHERE id = ?
        `).run(identifier, id);
        this.db.prepare(`
          UPDATE PlayerResource SET scanningIdentifier = ? WHERE id = ?
        `).run(previousIdentifier, previousOwner.id);
      } else {
        this.db.prepare(`
          UPDATE PlayerResource SET scanningIdentifier = ? WHERE id = ?
        `).run(identifier, id);
      }
      const updated = this.getPlayer(id);
      const updatedPreviousOwner = previousOwner ? this.getPlayer(previousOwner.id) : null;
      this.db.exec('COMMIT');
      return { player: updated, previousOwner: updatedPreviousOwner };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('UNIQUE constraint failed')) {
        throw new ConflictError('Scanning identifier is already assigned to another player.');
      }
      throw error;
    }
  }

  clearPlayerScanningIdentifier(id: number): PlayerResource {
    const player = this.getPlayer(id);
    if (player.scanningIdentifier === null) return player;
    let fallbackOwner: PlayerResource | null = null;
    try {
      fallbackOwner = this.getPlayerByScanningIdentifier(String(id));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    if (fallbackOwner && fallbackOwner.id !== id) {
      throw new ConflictError(
        `Player ${id}'s fallback identifier is assigned to ${fallbackOwner.name}.`,
      );
    }
    this.db.prepare(`
      UPDATE PlayerResource SET scanningIdentifier = NULL WHERE id = ?
    `).run(id);
    return this.getPlayer(id);
  }

  assertRatingProjectionIntegrity(): void {
    const divergent = this.db.prepare(`
      SELECT p.id, p.rating AS cachedRating, COALESCE((
        SELECT rating FROM RatingEventResource
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS ledgerRating
      FROM PlayerResource p
      WHERE p.rating <> COALESCE((
        SELECT rating FROM RatingEventResource
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700)
      ORDER BY p.id LIMIT 1
    `).get() as { id: number; cachedRating: number; ledgerRating: number } | undefined;
    if (divergent) {
      throw new Error(
        `Rating projection divergence for player ${divergent.id}: `
        + `cache ${divergent.cachedRating}, ledger ${divergent.ledgerRating}.`,
      );
    }
  }

  private ensureBaseline(playerId: number, recordedAt = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO RatingEventResource(
        playerId, previousRating, rating, delta, recordedAt, reason
      )
      SELECT ?, 700, 700, 0, ?, 'baseline'
      WHERE NOT EXISTS (SELECT 1 FROM RatingEventResource WHERE playerId = ?)
    `).run(playerId, recordedAt, playerId);
  }

  upsertPlayer(id: number, rawName: string): PlayerResource {
    const name = validatePlayerInput(id, rawName);
    const identifierOwner = this.db.prepare(`
      SELECT id FROM PlayerResource WHERE scanningIdentifier = ?
    `).get(String(id)) as { id: number } | undefined;
    if (identifierOwner && identifierOwner.id !== id) {
      throw new ConflictError(`Player ID ${id} is already used as a scanning identifier.`);
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO PlayerResource(id, name) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(id, name);
      this.ensureBaseline(id);
      const player = this.getPlayer(id);
      this.db.exec('COMMIT');
      return player;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createPlayer(rawName: string): PlayerResource {
    const name = rawName.trim();
    if (!name || name.length > 80) throw new ValidationError('Player name must contain 1 to 80 characters.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = new Set(
        this.db.prepare('SELECT id FROM PlayerResource WHERE id BETWEEN 1000 AND 2000').all()
          .map((row) => (row as { id: number }).id),
      );
      for (const { scanningIdentifier } of this.db.prepare(`
        SELECT scanningIdentifier FROM PlayerResource
        WHERE scanningIdentifier GLOB '[0-9]*'
      `).all() as unknown as Array<{ scanningIdentifier: string }>) {
        if (/^\d+$/.test(scanningIdentifier)) used.add(Number(scanningIdentifier));
      }
      const available = Array.from({ length: 1001 }, (_, index) => index + 1000)
        .filter((id) => !used.has(id));
      if (available.length === 0) {
        throw new ConflictError('No player IDs are available in the 1000–2000 range.');
      }

      const index = this.randomIndex(available.length);
      if (!Number.isInteger(index) || index < 0 || index >= available.length) {
        throw new Error('Random index source returned an out-of-range value.');
      }
      const id = available[index];
      this.db.prepare('INSERT INTO PlayerResource(id, name) VALUES (?, ?)').run(id, name);
      this.ensureBaseline(id);
      this.db.exec('COMMIT');
      return { id, name, rating: INITIAL_RATING, scanningIdentifier: null };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updatePlayerName(id: number, rawName: string): PlayerResource {
    const name = validatePlayerInput(id, rawName);
    const player = this.getPlayer(id);
    if (player.name === name) return player;
    this.db.prepare('UPDATE PlayerResource SET name = ? WHERE id = ?').run(name, id);
    return { ...player, name };
  }

  deletePlayer(id: number): PlayerResource {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const player = this.getPlayer(id);
      const gameReference = this.db.prepare(`
        SELECT 1 FROM GameResource
        WHERE blackPlayerId = ? OR whitePlayerId = ?
        LIMIT 1
      `).get(id, id);
      const history = this.db.prepare(`
        SELECT COUNT(*) AS count,
               SUM(CASE WHEN reason = 'baseline' THEN 1 ELSE 0 END) AS baselines
        FROM RatingEventResource WHERE playerId = ?
      `).get(id) as { count: number; baselines: number };
      if (gameReference || history.count !== 1 || history.baselines !== 1) {
        throw new ConflictError(
          `Player ${id} cannot be deleted because it has game references or non-baseline rating history.`,
        );
      }
      this.db.prepare(`
        DELETE FROM RatingEventResource WHERE playerId = ? AND reason = 'baseline'
      `).run(id);
      this.db.prepare('DELETE FROM PlayerResource WHERE id = ?').run(id);
      this.db.exec('COMMIT');
      return player;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('FOREIGN KEY')) {
        throw new ConflictError(
          `Player ${id} cannot be deleted while referenced by immutable game or rating history.`,
        );
      }
      throw error;
    }
  }

  listGames(): GameResource[] {
    return this.db.prepare(
      `SELECT id, tableNumber, createdAt, blackPlayerId, whitePlayerId, finishedAt, result,
              cancelledAt, cancellationReason, eventId, startedAt
       FROM GameResource ORDER BY CASE WHEN result IS NULL AND cancelledAt IS NULL THEN 0 ELSE 1 END, tableNumber`,
    ).all().map(gameRow);
  }

  listJoinedGames(
    result: 'ongoing' | 'finished' = 'ongoing',
    limit?: number,
    eventId?: number,
    gameId?: number,
  ): JoinedChessGame[] {
    this.assertRatingProjectionIntegrity();
    const statusWhere = result === 'ongoing'
      ? 'g.result IS NULL AND g.cancelledAt IS NULL'
      : '(g.result IS NOT NULL OR g.cancelledAt IS NOT NULL)';
    const where = `${statusWhere}${eventId === undefined ? '' : ' AND g.eventId = ?'}${gameId === undefined ? '' : ' AND g.id = ?'}`;
    const order = result === 'ongoing'
      ? 'g.tableNumber'
      : 'COALESCE(g.cancelledAt, g.finishedAt, g.createdAt) DESC, g.id DESC';
    const limitSql = limit === undefined ? '' : ' LIMIT ?';
    const parameters = [
      ...(eventId === undefined ? [] : [eventId]),
      ...(gameId === undefined ? [] : [gameId]),
      ...(limit === undefined ? [] : [limit]),
    ];
    return this.db.prepare(`
      SELECT
        g.id, g.tableNumber, g.createdAt, g.finishedAt, g.result,
        g.cancelledAt, g.cancellationReason, g.eventId, g.startedAt,
        g.blackPlayerId, g.whitePlayerId,
        CASE
          WHEN g.cancelledAt IS NOT NULL THEN 0
          WHEN g.result IS NULL THEN 1
          WHEN NOT EXISTS (
            SELECT 1 FROM GameResource AS later
            WHERE later.cancelledAt IS NULL AND later.result IS NOT NULL
              AND (later.whitePlayerId = g.whitePlayerId OR later.blackPlayerId = g.whitePlayerId)
              AND (later.finishedAt > g.finishedAt OR (later.finishedAt = g.finishedAt AND later.id > g.id))
          ) AND NOT EXISTS (
            SELECT 1 FROM GameResource AS later
            WHERE later.cancelledAt IS NULL AND later.result IS NOT NULL
              AND (later.whitePlayerId = g.blackPlayerId OR later.blackPlayerId = g.blackPlayerId)
              AND (later.finishedAt > g.finishedAt OR (later.finishedAt = g.finishedAt AND later.id > g.id))
          ) THEN 1
          ELSE 0
        END AS canCancel,
        black.name AS blackPlayerName, black.rating AS blackPlayerRating,
        white.name AS whitePlayerName, white.rating AS whitePlayerRating,
        COALESCE(blackEvent.previousRating, black.rating) AS blackStartingRating,
        COALESCE(whiteEvent.previousRating, white.rating) AS whiteStartingRating,
        blackEvent.delta AS blackRatingDelta,
        whiteEvent.delta AS whiteRatingDelta
      FROM GameResource AS g
      LEFT JOIN PlayerResource AS black ON black.id = g.blackPlayerId
      LEFT JOIN PlayerResource AS white ON white.id = g.whitePlayerId
      LEFT JOIN RatingEventResource AS blackEvent
        ON blackEvent.gameId = g.id AND blackEvent.playerId = g.blackPlayerId
        AND blackEvent.reason = 'game'
      LEFT JOIN RatingEventResource AS whiteEvent
        ON whiteEvent.gameId = g.id AND whiteEvent.playerId = g.whitePlayerId
        AND whiteEvent.reason = 'game'
      WHERE ${where}
      ORDER BY ${order}${limitSql}
    `).all(...parameters).map((row) => {
      const value = row as unknown as GameResource & {
        blackPlayerName: string | null;
        blackPlayerRating: number | null;
        whitePlayerName: string | null;
        whitePlayerRating: number | null;
        blackStartingRating: number | null;
        whiteStartingRating: number | null;
        blackRatingDelta: number | null;
        whiteRatingDelta: number | null;
        canCancel: number;
      };
      return {
        id: value.id,
        tableNumber: value.tableNumber,
        createdAt: value.createdAt,
        startedAt: value.startedAt,
        blackPlayerId: value.blackPlayerId,
        whitePlayerId: value.whitePlayerId,
        finishedAt: value.finishedAt,
        result: value.result,
        cancelledAt: value.cancelledAt,
        cancellationReason: value.cancellationReason,
        eventId: value.eventId,
        canCancel: value.canCancel === 1,
        blackStartingRating: value.blackStartingRating,
        whiteStartingRating: value.whiteStartingRating,
        blackRatingDelta: value.blackRatingDelta,
        whiteRatingDelta: value.whiteRatingDelta,
        blackPlayer: value.blackPlayerId === null
          ? null : {
            id: value.blackPlayerId,
            name: value.blackPlayerName as string,
            rating: value.blackPlayerRating as number,
          },
        whitePlayer: value.whitePlayerId === null
          ? null : {
            id: value.whitePlayerId,
            name: value.whitePlayerName as string,
            rating: value.whitePlayerRating as number,
          },
      };
    });
  }

  getGame(id: number): GameResource {
    const row = this.db.prepare(
      `SELECT id, tableNumber, createdAt, blackPlayerId, whitePlayerId, finishedAt, result,
              cancelledAt, cancellationReason, eventId, startedAt
       FROM GameResource WHERE id = ?`,
    ).get(id);
    if (!row) throw new NotFoundError(`Game ${id} was not found.`);
    return gameRow(row);
  }

  createGame(blackPlayerId: number, whitePlayerId: number, eventId?: number | null): GameResource {
    if (blackPlayerId === whitePlayerId) {
      throw new ValidationError('Black and white players must differ.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const table = this.db.prepare(`
        SELECT candidate AS tableNumber
        FROM (
          SELECT 1 AS candidate
          UNION ALL
          SELECT tableNumber + 1 FROM GameResource WHERE result IS NULL AND cancelledAt IS NULL
        )
        WHERE NOT EXISTS (
          SELECT 1 FROM GameResource WHERE tableNumber = candidate AND result IS NULL AND cancelledAt IS NULL
        )
        ORDER BY candidate
        LIMIT 1
      `).get() as { tableNumber: number };
      const resolvedEventId = this.resolveEventId(eventId);
      if (resolvedEventId !== null) {
        this.assertSessionAssignment(resolvedEventId, blackPlayerId);
        this.assertSessionAssignment(resolvedEventId, whitePlayerId);
      }
      const result = this.db.prepare(
        `INSERT INTO GameResource(tableNumber, createdAt, blackPlayerId, whitePlayerId, eventId)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(table.tableNumber, new Date().toISOString(), blackPlayerId, whitePlayerId, resolvedEventId);
      const game = this.getGame(Number(result.lastInsertRowid));
      if (resolvedEventId !== null) {
        for (const [playerId, side] of [[blackPlayerId, 'black'], [whitePlayerId, 'white']] as const) {
          this.ensureSessionPairingCohort(resolvedEventId, playerId);
          this.recordCheckIn(resolvedEventId, playerId, game.createdAt, game.id, 'paired', side);
        }
      }
      this.db.exec('COMMIT');
      return game;
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('FOREIGN KEY')) {
        throw new NotFoundError('Both black and white players must exist.');
      }
      if (sqliteMessage(error).includes('already belongs')) {
        throw new ConflictError('A player already belongs to an ongoing game.');
      }
      throw error;
    }
  }

  createEmptyGame(
    now: () => string = () => new Date().toISOString(),
    eventId?: number | null,
  ): JoinedChessGame {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const createdAt = now();
      if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      const resolvedEventId = this.resolveEventId(eventId);
      if (resolvedEventId !== null && !this.getClubSession(resolvedEventId).active) {
        throw new ConflictError('Cannot create a game in a closed Club Session.');
      }
      const result = this.db.prepare(`
        INSERT INTO GameResource(tableNumber, createdAt, blackPlayerId, whitePlayerId, eventId)
        VALUES (?, ?, NULL, NULL, ?)
      `).run(this.lowestAvailableTable(), createdAt, resolvedEventId);
      const game = this.getJoinedGame(Number(result.lastInsertRowid));
      this.db.exec('COMMIT');
      return game;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  checkInPlayer(
    player: Pick<PlayerResource, 'id' | 'name'>,
    rng: (maxExclusive: number) => number = randomInt,
    now: () => string = () => new Date().toISOString(),
    eventId?: number,
  ): CheckInResult {
    const name = validatePlayerInput(player.id, player.name);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const checkedInAt = now();
      if (typeof checkedInAt !== 'string' || Number.isNaN(Date.parse(checkedInAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      this.db.prepare(`
        INSERT INTO PlayerResource(id, name) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(player.id, name);
      this.ensureBaseline(player.id, checkedInAt);
      const activeEventId = this.resolveEventId(eventId);
      if (activeEventId !== null) {
        if (!this.getClubSession(activeEventId).active) {
          throw new ConflictError('Cannot check a player into a closed Club Session.');
        }
        this.ensureSessionPairingCohort(activeEventId, player.id);
        this.db.prepare(`
          INSERT INTO CheckInResource(eventId, playerId, checkedInAt)
          VALUES (?, ?, ?)
          ON CONFLICT DO NOTHING
        `).run(activeEventId, player.id, checkedInAt);
        this.db.prepare(`
          UPDATE CheckInResource
          SET checkedInAt = CASE WHEN checkedOutAt IS NOT NULL THEN ? ELSE checkedInAt END,
            checkedOutAt = NULL
          WHERE eventId = ? AND playerId = ?
        `).run(checkedInAt, activeEventId, player.id);
      }

      const existing = this.db.prepare(`
        SELECT id, blackPlayerId, whitePlayerId, eventId
        FROM GameResource
        WHERE result IS NULL AND cancelledAt IS NULL AND (blackPlayerId = ? OR whitePlayerId = ?)
        LIMIT 1
      `).get(player.id, player.id) as {
        id: number; blackPlayerId: number | null; whitePlayerId: number | null; eventId: number | null
      } | undefined;
      if (existing) {
        if (existing.eventId !== activeEventId
          && (eventId !== undefined || existing.eventId !== null)) {
          throw new ConflictError('This player already has an unfinished game in another session.');
        }
        if (existing.eventId === null && activeEventId !== null) {
          this.db.prepare('UPDATE GameResource SET eventId = ? WHERE id = ?').run(activeEventId, existing.id);
        }
        const side: CheckInSide = existing.blackPlayerId === player.id ? 'black' : 'white';
        const game = this.getJoinedGame(existing.id);
        const checkIn = this.recordCheckIn(
          activeEventId, player.id, checkedInAt, game.id, 'already-checked-in', side,
        );
        this.db.exec('COMMIT');
        return { status: 'already-checked-in', game, side, checkIn };
      }

      const waiting = activeEventId === null
        ? this.db.prepare(`
          SELECT id, blackPlayerId, whitePlayerId
          FROM GameResource
          WHERE result IS NULL AND cancelledAt IS NULL
            AND startedAt IS NULL
            AND eventId IS NULL
            AND (blackPlayerId IS NULL) <> (whitePlayerId IS NULL)
          ORDER BY createdAt ASC, id ASC
          LIMIT 1
        `).get()
        : this.findClubSessionPairing(activeEventId, player.id, true);
      const typedWaiting = waiting as {
        id: number | null; blackPlayerId: number | null; whitePlayerId: number | null
      } | undefined;
      if (typedWaiting?.id === null && activeEventId !== null) {
        if (typedWaiting.whitePlayerId === null) throw new Error('Session pairing has no opponent.');
        const created = this.createSessionPairing(activeEventId, player.id, typedWaiting.whitePlayerId, checkedInAt, rng);
        const game = this.getJoinedGame(created.id);
        const side: CheckInSide = game.blackPlayerId === player.id ? 'black' : 'white';
        const checkIn = this.recordCheckIn(activeEventId, player.id, checkedInAt, game.id, 'paired', side);
        this.db.exec('COMMIT');
        return { status: 'paired', game, side, checkIn };
      }
      if (typedWaiting && typedWaiting.id !== null) {
        const side: CheckInSide = typedWaiting.blackPlayerId === null ? 'black' : 'white';
        this.db.prepare(
          `UPDATE GameResource SET ${side === 'black' ? 'blackPlayerId' : 'whitePlayerId'} = ? WHERE id = ?`,
        ).run(player.id, typedWaiting.id);
        const game = this.getJoinedGame(typedWaiting.id);
        const checkIn = this.recordCheckIn(
          activeEventId, player.id, checkedInAt, game.id, 'paired', side,
        );
        this.db.exec('COMMIT');
        return { status: 'paired', game, side, checkIn };
      }

      const empty = this.db.prepare(`
        SELECT id
        FROM GameResource
        WHERE result IS NULL AND cancelledAt IS NULL
          AND startedAt IS NULL
          AND (eventId IS ? OR (eventId IS NULL AND ? IS NOT NULL AND ? = 1))
          AND blackPlayerId IS NULL AND whitePlayerId IS NULL
        ORDER BY CASE WHEN eventId IS ? THEN 0 ELSE 1 END,
          tableNumber ASC, createdAt ASC, id ASC
        LIMIT 1
      `).get(activeEventId, activeEventId, eventId === undefined ? 1 : 0, activeEventId) as { id: number } | undefined;
      const sideIndex = rng(2);
      if (sideIndex !== 0 && sideIndex !== 1) {
        throw new Error('Random side source must return 0 or 1.');
      }
      const side: CheckInSide = sideIndex === 0 ? 'black' : 'white';
      if (empty) {
        this.db.prepare(
          `UPDATE GameResource
           SET ${side === 'black' ? 'blackPlayerId' : 'whitePlayerId'} = ?,
               eventId = COALESCE(eventId, ?)
           WHERE id = ?`,
        ).run(player.id, activeEventId, empty.id);
        const game = this.getJoinedGame(empty.id);
        const checkIn = this.recordCheckIn(
          activeEventId, player.id, checkedInAt, game.id, 'waiting', side,
        );
        this.db.exec('COMMIT');
        return { status: 'waiting', game, side, checkIn };
      }

      const table = this.lowestAvailableTable();
      const createdAt = now();
      if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      const result = this.db.prepare(`
        INSERT INTO GameResource(tableNumber, createdAt, blackPlayerId, whitePlayerId, eventId)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        table,
        createdAt,
        side === 'black' ? player.id : null,
        side === 'white' ? player.id : null,
        activeEventId,
      );
      const game = this.getJoinedGame(Number(result.lastInsertRowid));
      const checkIn = this.recordCheckIn(
        activeEventId, player.id, checkedInAt, game.id, 'waiting', side,
      );
      this.db.exec('COMMIT');
      return { status: 'waiting', game, side, checkIn };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  checkOutPlayer(eventId: number, playerId: number, now = () => new Date().toISOString()): CheckIn {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.getClubSession(eventId).active) throw new ConflictError('This Club Session is closed.');
      const attendance = this.listCheckIns(eventId, playerId)[0];
      if (!attendance) throw new NotFoundError('This player has not checked into this Club Session.');
      if (attendance.checkedOutAt !== null) {
        this.db.exec('COMMIT');
        return attendance;
      }
      const game = this.db.prepare(`
        SELECT * FROM GameResource
        WHERE result IS NULL AND cancelledAt IS NULL AND (blackPlayerId = ? OR whitePlayerId = ?)
        LIMIT 1
      `).get(playerId, playerId) as GameResource | undefined;
      if (game?.startedAt) throw new ConflictError(`Finish or cancel Table ${game.tableNumber} before checking this player out.`);
      if (game?.eventId === eventId) {
        const remaining = this.updateGameSeatInTransaction(
          game.id, game.blackPlayerId === playerId ? 'black' : 'white', null,
        );
        if (remaining.blackPlayerId === null && remaining.whitePlayerId === null) {
          this.cancelGameInTransaction(game.id, null, now);
        }
      }
      const checkedOutAt = now();
      if (typeof checkedOutAt !== 'string' || Number.isNaN(Date.parse(checkedOutAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      this.db.prepare(`
        UPDATE CheckInResource SET checkedOutAt = ?, gameId = NULL, placement = NULL, side = NULL
        WHERE id = ?
      `).run(checkedOutAt, attendance.id);
      const checkedOut = this.getCheckIn(attendance.id);
      this.db.exec('COMMIT');
      return checkedOut;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private assertSessionAssignment(eventId: number, playerId: number): void {
    if (!this.getClubSession(eventId).active) throw new ConflictError('This Club Session is closed.');
    const attendance = this.listCheckIns(eventId, playerId)[0];
    if (attendance?.checkedOutAt != null) {
      throw new ConflictError(`${this.getPlayer(playerId).name} is checked out of this Club Session. Check them in before assigning another game.`);
    }
  }

  private recordCheckIn(
      eventId: number | null,
      playerId: number,
      checkedInAt: string,
      gameId: number,
      placement: CheckInResult['status'],
      side: CheckInSide,
    ): CheckIn {
      const existing = this.db.prepare(`
        SELECT id FROM CheckInResource
        WHERE playerId = ? AND (
          (? IS NOT NULL AND eventId = ?)
          OR (? IS NULL AND eventId IS NULL AND gameId = ?)
        )
        ORDER BY id LIMIT 1
      `).get(playerId, eventId, eventId, eventId, gameId) as { id: number } | undefined;
      let id = existing?.id;
      if (id === undefined) {
        const inserted = this.db.prepare(`
          INSERT INTO CheckInResource(
            eventId, playerId, checkedInAt, gameId, placement, side
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(eventId, playerId, checkedInAt, gameId, placement, side);
        id = Number(inserted.lastInsertRowid);
      } else {
        this.db.prepare(`
          UPDATE CheckInResource
          SET gameId = ?,
              placement = CASE WHEN gameId = ? THEN COALESCE(placement, ?) ELSE ? END,
              side = ?
          WHERE id = ?
        `).run(gameId, gameId, placement, placement, side, id);
      }
      return this.getCheckIn(id);
  }

  private ensureSessionPairingCohort(eventId: number, playerId: number): void {
    if (this.db.prepare(`
      SELECT 1 FROM PairingCohortResource WHERE eventId = ? AND playerId = ?
    `).get(eventId, playerId)) return;
    const player = this.getPlayer(playerId);
    const boundaries = this.db.prepare(`
      SELECT cohort, MIN(snapshotRating) AS minimumRating
      FROM PairingCohortResource
      WHERE eventId = ?
      GROUP BY cohort
      ORDER BY CASE cohort WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
    `).all(eventId) as unknown as Array<{
      cohort: PairingCohortCode;
      minimumRating: number;
    }>;
    const cohort = boundaries.find(({ minimumRating }) => player.rating >= minimumRating)?.cohort
      ?? boundaries.at(-1)?.cohort
      ?? 'A';
    this.db.prepare(`
      INSERT INTO PairingCohortResource(eventId, playerId, cohort, snapshotRating)
      VALUES (?, ?, ?, ?)
    `).run(eventId, playerId, cohort, player.rating);
  }

  private findClubSessionPairing(
    eventId: number,
    playerId: number,
    includeAvailable = false,
  ): { id: number | null; blackPlayerId: number | null; whitePlayerId: number | null } | undefined {
    return this.db.prepare(`
      WITH completed AS (
        SELECT blackPlayerId, whitePlayerId, result
        FROM GameResource
        WHERE eventId = ? AND result IS NOT NULL AND cancelledAt IS NULL
      ),
      records AS (
        SELECT p.playerId,
          COUNT(c.result) AS gamesPlayed,
          COALESCE(SUM(CASE
            WHEN c.blackPlayerId = p.playerId AND c.result = '0-1' THEN 1
            WHEN c.whitePlayerId = p.playerId AND c.result = '1-0' THEN 1
            WHEN c.blackPlayerId = p.playerId AND c.result = '1-0' THEN -1
            WHEN c.whitePlayerId = p.playerId AND c.result = '0-1' THEN -1
            ELSE 0
          END), 0) AS score
        FROM PairingCohortResource AS p
        LEFT JOIN completed AS c
          ON c.blackPlayerId = p.playerId OR c.whitePlayerId = p.playerId
        WHERE p.eventId = ?
        GROUP BY p.playerId
      ),
      candidates AS (
        SELECT g.id, g.blackPlayerId, g.whitePlayerId, g.createdAt,
          CASE WHEN g.blackPlayerId IS NULL THEN g.whitePlayerId ELSE g.blackPlayerId END AS opponentId
        FROM GameResource AS g
        WHERE g.eventId = ?
          AND g.result IS NULL AND g.cancelledAt IS NULL AND g.startedAt IS NULL
          AND (g.blackPlayerId IS NULL) <> (g.whitePlayerId IS NULL)
        UNION ALL
        SELECT NULL, NULL, attendance.playerId, attendance.checkedInAt, attendance.playerId
        FROM CheckInResource AS attendance
        WHERE attendance.eventId = ? AND attendance.checkedOutAt IS NULL
          AND attendance.playerId <> ? AND ? = 1
          AND NOT EXISTS (
            SELECT 1 FROM GameResource AS busy
            WHERE busy.result IS NULL AND busy.cancelledAt IS NULL
              AND (busy.blackPlayerId = attendance.playerId OR busy.whitePlayerId = attendance.playerId)
          )
      )
      SELECT candidate.id, candidate.blackPlayerId, candidate.whitePlayerId
      FROM candidates AS candidate
      INNER JOIN PairingCohortResource AS incomingCohort
        ON incomingCohort.eventId = ? AND incomingCohort.playerId = ?
      INNER JOIN PairingCohortResource AS opponentCohort
        ON opponentCohort.eventId = incomingCohort.eventId
        AND opponentCohort.playerId = candidate.opponentId
        AND opponentCohort.cohort = incomingCohort.cohort
      INNER JOIN records AS incomingRecord ON incomingRecord.playerId = ?
      INNER JOIN records AS opponentRecord ON opponentRecord.playerId = candidate.opponentId
      INNER JOIN CheckInResource AS opponentAttendance
        ON opponentAttendance.eventId = ? AND opponentAttendance.playerId = candidate.opponentId
        AND opponentAttendance.checkedOutAt IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM completed AS prior
        WHERE (prior.blackPlayerId = ? AND prior.whitePlayerId = candidate.opponentId)
           OR (prior.whitePlayerId = ? AND prior.blackPlayerId = candidate.opponentId)
      )
      ORDER BY CASE WHEN candidate.id IS NULL THEN 1 ELSE 0 END, CASE
        WHEN incomingRecord.gamesPlayed = 0 THEN 0
        WHEN SIGN(incomingRecord.score) = SIGN(opponentRecord.score) THEN 0
        ELSE 1
      END,
      candidate.createdAt ASC, candidate.id ASC, candidate.opponentId ASC
      LIMIT 1
    `).get(
      eventId,
      eventId,
      eventId,
      eventId,
      playerId,
      includeAvailable ? 1 : 0,
      eventId,
      playerId,
      playerId,
      eventId,
      playerId,
      playerId,
    ) as {
      id: number | null;
      blackPlayerId: number | null;
      whitePlayerId: number | null;
    } | undefined;
  }

  private createSessionPairing(
    eventId: number, playerId: number, opponentId: number, createdAt: string, rng = randomInt,
  ): GameResource {
    this.assertSessionAssignment(eventId, playerId);
    this.assertSessionAssignment(eventId, opponentId);
    const side = rng(2);
    if (side !== 0 && side !== 1) throw new Error('Random side source must return 0 or 1.');
    const blackPlayerId = side === 0 ? playerId : opponentId;
    const whitePlayerId = side === 0 ? opponentId : playerId;
    const inserted = this.db.prepare(`
      INSERT INTO GameResource(tableNumber, createdAt, blackPlayerId, whitePlayerId, eventId)
      VALUES (?, ?, ?, ?, ?)
    `).run(this.lowestAvailableTable(), createdAt, blackPlayerId, whitePlayerId, eventId);
    const gameId = Number(inserted.lastInsertRowid);
    this.recordCheckIn(eventId, blackPlayerId, createdAt, gameId, 'paired', 'black');
    this.recordCheckIn(eventId, whitePlayerId, createdAt, gameId, 'paired', 'white');
    return this.getGame(gameId);
  }

  private pairAvailableSessionPlayers(eventId: number): void {
    if (!this.getClubSession(eventId).active) return;
    const available = this.db.prepare(`
      SELECT attendance.playerId FROM CheckInResource AS attendance
      WHERE attendance.eventId = ? AND attendance.checkedOutAt IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM GameResource AS game WHERE game.result IS NULL AND game.cancelledAt IS NULL
            AND (game.blackPlayerId = attendance.playerId OR game.whitePlayerId = attendance.playerId)
        )
      ORDER BY attendance.checkedInAt, attendance.id
    `).all(eventId) as Array<{ playerId: number }>;
    for (const { playerId } of available) {
      if (this.db.prepare(`
        SELECT 1 FROM GameResource WHERE result IS NULL AND cancelledAt IS NULL
          AND (blackPlayerId = ? OR whitePlayerId = ?)
      `).get(playerId, playerId)) continue;
      const candidate = this.findClubSessionPairing(eventId, playerId, true);
      if (!candidate) continue;
      const side: CheckInSide = candidate.blackPlayerId === null ? 'black' : 'white';
      if (candidate.id !== null) {
        this.updateGameSeatInTransaction(candidate.id, side, playerId);
      } else {
        const opponentId = candidate.whitePlayerId;
        if (opponentId === null) throw new Error('Automatic pairing has no opponent.');
        this.createSessionPairing(eventId, playerId, opponentId, new Date().toISOString());
      }
    }
  }

  private lowestAvailableTable(): number {
    const row = this.db.prepare(`
      SELECT candidate AS tableNumber
      FROM (
        SELECT 1 AS candidate
        UNION ALL
        SELECT tableNumber + 1 FROM GameResource WHERE result IS NULL AND cancelledAt IS NULL
      )
      WHERE NOT EXISTS (
        SELECT 1 FROM GameResource WHERE tableNumber = candidate AND result IS NULL AND cancelledAt IS NULL
      )
      ORDER BY candidate
      LIMIT 1
    `).get() as { tableNumber: number };
    return row.tableNumber;
  }

  private resolveEventId(eventId: number | null | undefined): number | null {
    if (eventId === null) return null;
    if (eventId !== undefined) {
      const exists = this.db.prepare(`
        SELECT 1 FROM ClubSessionResource
        WHERE id = ? AND type = 'club-session' AND deletedAt IS NULL
      `).get(eventId);
      if (!exists) throw new NotFoundError(`Club session ${eventId} was not found.`);
      return eventId;
    }
    const active = this.db.prepare(`
      SELECT id FROM ClubSessionResource
      WHERE type = 'club-session' AND active = 1 AND deletedAt IS NULL
    `).get() as { id: number } | undefined;
    return active?.id ?? null;
  }

  private getJoinedGame(id: number): JoinedChessGame {
    const game = this.listJoinedGames('ongoing').find((candidate) => candidate.id === id);
    if (!game) throw new Error(`Game ${id} disappeared during check-in.`);
    return game;
  }

  getGameDetails(id: number): JoinedChessGame {
    const game = this.getGame(id);
    const joined = this.listJoinedGames(
      game.result !== null || game.cancelledAt !== null ? 'finished' : 'ongoing',
      undefined, undefined, id,
    )[0];
    if (!joined) throw new NotFoundError(`Game ${id} was not found.`);
    return joined;
  }

  deleteGame(id: number, overrideStarted = false): GameResource {
    return this.cancelGame(id, undefined, undefined, overrideStarted);
  }

  updateGameSeat(id: number, side: CheckInSide, playerId: number | null, overrideStarted = false): GameResource {
    if (side !== 'black' && side !== 'white') throw new ValidationError('Side must be black or white.');
    if (playerId !== null && (!Number.isInteger(playerId) || playerId < 1000 || playerId > 2000)) {
      throw new ValidationError('playerId must be null or an integer between 1000 and 2000.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.updateGameSeatInTransaction(id, side, playerId, overrideStarted);
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('already belongs')) {
        throw new ConflictError('Replacement player already belongs to another ongoing game.');
      }
      throw error;
    }
  }

  updateGameResource(
    id: number,
    update: GameResourceUpdate,
    now = () => new Date().toISOString(),
  ): GameResource {
    const cancellationReason = update.cancellationReason?.trim() || null;
    if (cancellationReason && cancellationReason.length > 500) {
      throw new ValidationError('Cancellation reason must be at most 500 characters.');
    }
    if (update.swapSides && (update.blackPlayerId !== undefined || update.whitePlayerId !== undefined)) {
      throw new ValidationError('Switching sides cannot be combined with replacement seat assignments.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (update.swapSides) {
        const game = this.getGame(id);
        if (game.result !== null || game.cancelledAt !== null) {
          throw new ConflictError('Only a non-cancelled unfinished game can switch sides.');
        }
        if (game.blackPlayerId === null && game.whitePlayerId === null) {
          throw new ConflictError('At least one player must be seated before switching sides.');
        }
        this.assertStartedConsent(game, update.overrideStarted ?? false);
        if (game.eventId !== null && !this.getClubSession(game.eventId).active) {
          throw new ConflictError('Cannot switch sides in a closed Club Session.');
        }
        this.db.prepare(`
          UPDATE GameResource SET blackPlayerId = whitePlayerId, whitePlayerId = blackPlayerId WHERE id = ?
        `).run(id);
        this.db.prepare(`
          UPDATE CheckInResource SET side = CASE WHEN playerId = ? THEN 'white' ELSE 'black' END
          WHERE gameId = ? AND playerId IN (?, ?)
        `).run(game.blackPlayerId, id, game.blackPlayerId, game.whitePlayerId);
      }
      if (update.blackPlayerId !== undefined) {
        this.updateGameSeatInTransaction(id, 'black', update.blackPlayerId, update.overrideStarted);
      }
      if (update.whitePlayerId !== undefined) {
        this.updateGameSeatInTransaction(id, 'white', update.whitePlayerId, update.overrideStarted);
      }
      let game = this.getGame(id);
      if (update.start !== undefined) {
        if (game.result || game.cancelledAt) {
          throw new ConflictError('Only a non-cancelled unfinished game can change between Paired and Playing.');
        }
        if (update.start && (game.blackPlayerId === null || game.whitePlayerId === null)) {
          throw new ConflictError('Both seats must be occupied in an unfinished game before starting.');
        }
        if (!update.start) {
          this.db.prepare('UPDATE GameResource SET startedAt = NULL WHERE id = ?').run(id);
          game = this.getGame(id);
        } else if (!game.startedAt) {
          const startedAt = now();
          if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) {
            throw new Error('Clock source returned an invalid ISO timestamp.');
          }
          this.db.prepare('UPDATE GameResource SET startedAt = ? WHERE id = ?').run(startedAt, id);
          game = this.getGame(id);
        }
      }
      if (update.result !== undefined) {
        const finishedAt = now();
        if (typeof finishedAt !== 'string' || Number.isNaN(Date.parse(finishedAt))) {
          throw new Error('Clock source returned an invalid ISO timestamp.');
        }
        game = this.finalizeGameInTransaction(id, update.result, finishedAt);
      }
      if (update.cancel) {
        game = this.cancelGameInTransaction(id, cancellationReason, now, update.overrideStarted);
      }
      this.db.exec('COMMIT');
      return game;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('already belongs')) {
        throw new ConflictError('Replacement player already belongs to another ongoing game.');
      }
      throw error;
    }
  }

  private updateGameSeatInTransaction(
    id: number,
    side: CheckInSide,
    playerId: number | null,
    overrideStarted = false,
  ): GameResource {
    const game = this.getGame(id);
    if (game.result !== null || game.cancelledAt !== null) {
      throw new ConflictError('Only a non-cancelled unfinished game can have a seat changed.');
    }
    const opponentId = side === 'black' ? game.whitePlayerId : game.blackPlayerId;
    const currentId = side === 'black' ? game.blackPlayerId : game.whitePlayerId;
    if (currentId === playerId) return game;
    this.assertStartedConsent(game, overrideStarted);
    let sourceId: number | null = null;
    if (playerId !== null) {
      this.getPlayer(playerId);
      if (playerId === opponentId) throw new ValidationError('A player cannot occupy both seats.');
      if (game.eventId !== null) this.assertSessionAssignment(game.eventId, playerId);
      if (game.eventId !== null && !this.getClubSession(game.eventId).active) {
        throw new ConflictError('Cannot check a player into a closed Club Session.');
      }
      const existing = this.db.prepare(`
        SELECT * FROM GameResource
        WHERE result IS NULL AND cancelledAt IS NULL
          AND (blackPlayerId = ? OR whitePlayerId = ?)
        LIMIT 1
      `).get(playerId, playerId) as GameResource | undefined;
      if (existing && existing.id !== game.id) {
        if (existing.eventId !== game.eventId) {
          throw new ConflictError('Players can only move between tables in the same event.');
        }
        this.assertStartedConsent(existing, overrideStarted);
        sourceId = existing.id;
        this.db.prepare(`
          UPDATE GameResource SET ${existing.blackPlayerId === playerId ? 'blackPlayerId' : 'whitePlayerId'} = NULL
          WHERE id = ?
        `).run(existing.id);
        this.db.prepare(`
          UPDATE CheckInResource SET gameId = NULL, placement = NULL, side = NULL
          WHERE gameId = ? AND playerId = ?
        `).run(existing.id, playerId);
      }
    }
    this.db.prepare(`
      UPDATE GameResource
      SET ${side === 'black' ? 'blackPlayerId' : 'whitePlayerId'} = ?
      WHERE id = ?
    `).run(playerId, id);
    if (currentId !== null) {
      this.db.prepare(`
        UPDATE CheckInResource SET gameId = NULL, placement = NULL, side = NULL
        WHERE gameId = ? AND playerId = ?
      `).run(id, currentId);
    }
    if (playerId !== null) {
      if (game.eventId !== null) this.ensureSessionPairingCohort(game.eventId, playerId);
      const checkIn = this.recordCheckIn(game.eventId, playerId, new Date().toISOString(), id,
        opponentId === null ? 'waiting' : 'paired', side);
      this.db.prepare(`
        UPDATE CheckInResource SET gameId = ?, placement = ?, side = ? WHERE id = ?
      `).run(id, opponentId === null ? 'waiting' : 'paired', side, checkIn.id);
    }
    for (const affectedId of sourceId === null ? [id] : [sourceId, id]) {
      const affected = this.getGame(affectedId);
      for (const seat of ['black', 'white'] as const) {
        const seatedId = seat === 'black' ? affected.blackPlayerId : affected.whitePlayerId;
        if (seatedId === null) continue;
        this.db.prepare(`
          UPDATE CheckInResource SET placement = ?, side = ? WHERE gameId = ? AND playerId = ?
        `).run(affected.blackPlayerId !== null && affected.whitePlayerId !== null ? 'paired' : 'waiting',
          seat, affectedId, seatedId);
      }
    }
    return this.getGame(id);
  }

  private assertStartedConsent(game: GameResource, overrideStarted: boolean): void {
    if (game.startedAt && !overrideStarted) {
      throw new StartedGameError(`This game has already started (Table ${game.tableNumber}). Confirm an override to modify it.`);
    }
  }

  moveWaitingPlayer(playerId: number, destinationGameId: number, overrideStarted = false): JoinedChessGame {
    if (!Number.isInteger(playerId) || playerId < 1000 || playerId > 2000) {
      throw new ValidationError('playerId must be an integer between 1000 and 2000.');
    }
    if (!Number.isInteger(destinationGameId) || destinationGameId < 1) {
      throw new ValidationError('destinationGameId must be a positive integer.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.getPlayer(playerId);
      const source = this.db.prepare(`
        SELECT * FROM GameResource
        WHERE result IS NULL AND cancelledAt IS NULL
          AND (blackPlayerId = ? OR whitePlayerId = ?)
        LIMIT 1
      `).get(playerId, playerId) as GameResource | undefined;
      if (!source) throw new ConflictError('Player is not waiting at a table.');
      if (source.blackPlayerId !== null && source.whitePlayerId !== null) {
        throw new ConflictError('A player in an active game cannot be moved.');
      }
      if (source.id === destinationGameId) {
        throw new ValidationError('Choose a different destination table.');
      }
      const destination = this.getGame(destinationGameId);
      this.assertStartedConsent(source, overrideStarted);
      this.assertStartedConsent(destination, overrideStarted);
      if (destination.result !== null || destination.cancelledAt !== null
        || (destination.blackPlayerId === null) === (destination.whitePlayerId === null)) {
        throw new ConflictError('Destination table is not waiting for a player.');
      }
      if (destination.eventId !== source.eventId) {
        throw new ConflictError('Players can only move between tables in the same event.');
      }
      const side: CheckInSide = destination.blackPlayerId === null ? 'black' : 'white';
      this.updateGameSeatInTransaction(destination.id, side, playerId, overrideStarted);
      this.db.prepare('DELETE FROM GameResource WHERE id = ?').run(source.id);
      const moved = this.getJoinedGame(destination.id);
      this.db.exec('COMMIT');
      return moved;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('already belongs')) {
        throw new ConflictError('Player already belongs to another ongoing game.');
      }
      throw error;
    }
  }

  cancelGame(
    id: number, rawReason?: string, now = () => new Date().toISOString(),
    overrideStarted = false, unfinishedOnly = false,
  ): GameResource {
    const reason = rawReason?.trim() || null;
    if (reason && reason.length > 500) throw new ValidationError('Cancellation reason must be at most 500 characters.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cancelled = this.cancelGameInTransaction(id, reason, now, overrideStarted, unfinishedOnly);
      this.db.exec('COMMIT');
      return cancelled;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private cancelGameInTransaction(
    id: number,
    reason: string | null,
    now: () => string,
    overrideStarted = false,
    unfinishedOnly = false,
  ): GameResource {
    const game = this.getGame(id);
    if (unfinishedOnly && game.result !== null) {
      throw new ConflictError('A result has been recorded for this game. Review it before confirming cancellation.');
    }
    if (game.cancelledAt !== null) return game;
    if (game.result === null) {
      this.assertStartedConsent(game, overrideStarted);
      this.db.prepare(`
        UPDATE CheckInResource SET gameId = NULL, placement = NULL, side = NULL
        WHERE gameId = ? AND eventId IS NOT NULL
      `).run(id);
      this.db.prepare('DELETE FROM GameResource WHERE id = ?').run(id);
      return game;
    }
    const cancelledAt = now();
    if (typeof cancelledAt !== 'string' || Number.isNaN(Date.parse(cancelledAt))) {
      throw new Error('Clock source returned an invalid ISO timestamp.');
    }
    const players = [
      { id: game.whitePlayerId as number },
      { id: game.blackPlayerId as number },
    ];
    const blocked = players.flatMap(({ id: playerId }) => {
      const later = this.db.prepare(`
        SELECT 1 FROM GameResource
        WHERE cancelledAt IS NULL AND result IS NOT NULL
          AND (whitePlayerId = ? OR blackPlayerId = ?)
          AND (finishedAt > ? OR (finishedAt = ? AND id > ?))
        LIMIT 1
      `).get(playerId, playerId, game.finishedAt, game.finishedAt, game.id);
      return later ? [this.getPlayer(playerId).name] : [];
    });
    blocked.sort((left, right) => left.localeCompare(right));
    if (blocked.length) {
      const subject = blocked.length === 1 ? blocked[0] : `${blocked[0]} and ${blocked[1]}`;
      throw new ConflictError(
        `${subject} ${blocked.length === 1 ? 'has' : 'have'} played other games. `
        + 'Cancelling this game would affect their Elo and other players’ Elo. Contact your administrator.',
      );
    }
    const originalEvents = this.db.prepare(`
      SELECT playerId, opponentId, result, delta
      FROM RatingEventResource WHERE gameId = ? AND reason = 'game'
      ORDER BY playerId
    `).all(id) as unknown as Array<{
      playerId: number; opponentId: number; result: GameResult; delta: number
    }>;
    if (originalEvents.length !== 2) throw new Error(`Game ${id} does not have two original rating events.`);
    const insert = this.db.prepare(`
      INSERT INTO RatingEventResource(
        playerId, gameId, previousRating, rating, delta, recordedAt, reason, opponentId, result
      ) VALUES (?, ?, ?, ?, ?, ?, 'compensation', ?, ?)
    `);
    for (const event of originalEvents) {
      const player = this.getPlayer(event.playerId);
      insert.run(
        event.playerId, id, player.rating, player.rating - event.delta, -event.delta,
        cancelledAt, event.opponentId, event.result,
      );
      this.db.prepare('UPDATE PlayerResource SET rating = ? WHERE id = ?')
        .run(player.rating - event.delta, event.playerId);
    }
    this.db.prepare(`
      UPDATE GameResource SET cancelledAt = ?, cancellationReason = ? WHERE id = ? AND cancelledAt IS NULL
    `).run(cancelledAt, reason, id);
    this.assertRatingProjectionIntegrity();
    return this.getGame(id);
  }

  finalizeGame(id: number, result: GameResult, now = () => new Date().toISOString()): GameResource {
    if (!['1-0', '0-1', '1/2-1/2'].includes(result)) {
      throw new ValidationError('Result must be 1-0, 0-1, or 1/2-1/2.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getGame(id);
      if (existing.cancelledAt !== null) throw new ConflictError(`Game ${id} is cancelled.`);
      if (existing.result !== null) {
        if (existing.result !== result) {
          throw new ConflictError(`Game ${id} already has a different final result.`);
        }
        this.db.exec('COMMIT');
        return existing;
      }
      const finishedAt = now();
      if (typeof finishedAt !== 'string' || Number.isNaN(Date.parse(finishedAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      const finalized = this.finalizeGameInTransaction(id, result, finishedAt);
      this.db.exec('COMMIT');
      return finalized;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private finalizeGameInTransaction(id: number, result: GameResult, finishedAt: string, pairNext = true): GameResource {
    const game = this.getGame(id);
    if (game.cancelledAt !== null) throw new ConflictError(`Game ${id} is cancelled.`);
    if (game.result !== null) {
      if (game.result !== result) {
        throw new ConflictError(`Game ${id} already has a different final result.`);
      }
      return game;
    }
    if (game.blackPlayerId === null || game.whitePlayerId === null) {
      throw new ValidationError('Both seats must be occupied before setting a result.');
    }
    const black = this.getPlayer(game.blackPlayerId);
    const white = this.getPlayer(game.whitePlayerId);
    const updated = this.db.prepare(`
      UPDATE GameResource SET result = ?, finishedAt = ?
      WHERE id = ? AND result IS NULL
    `).run(result, finishedAt, id);
    if (updated.changes !== 1) throw new ConflictError(`Game ${id} already has a final result.`);
    const { whiteDelta, blackDelta } = calculateElo(white.rating, black.rating, result);
    const insertEvent = this.db.prepare(`
      INSERT INTO RatingEventResource(
        playerId, gameId, previousRating, rating, delta, recordedAt,
        reason, opponentId, result
      ) VALUES (?, ?, ?, ?, ?, ?, 'game', ?, ?)
    `);
    insertEvent.run(
      white.id, id, white.rating, white.rating + whiteDelta,
      whiteDelta, finishedAt, black.id, result,
    );
    insertEvent.run(
      black.id, id, black.rating, black.rating + blackDelta,
      blackDelta, finishedAt, white.id, result,
    );
    this.db.prepare('UPDATE PlayerResource SET rating = ? WHERE id = ?')
      .run(white.rating + whiteDelta, white.id);
    this.db.prepare('UPDATE PlayerResource SET rating = ? WHERE id = ?')
      .run(black.rating + blackDelta, black.id);
    this.assertRatingProjectionIntegrity();
    if (game.eventId !== null) {
      this.db.prepare(`
        UPDATE CheckInResource SET gameId = NULL, placement = NULL, side = NULL
        WHERE eventId = ? AND gameId = ?
      `).run(game.eventId, id);
      if (pairNext) this.pairAvailableSessionPlayers(game.eventId);
    }
    return this.getGame(id);
  }

  listLeaderboard(limit = 100, eventId?: number): LeaderboardEntry[] {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new ValidationError('Leaderboard limit must be an integer between 1 and 200.');
      }
      this.assertRatingProjectionIntegrity();
      if (eventId !== undefined) this.resolveEventId(eventId);
      const membershipJoin = eventId === undefined
        ? ''
        : `INNER JOIN CheckInResource AS ep ON ep.playerId = p.id AND ep.eventId = ?
          LEFT JOIN PairingCohortResource AS cohort
            ON cohort.eventId = ep.eventId AND cohort.playerId = p.id`;
      const sessionRecords = eventId === undefined
        ? `SELECT p.id, 0 AS sessionGamesPlayed, 0 AS sessionWins,
            0 AS sessionLosses, 0 AS sessionDraws
          FROM PlayerResource AS p`
        : `SELECT p.id,
            COUNT(g.id) AS sessionGamesPlayed,
            SUM(CASE
              WHEN (g.whitePlayerId = p.id AND g.result = '1-0')
                OR (g.blackPlayerId = p.id AND g.result = '0-1') THEN 1 ELSE 0 END) AS sessionWins,
            SUM(CASE
              WHEN (g.whitePlayerId = p.id AND g.result = '0-1')
                OR (g.blackPlayerId = p.id AND g.result = '1-0') THEN 1 ELSE 0 END) AS sessionLosses,
            SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS sessionDraws
          FROM PlayerResource AS p
          LEFT JOIN GameResource AS g
            ON g.eventId = ? AND g.result IS NOT NULL AND g.cancelledAt IS NULL
            AND (g.whitePlayerId = p.id OR g.blackPlayerId = p.id)
          GROUP BY p.id`;
      return this.db.prepare(`
        WITH records AS (
          SELECT p.id, p.name, p.scanningIdentifier, p.rating AS currentRating,
            ${eventId === undefined ? '' : 'cohort.cohort, ep.checkedOutAt,'}
            COUNT(g.id) AS gamesPlayed,
            SUM(CASE
              WHEN (g.whitePlayerId = p.id AND g.result = '1-0')
                OR (g.blackPlayerId = p.id AND g.result = '0-1') THEN 1 ELSE 0 END) AS wins,
            SUM(CASE
              WHEN (g.whitePlayerId = p.id AND g.result = '0-1')
                OR (g.blackPlayerId = p.id AND g.result = '1-0') THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
            MAX(g.finishedAt) AS lastPlayedAt
          FROM PlayerResource p
          ${membershipJoin}
          LEFT JOIN GameResource g
            ON g.result IS NOT NULL AND g.cancelledAt IS NULL
            AND (g.whitePlayerId = p.id OR g.blackPlayerId = p.id)
          GROUP BY p.id
        ),
        session_records AS (
          ${sessionRecords}
        )
        SELECT ROW_NUMBER() OVER (
          ORDER BY r.currentRating DESC, r.gamesPlayed DESC,
            r.name COLLATE NOCASE ASC, r.id ASC
          ) AS rank,
          r.*,
          CASE
            ${eventId === undefined ? '' : "WHEN r.checkedOutAt IS NOT NULL THEN 'checked-out'"}
            WHEN ongoing.id IS NULL THEN '${eventId === undefined ? 'not-checked-in' : 'available'}'
            WHEN ongoing.startedAt IS NOT NULL THEN 'playing'
            WHEN ongoing.blackPlayerId IS NULL OR ongoing.whitePlayerId IS NULL THEN 'waiting'
            ELSE 'paired'
          END AS checkInStatus,
          ongoing.tableNumber,
          opponent.name AS opponentName,
          sr.sessionGamesPlayed, sr.sessionWins, sr.sessionLosses, sr.sessionDraws
        FROM records AS r
        INNER JOIN session_records AS sr ON sr.id = r.id
        LEFT JOIN GameResource AS ongoing
          ON ongoing.result IS NULL AND ongoing.cancelledAt IS NULL
          ${eventId === undefined ? '' : 'AND ongoing.eventId = ?'}
          AND (ongoing.whitePlayerId = r.id OR ongoing.blackPlayerId = r.id)
        LEFT JOIN PlayerResource AS opponent
          ON opponent.id = CASE
            WHEN ongoing.whitePlayerId = r.id THEN ongoing.blackPlayerId
            ELSE ongoing.whitePlayerId
          END
        ${eventId === undefined ? '' : 'WHERE r.checkedOutAt IS NULL OR sr.sessionGamesPlayed > 0'}
        ORDER BY r.currentRating DESC, r.gamesPlayed DESC,
          r.name COLLATE NOCASE ASC, r.id ASC
        LIMIT ?
      `).all(...(eventId === undefined
        ? [limit]
        : [eventId, eventId, eventId, limit])) as unknown as LeaderboardEntry[];
  }

  getPlayerProfile(id: number, recentLimit = 10): PlayerProfile {
      if (!Number.isInteger(id) || id < 1000 || id > 2000) {
        throw new ValidationError('Player id must be between 1000 and 2000.');
      }
      if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
        throw new ValidationError('Recent game limit must be an integer between 1 and 50.');
      }
      const player = this.getPlayer(id);
      const entry = this.listLeaderboard(200).find((candidate) => candidate.id === id);
      if (!entry) throw new NotFoundError(`Player ${id} was not found.`);
      const ratingHistory = this.db.prepare(`
        SELECT event.id, event.gameId, event.previousRating, event.rating, event.delta,
          event.recordedAt, event.reason, event.opponentId, event.result,
          opponent.name AS opponentName,
          opponentEvent.previousRating AS opponentRatingBefore,
          opponentEvent.delta AS opponentDelta,
          CASE
            WHEN event.result = '1/2-1/2' THEN 'draw'
            WHEN (event.result = '1-0' AND game.whitePlayerId = event.playerId)
              OR (event.result = '0-1' AND game.blackPlayerId = event.playerId) THEN 'win'
            WHEN event.result IS NOT NULL AND game.id IS NOT NULL THEN 'loss'
            ELSE NULL
          END AS outcome
        FROM RatingEventResource AS event
        LEFT JOIN PlayerResource AS opponent ON opponent.id = event.opponentId
        LEFT JOIN RatingEventResource AS opponentEvent ON opponentEvent.gameId = event.gameId
          AND opponentEvent.playerId = event.opponentId AND opponentEvent.reason = event.reason
        LEFT JOIN GameResource AS game ON game.id = event.gameId
        WHERE event.playerId = ?
        ORDER BY event.id ASC
      `).all(id) as unknown as PlayerProfile['ratingHistory'];
      const recentRows = this.db.prepare(`
        SELECT g.id, g.tableNumber, g.whitePlayerId, g.blackPlayerId, g.result, g.finishedAt,
          opponent.id AS opponentId, opponent.name AS opponentName,
          event.previousRating AS ratingBefore, event.rating AS ratingAfter, event.delta,
          opponentEvent.rating AS opponentRating, opponentEvent.delta AS opponentDelta
        FROM GameResource g
        JOIN RatingEventResource event ON event.gameId = g.id AND event.playerId = ?
        JOIN PlayerResource opponent ON opponent.id = event.opponentId
        JOIN RatingEventResource opponentEvent ON opponentEvent.gameId = g.id
          AND opponentEvent.playerId = opponent.id AND opponentEvent.reason = 'game'
        WHERE g.result IS NOT NULL AND g.cancelledAt IS NULL AND event.reason = 'game'
        ORDER BY g.finishedAt DESC, g.id DESC
        LIMIT ?
      `).all(id, recentLimit) as unknown as Array<{
        id: number; tableNumber: number; whitePlayerId: number; blackPlayerId: number;
        result: GameResult; finishedAt: string; opponentId: number; opponentName: string;
        ratingBefore: number; ratingAfter: number; delta: number;
        opponentRating: number; opponentDelta: number;
      }>;
      return {
        ...entry,
        name: player.name,
        ongoingGames: this.listJoinedGames('ongoing')
          .filter((game) => game.blackPlayerId === id || game.whitePlayerId === id),
        recentGames: recentRows.map((game) => {
          const color = game.whitePlayerId === id ? 'white' as const : 'black' as const;
          const outcome = game.result === '1/2-1/2'
            ? 'D' as const
            : (color === 'white' && game.result === '1-0')
                || (color === 'black' && game.result === '0-1') ? 'W' as const : 'L' as const;
          return {
            id: game.id,
            tableNumber: game.tableNumber,
            opponent: {
              id: game.opponentId,
              name: game.opponentName,
              rating: game.opponentRating,
              delta: game.opponentDelta,
            },
            color,
            result: game.result,
            outcome,
            finishedAt: game.finishedAt,
            ratingBefore: game.ratingBefore,
            ratingAfter: game.ratingAfter,
            delta: game.delta,
          };
        }),
        ratingHistory,
      };
  }
}
