import type { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { calculateElo, INITIAL_RATING } from './ratings.js';

export interface PlayerResource {
  id: number;
  name: string;
  rating: number;
}
export type Player = PlayerResource;

export type GameResult = '1-0' | '0-1' | '1/2-1/2';
export type PairingMode = 'club-session-pairing-1';
type PairingCohortCode = 'A' | 'B' | 'C' | 'D';

export interface GameResource {
  id: number;
  tableNumber: number;
  createdAt: string;
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
  blackPlayer: PlayerResource | null;
  whitePlayer: PlayerResource | null;
  blackStartingRating: number | null;
  whiteStartingRating: number | null;
  blackRatingDelta: number | null;
  whiteRatingDelta: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  id: number;
  name: string;
  currentRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastPlayedAt: string | null;
  checkInStatus: 'not-checked-in' | 'waiting' | 'playing';
  tableNumber: number | null;
  opponentName: string | null;
  sessionGamesPlayed: number;
  sessionWins: number;
  sessionLosses: number;
  sessionDraws: number;
}

export interface ClubSession {
  id: number;
  type: 'club-session';
  name: string;
  createdAt: string;
  closedAt: string | null;
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
  ratingHistory: RatingEvent[];
}

export type RandomIndex = (maxExclusive: number) => number;
export type CheckInSide = 'black' | 'white';
export interface CheckIn {
  id: number;
  eventId: number | null;
  playerId: number;
  checkedInAt: string;
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
  blackPlayerId?: number | null;
  whitePlayerId?: number | null;
  result?: GameResult;
  cancel?: boolean;
  cancellationReason?: string;
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

export class ChessRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly randomIndex: RandomIndex = randomInt,
  ) {}

  listClubSessions(): ClubSession[] {
    return (this.db.prepare(`
      SELECT e.id, e.type, e.name, e.createdAt, e.closedAt, e.active, e.pairingMode,
        COUNT(DISTINCT ep.playerId) AS playerCount,
        COUNT(DISTINCT g.id) AS gameCount,
        COUNT(DISTINCT CASE
          WHEN g.result IS NULL AND g.cancelledAt IS NULL THEN g.id
        END) AS activeGameCount
      FROM ClubSessionResource AS e
      LEFT JOIN CheckInResource AS ep ON ep.eventId = e.id
      LEFT JOIN GameResource AS g ON g.eventId = e.id
      WHERE e.type = 'club-session'
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
      SELECT id, eventId, playerId, checkedInAt, gameId, placement, side
      FROM CheckInResource
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY checkedInAt DESC, id DESC
    `).all(...parameters) as unknown as CheckIn[];
  }

  getCheckIn(id: number): CheckIn {
    const checkIn = this.db.prepare(`
      SELECT id, eventId, playerId, checkedInAt, gameId, placement, side
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
      UPDATE ClubSessionResource SET name = ? WHERE id = ? AND type = 'club-session'
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
      WHERE id = ? AND type = 'club-session'
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
        SELECT id, active FROM ClubSessionResource WHERE id = ? AND type = 'club-session'
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
          this.finalizeGameInTransaction(game.id, '1/2-1/2', closedAt);
        }
      }
      this.db.prepare(`
        UPDATE ClubSessionResource SET active = 0, closedAt = ? WHERE id = ? AND active = 1
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
      SELECT p.id, p.name, COALESCE((
        SELECT rating FROM RatingEventResource
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS rating
      FROM PlayerResource p ORDER BY p.id
    `).all().map(playerRow);
  }

  listSeatOptions(gameId: number): LeaderboardEntry[] {
    const game = this.getGame(gameId);
    if (game.result !== null || game.cancelledAt !== null) {
      throw new ConflictError('Player options are available only for an ongoing game.');
    }
    const eligibleIds = new Set((this.db.prepare(`
      SELECT p.id
      FROM PlayerResource AS p
      WHERE p.id IS NOT ? AND p.id IS NOT ?
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM CheckInResource AS ep
          WHERE ep.eventId = ? AND ep.playerId = p.id
        ))
        AND NOT EXISTS (
          SELECT 1 FROM GameResource AS active
          WHERE active.result IS NULL AND active.cancelledAt IS NULL
            AND active.id <> ?
            AND (active.blackPlayerId = p.id OR active.whitePlayerId = p.id)
            AND (
              (active.blackPlayerId IS NOT NULL AND active.whitePlayerId IS NOT NULL)
              OR active.eventId IS NOT ?
            )
        )
    `).all(
      game.blackPlayerId,
      game.whitePlayerId,
      game.eventId,
      game.eventId,
      game.id,
      game.eventId,
    ) as unknown as Array<{ id: number }>).map(({ id }) => id));
    return this.listLeaderboard(200, game.eventId ?? undefined)
      .filter(({ id }) => eligibleIds.has(id));
  }

  getPlayer(id: number): PlayerResource {
    const row = this.db.prepare(`
      SELECT p.id, p.name, p.rating AS cachedRating, COALESCE((
        SELECT rating FROM RatingEventResource
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS rating
      FROM PlayerResource p WHERE p.id = ?
    `).get(id) as unknown as (PlayerResource & { cachedRating: number }) | undefined;
    if (!row) throw new NotFoundError(`Player ${id} was not found.`);
    if (row.cachedRating !== row.rating) {
      throw new Error(`Rating projection divergence for player ${id}: cache ${row.cachedRating}, ledger ${row.rating}.`);
    }
    return { id: row.id, name: row.name, rating: row.rating };
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
      return { id, name, rating: INITIAL_RATING };
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
              cancelledAt, cancellationReason, eventId
       FROM GameResource ORDER BY CASE WHEN result IS NULL AND cancelledAt IS NULL THEN 0 ELSE 1 END, tableNumber`,
    ).all().map(gameRow);
  }

  listJoinedGames(
    result: 'ongoing' | 'finished' = 'ongoing',
    limit?: number,
    eventId?: number,
  ): JoinedChessGame[] {
    this.assertRatingProjectionIntegrity();
    const statusWhere = result === 'ongoing'
      ? 'g.result IS NULL AND g.cancelledAt IS NULL'
      : '(g.result IS NOT NULL OR g.cancelledAt IS NOT NULL)';
    const where = `${statusWhere}${eventId === undefined ? '' : ' AND g.eventId = ?'}`;
    const order = result === 'ongoing'
      ? 'g.tableNumber'
      : 'COALESCE(g.cancelledAt, g.finishedAt, g.createdAt) DESC, g.id DESC';
    const limitSql = limit === undefined ? '' : ' LIMIT ?';
    const parameters = [
      ...(eventId === undefined ? [] : [eventId]),
      ...(limit === undefined ? [] : [limit]),
    ];
    return this.db.prepare(`
      SELECT
        g.id, g.tableNumber, g.createdAt, g.finishedAt, g.result,
        g.cancelledAt, g.cancellationReason, g.eventId,
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
              cancelledAt, cancellationReason, eventId
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
      const result = this.db.prepare(
        `INSERT INTO GameResource(tableNumber, createdAt, blackPlayerId, whitePlayerId, eventId)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(table.tableNumber, new Date().toISOString(), blackPlayerId, whitePlayerId, resolvedEventId);
      const game = this.getGame(Number(result.lastInsertRowid));
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
      const result = this.db.prepare(`
        INSERT INTO GameResource(tableNumber, createdAt, blackPlayerId, whitePlayerId, eventId)
        VALUES (?, ?, NULL, NULL, ?)
      `).run(this.lowestAvailableTable(), createdAt, this.resolveEventId(eventId));
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
      const activeEventId = this.resolveEventId(undefined);
      if (activeEventId !== null) {
        this.ensureSessionPairingCohort(activeEventId, player.id);
        this.db.prepare(`
          INSERT INTO CheckInResource(eventId, playerId, checkedInAt)
          VALUES (?, ?, ?)
          ON CONFLICT DO NOTHING
        `).run(activeEventId, player.id, checkedInAt);
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
            AND eventId IS NULL
            AND (blackPlayerId IS NULL) <> (whitePlayerId IS NULL)
          ORDER BY createdAt ASC, id ASC
          LIMIT 1
        `).get()
        : this.findClubSessionPairing(activeEventId, player.id);
      const typedWaiting = waiting as {
        id: number; blackPlayerId: number | null; whitePlayerId: number | null
      } | undefined;
      if (typedWaiting) {
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
          AND (eventId IS ? OR (eventId IS NULL AND ? IS NOT NULL))
          AND blackPlayerId IS NULL AND whitePlayerId IS NULL
        ORDER BY CASE WHEN eventId IS ? THEN 0 ELSE 1 END,
          tableNumber ASC, createdAt ASC, id ASC
        LIMIT 1
      `).get(activeEventId, activeEventId, activeEventId) as { id: number } | undefined;
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
          SET gameId = COALESCE(gameId, ?),
              placement = COALESCE(placement, ?),
              side = COALESCE(side, ?)
          WHERE id = ?
        `).run(gameId, placement, side, id);
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
  ): { id: number; blackPlayerId: number | null; whitePlayerId: number | null } | undefined {
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
          AND g.result IS NULL AND g.cancelledAt IS NULL
          AND (g.blackPlayerId IS NULL) <> (g.whitePlayerId IS NULL)
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
      WHERE NOT EXISTS (
        SELECT 1 FROM completed AS prior
        WHERE (prior.blackPlayerId = ? AND prior.whitePlayerId = candidate.opponentId)
           OR (prior.whitePlayerId = ? AND prior.blackPlayerId = candidate.opponentId)
      )
      ORDER BY CASE
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
      playerId,
      playerId,
      playerId,
    ) as {
      id: number;
      blackPlayerId: number | null;
      whitePlayerId: number | null;
    } | undefined;
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
        SELECT 1 FROM ClubSessionResource WHERE id = ? AND type = 'club-session'
      `).get(eventId);
      if (!exists) throw new NotFoundError(`Club session ${eventId} was not found.`);
      return eventId;
    }
    const active = this.db.prepare(`
      SELECT id FROM ClubSessionResource WHERE type = 'club-session' AND active = 1
    `).get() as { id: number } | undefined;
    return active?.id ?? null;
  }

  private getJoinedGame(id: number): JoinedChessGame {
    const game = this.listJoinedGames('ongoing').find((candidate) => candidate.id === id);
    if (!game) throw new Error(`Game ${id} disappeared during check-in.`);
    return game;
  }

  deleteGame(id: number): GameResource {
    return this.cancelGame(id);
  }

  updateGameSeat(id: number, side: CheckInSide, playerId: number | null): GameResource {
    if (side !== 'black' && side !== 'white') throw new ValidationError('Side must be black or white.');
    if (playerId !== null && (!Number.isInteger(playerId) || playerId < 1000 || playerId > 2000)) {
      throw new ValidationError('playerId must be null or an integer between 1000 and 2000.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.updateGameSeatInTransaction(id, side, playerId);
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
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (update.blackPlayerId !== undefined) {
        this.updateGameSeatInTransaction(id, 'black', update.blackPlayerId);
      }
      if (update.whitePlayerId !== undefined) {
        this.updateGameSeatInTransaction(id, 'white', update.whitePlayerId);
      }
      let game = this.getGame(id);
      if (update.result !== undefined) {
        const finishedAt = now();
        if (typeof finishedAt !== 'string' || Number.isNaN(Date.parse(finishedAt))) {
          throw new Error('Clock source returned an invalid ISO timestamp.');
        }
        game = this.finalizeGameInTransaction(id, update.result, finishedAt);
      }
      if (update.cancel) {
        game = this.cancelGameInTransaction(id, cancellationReason, now);
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
  ): GameResource {
    const game = this.getGame(id);
    if (game.result !== null || game.cancelledAt !== null) {
      throw new ConflictError('Only a non-cancelled unfinished game can have a seat changed.');
    }
    const opponentId = side === 'black' ? game.whitePlayerId : game.blackPlayerId;
    if (playerId !== null) {
      this.getPlayer(playerId);
      if (playerId === opponentId) throw new ValidationError('A player cannot occupy both seats.');
      if (game.eventId !== null && !this.db.prepare(`
        SELECT 1 FROM CheckInResource WHERE eventId = ? AND playerId = ?
      `).get(game.eventId, playerId)) {
        throw new ConflictError('Player has not checked into this Club Session.');
      }
      const existing = this.db.prepare(`
        SELECT * FROM GameResource
        WHERE result IS NULL AND cancelledAt IS NULL
          AND (blackPlayerId = ? OR whitePlayerId = ?)
        LIMIT 1
      `).get(playerId, playerId) as GameResource | undefined;
      if (existing && existing.id !== game.id) {
        if (existing.blackPlayerId !== null && existing.whitePlayerId !== null) {
          throw new ConflictError('Replacement player belongs to another active game.');
        }
        if (existing.eventId !== game.eventId) {
          throw new ConflictError('Players can only move between tables in the same event.');
        }
        this.db.prepare('DELETE FROM GameResource WHERE id = ?').run(existing.id);
      }
    }
    this.db.prepare(`
      UPDATE GameResource
      SET ${side === 'black' ? 'blackPlayerId' : 'whitePlayerId'} = ?
      WHERE id = ?
    `).run(playerId, id);
    return this.getGame(id);
  }

  moveWaitingPlayer(playerId: number, destinationGameId: number): JoinedChessGame {
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
      if (destination.result !== null || destination.cancelledAt !== null
        || (destination.blackPlayerId === null) === (destination.whitePlayerId === null)) {
        throw new ConflictError('Destination table is not waiting for a player.');
      }
      if (destination.eventId !== source.eventId) {
        throw new ConflictError('Players can only move between tables in the same event.');
      }
      const side: CheckInSide = destination.blackPlayerId === null ? 'black' : 'white';
      this.db.prepare('DELETE FROM GameResource WHERE id = ?').run(source.id);
      this.db.prepare(
        `UPDATE GameResource SET ${side === 'black' ? 'blackPlayerId' : 'whitePlayerId'} = ? WHERE id = ?`,
      ).run(playerId, destination.id);
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

  cancelGame(id: number, rawReason?: string, now = () => new Date().toISOString()): GameResource {
    const reason = rawReason?.trim() || null;
    if (reason && reason.length > 500) throw new ValidationError('Cancellation reason must be at most 500 characters.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cancelled = this.cancelGameInTransaction(id, reason, now);
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
  ): GameResource {
    const game = this.getGame(id);
    if (game.cancelledAt !== null) return game;
    if (game.result === null) {
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

  private finalizeGameInTransaction(id: number, result: GameResult, finishedAt: string): GameResource {
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
        : 'INNER JOIN CheckInResource AS ep ON ep.playerId = p.id AND ep.eventId = ?';
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
          SELECT p.id, p.name, p.rating AS currentRating,
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
            WHEN ongoing.id IS NULL THEN 'not-checked-in'
            WHEN ongoing.blackPlayerId IS NULL OR ongoing.whitePlayerId IS NULL THEN 'waiting'
            ELSE 'playing'
          END AS checkInStatus,
          ongoing.tableNumber,
          opponent.name AS opponentName,
          sr.sessionGamesPlayed, sr.sessionWins, sr.sessionLosses, sr.sessionDraws
        FROM records AS r
        INNER JOIN session_records AS sr ON sr.id = r.id
        LEFT JOIN GameResource AS ongoing
          ON ongoing.result IS NULL AND ongoing.cancelledAt IS NULL
          AND (ongoing.whitePlayerId = r.id OR ongoing.blackPlayerId = r.id)
        LEFT JOIN PlayerResource AS opponent
          ON opponent.id = CASE
            WHEN ongoing.whitePlayerId = r.id THEN ongoing.blackPlayerId
            ELSE ongoing.whitePlayerId
          END
        ORDER BY r.currentRating DESC, r.gamesPlayed DESC,
          r.name COLLATE NOCASE ASC, r.id ASC
        LIMIT ?
      `).all(...(eventId === undefined
        ? [limit]
        : [eventId, eventId, limit])) as unknown as LeaderboardEntry[];
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
        SELECT id, gameId, previousRating, rating, delta, recordedAt, reason, opponentId, result
        FROM RatingEventResource WHERE playerId = ?
        ORDER BY id ASC
      `).all(id) as unknown as RatingEvent[];
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
