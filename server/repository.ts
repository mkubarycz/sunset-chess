import type { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { calculateElo, INITIAL_RATING } from './ratings.js';

export interface Player {
  id: number;
  name: string;
  rating: number;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export interface ChessGame {
  id: number;
  tableNumber: number;
  createdAt: string;
  blackPlayerId: number | null;
  whitePlayerId: number | null;
  finishedAt: string | null;
  result: GameResult | null;
}

export interface JoinedChessGame extends ChessGame {
  blackPlayer: Player | null;
  whitePlayer: Player | null;
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
}

export interface RatingEvent {
  id: number;
  gameId: number | null;
  previousRating: number;
  rating: number;
  delta: number;
  recordedAt: string;
  reason: 'baseline' | 'game' | 'migration';
  opponentId: number | null;
  result: GameResult | null;
}

export interface PlayerProfile extends LeaderboardEntry {
  recentGames: Array<{
    id: number;
    tableNumber: number;
    opponent: { id: number; name: string };
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
export type CheckInResult = {
  status: 'paired' | 'waiting' | 'already-checked-in';
  game: JoinedChessGame;
  side: CheckInSide;
};

function playerRow(row: unknown): Player {
  return row as Player;
}

function gameRow(row: unknown): ChessGame {
  return row as ChessGame;
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

  listPlayers(): Player[] {
    this.assertRatingProjectionIntegrity();
    return this.db.prepare(`
      SELECT p.id, p.name, COALESCE((
        SELECT rating FROM PlayerRatingEvent
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS rating
      FROM Player p ORDER BY p.id
    `).all().map(playerRow);
  }

  getPlayer(id: number): Player {
    const row = this.db.prepare(`
      SELECT p.id, p.name, p.rating AS cachedRating, COALESCE((
        SELECT rating FROM PlayerRatingEvent
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS rating
      FROM Player p WHERE p.id = ?
    `).get(id) as unknown as (Player & { cachedRating: number }) | undefined;
    if (!row) throw new NotFoundError(`Player ${id} was not found.`);
    if (row.cachedRating !== row.rating) {
      throw new Error(`Rating projection divergence for player ${id}: cache ${row.cachedRating}, ledger ${row.rating}.`);
    }
    return { id: row.id, name: row.name, rating: row.rating };
  }

  assertRatingProjectionIntegrity(): void {
    const divergent = this.db.prepare(`
      SELECT p.id, p.rating AS cachedRating, COALESCE((
        SELECT rating FROM PlayerRatingEvent
        WHERE playerId = p.id ORDER BY id DESC LIMIT 1
      ), 700) AS ledgerRating
      FROM Player p
      WHERE p.rating <> COALESCE((
        SELECT rating FROM PlayerRatingEvent
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
      INSERT INTO PlayerRatingEvent(
        playerId, previousRating, rating, delta, recordedAt, reason
      )
      SELECT ?, 700, 700, 0, ?, 'baseline'
      WHERE NOT EXISTS (SELECT 1 FROM PlayerRatingEvent WHERE playerId = ?)
    `).run(playerId, recordedAt, playerId);
  }

  upsertPlayer(id: number, rawName: string): Player {
    const name = validatePlayerInput(id, rawName);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO Player(id, name) VALUES (?, ?)
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

  createPlayer(rawName: string): Player {
    const name = rawName.trim();
    if (!name || name.length > 80) throw new ValidationError('Player name must contain 1 to 80 characters.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = new Set(
        this.db.prepare('SELECT id FROM Player WHERE id BETWEEN 1000 AND 2000').all()
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
      this.db.prepare('INSERT INTO Player(id, name) VALUES (?, ?)').run(id, name);
      this.ensureBaseline(id);
      this.db.exec('COMMIT');
      return { id, name, rating: INITIAL_RATING };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  deletePlayer(id: number): Player {
    const player = this.getPlayer(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        DELETE FROM PlayerRatingEvent
        WHERE playerId = ? AND reason = 'baseline'
          AND NOT EXISTS (
            SELECT 1 FROM PlayerRatingEvent WHERE playerId = ? AND reason <> 'baseline'
          )
      `).run(id, id);
      this.db.prepare('DELETE FROM Player WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (sqliteMessage(error).includes('FOREIGN KEY')) {
        throw new ConflictError(`Player ${id} cannot be deleted while referenced by a game.`);
      }
      throw error;
    }
    return player;
  }

  listGames(): ChessGame[] {
    return this.db.prepare(
      `SELECT id, tableNumber, createdAt, blackPlayerId, whitePlayerId, finishedAt, result
       FROM ChessGame ORDER BY CASE WHEN result IS NULL THEN 0 ELSE 1 END, tableNumber`,
    ).all().map(gameRow);
  }

  listJoinedGames(result: 'ongoing' | 'finished' = 'ongoing', limit?: number): JoinedChessGame[] {
    this.assertRatingProjectionIntegrity();
    const where = result === 'ongoing' ? 'g.result IS NULL' : 'g.result IS NOT NULL';
    const order = result === 'ongoing'
      ? 'g.tableNumber'
      : 'g.finishedAt DESC, g.id DESC';
    const limitSql = limit === undefined ? '' : ' LIMIT ?';
    return this.db.prepare(`
      SELECT
        g.id, g.tableNumber, g.createdAt, g.finishedAt, g.result,
        g.blackPlayerId, g.whitePlayerId,
        black.name AS blackPlayerName, black.rating AS blackPlayerRating,
        white.name AS whitePlayerName, white.rating AS whitePlayerRating
      FROM ChessGame AS g
      LEFT JOIN Player AS black ON black.id = g.blackPlayerId
      LEFT JOIN Player AS white ON white.id = g.whitePlayerId
      WHERE ${where}
      ORDER BY ${order}${limitSql}
    `).all(...(limit === undefined ? [] : [limit])).map((row) => {
      const value = row as unknown as ChessGame & {
        blackPlayerName: string | null;
        blackPlayerRating: number | null;
        whitePlayerName: string | null;
        whitePlayerRating: number | null;
      };
      return {
        id: value.id,
        tableNumber: value.tableNumber,
        createdAt: value.createdAt,
        blackPlayerId: value.blackPlayerId,
        whitePlayerId: value.whitePlayerId,
        finishedAt: value.finishedAt,
        result: value.result,
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

  getGame(id: number): ChessGame {
    const row = this.db.prepare(
      `SELECT id, tableNumber, createdAt, blackPlayerId, whitePlayerId, finishedAt, result
       FROM ChessGame WHERE id = ?`,
    ).get(id);
    if (!row) throw new NotFoundError(`Game ${id} was not found.`);
    return gameRow(row);
  }

  createGame(blackPlayerId: number, whitePlayerId: number): ChessGame {
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
          SELECT tableNumber + 1 FROM ChessGame WHERE result IS NULL
        )
        WHERE NOT EXISTS (
          SELECT 1 FROM ChessGame WHERE tableNumber = candidate AND result IS NULL
        )
        ORDER BY candidate
        LIMIT 1
      `).get() as { tableNumber: number };
      const result = this.db.prepare(
        'INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId) VALUES (?, ?, ?, ?)',
      ).run(table.tableNumber, new Date().toISOString(), blackPlayerId, whitePlayerId);
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

  checkInPlayer(
    player: Pick<Player, 'id' | 'name'>,
    rng: (maxExclusive: number) => number = randomInt,
    now: () => string = () => new Date().toISOString(),
  ): CheckInResult {
    const name = validatePlayerInput(player.id, player.name);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO Player(id, name) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(player.id, name);
      this.ensureBaseline(player.id, now());

      const existing = this.db.prepare(`
        SELECT id, blackPlayerId, whitePlayerId
        FROM ChessGame
        WHERE result IS NULL AND (blackPlayerId = ? OR whitePlayerId = ?)
        LIMIT 1
      `).get(player.id, player.id) as {
        id: number; blackPlayerId: number | null; whitePlayerId: number | null
      } | undefined;
      if (existing) {
        const side: CheckInSide = existing.blackPlayerId === player.id ? 'black' : 'white';
        const game = this.getJoinedGame(existing.id);
        this.db.exec('COMMIT');
        return { status: 'already-checked-in', game, side };
      }

      const waiting = this.db.prepare(`
        SELECT id, blackPlayerId, whitePlayerId
        FROM ChessGame
        WHERE result IS NULL AND (blackPlayerId IS NULL) <> (whitePlayerId IS NULL)
        ORDER BY createdAt ASC, id ASC
        LIMIT 1
      `).get() as {
        id: number; blackPlayerId: number | null; whitePlayerId: number | null
      } | undefined;
      if (waiting) {
        const side: CheckInSide = waiting.blackPlayerId === null ? 'black' : 'white';
        this.db.prepare(
          `UPDATE ChessGame SET ${side === 'black' ? 'blackPlayerId' : 'whitePlayerId'} = ? WHERE id = ?`,
        ).run(player.id, waiting.id);
        const game = this.getJoinedGame(waiting.id);
        this.db.exec('COMMIT');
        return { status: 'paired', game, side };
      }

      const sideIndex = rng(2);
      if (sideIndex !== 0 && sideIndex !== 1) {
        throw new Error('Random side source must return 0 or 1.');
      }
      const side: CheckInSide = sideIndex === 0 ? 'black' : 'white';
      const table = this.lowestAvailableTable();
      const createdAt = now();
      if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      const result = this.db.prepare(`
        INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
        VALUES (?, ?, ?, ?)
      `).run(
        table,
        createdAt,
        side === 'black' ? player.id : null,
        side === 'white' ? player.id : null,
      );
      const game = this.getJoinedGame(Number(result.lastInsertRowid));
      this.db.exec('COMMIT');
      return { status: 'waiting', game, side };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private lowestAvailableTable(): number {
    const row = this.db.prepare(`
      SELECT candidate AS tableNumber
      FROM (
        SELECT 1 AS candidate
        UNION ALL
        SELECT tableNumber + 1 FROM ChessGame WHERE result IS NULL
      )
      WHERE NOT EXISTS (
        SELECT 1 FROM ChessGame WHERE tableNumber = candidate AND result IS NULL
      )
      ORDER BY candidate
      LIMIT 1
    `).get() as { tableNumber: number };
    return row.tableNumber;
  }

  private getJoinedGame(id: number): JoinedChessGame {
    const game = this.listJoinedGames('ongoing').find((candidate) => candidate.id === id);
    if (!game) throw new Error(`Game ${id} disappeared during check-in.`);
    return game;
  }

  deleteGame(id: number): ChessGame {
    const game = this.getGame(id);
    if (game.result !== null) {
      throw new ConflictError(`Finalized game ${id} cannot be deleted without an audited correction workflow.`);
    }
    this.db.prepare('DELETE FROM ChessGame WHERE id = ?').run(id);
    return game;
  }

  finalizeGame(id: number, result: GameResult, now = () => new Date().toISOString()): ChessGame {
    if (!['1-0', '0-1', '1/2-1/2'].includes(result)) {
      throw new ValidationError('Result must be 1-0, 0-1, or 1/2-1/2.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const game = this.getGame(id);
      if (game.result !== null) throw new ConflictError(`Game ${id} already has a final result.`);
      if (game.blackPlayerId === null || game.whitePlayerId === null) {
        throw new ValidationError('Both seats must be occupied before setting a result.');
      }
      const black = this.getPlayer(game.blackPlayerId);
      const white = this.getPlayer(game.whitePlayerId);
      const finishedAt = now();
      if (typeof finishedAt !== 'string' || Number.isNaN(Date.parse(finishedAt))) {
        throw new Error('Clock source returned an invalid ISO timestamp.');
      }
      const updated = this.db.prepare(`
        UPDATE ChessGame SET result = ?, finishedAt = ?
        WHERE id = ? AND result IS NULL
      `).run(result, finishedAt, id);
      if (updated.changes !== 1) throw new ConflictError(`Game ${id} already has a final result.`);
      const { whiteDelta, blackDelta } = calculateElo(white.rating, black.rating, result);
      const insertEvent = this.db.prepare(`
        INSERT INTO PlayerRatingEvent(
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
      this.db.prepare('UPDATE Player SET rating = ? WHERE id = ?')
        .run(white.rating + whiteDelta, white.id);
      this.db.prepare('UPDATE Player SET rating = ? WHERE id = ?')
        .run(black.rating + blackDelta, black.id);
      this.assertRatingProjectionIntegrity();
      const finalized = this.getGame(id);
      this.db.exec('COMMIT');
      return finalized;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listLeaderboard(limit = 100): LeaderboardEntry[] {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new ValidationError('Leaderboard limit must be an integer between 1 and 200.');
      }
      this.assertRatingProjectionIntegrity();
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
          FROM Player p
          LEFT JOIN ChessGame g
            ON g.result IS NOT NULL AND (g.whitePlayerId = p.id OR g.blackPlayerId = p.id)
          GROUP BY p.id
        )
        SELECT ROW_NUMBER() OVER (
          ORDER BY currentRating DESC, gamesPlayed DESC, name COLLATE NOCASE ASC, id ASC
        ) AS rank, *
        FROM records
        ORDER BY currentRating DESC, gamesPlayed DESC, name COLLATE NOCASE ASC, id ASC
        LIMIT ?
      `).all(limit) as unknown as LeaderboardEntry[];
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
        FROM PlayerRatingEvent WHERE playerId = ?
        ORDER BY recordedAt ASC, id ASC
      `).all(id) as unknown as RatingEvent[];
      const recentRows = this.db.prepare(`
        SELECT g.id, g.tableNumber, g.whitePlayerId, g.blackPlayerId, g.result, g.finishedAt,
          opponent.id AS opponentId, opponent.name AS opponentName,
          event.previousRating AS ratingBefore, event.rating AS ratingAfter, event.delta
        FROM ChessGame g
        JOIN PlayerRatingEvent event ON event.gameId = g.id AND event.playerId = ?
        JOIN Player opponent ON opponent.id = event.opponentId
        WHERE g.result IS NOT NULL
        ORDER BY g.finishedAt DESC, g.id DESC
        LIMIT ?
      `).all(id, recentLimit) as unknown as Array<{
        id: number; tableNumber: number; whitePlayerId: number; blackPlayerId: number;
        result: GameResult; finishedAt: string; opponentId: number; opponentName: string;
        ratingBefore: number; ratingAfter: number; delta: number;
      }>;
      return {
        ...entry,
        name: player.name,
        recentGames: recentRows.map((game) => {
          const color = game.whitePlayerId === id ? 'white' as const : 'black' as const;
          const outcome = game.result === '1/2-1/2'
            ? 'D' as const
            : (color === 'white' && game.result === '1-0')
                || (color === 'black' && game.result === '0-1') ? 'W' as const : 'L' as const;
          return {
            id: game.id,
            tableNumber: game.tableNumber,
            opponent: { id: game.opponentId, name: game.opponentName },
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
