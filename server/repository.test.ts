// @vitest-environment node
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { ChessRepository } from './repository.js';

const testDirectory = resolve(process.cwd(), '.test-data');
const files: string[] = [];

function fixture() {
  mkdirSync(testDirectory, { recursive: true });
  const path = resolve(testDirectory, `repository-${crypto.randomUUID()}.sqlite`);
  files.push(path);
  const db = openDatabase(path);
  return { db, repository: new ChessRepository(db), path };
}

afterEach(() => {
  for (const file of files.splice(0)) rmSync(file, { force: true });
});

describe('ChessRepository', () => {
  it('renames a player without changing ID, Elo, or baseline deletion eligibility', () => {
    const { repository } = fixture();
    const created = repository.upsertPlayer(1000, 'Alice');
    expect(repository.updatePlayerName(1000, '  Alicia  ')).toEqual({
      ...created,
      name: 'Alicia',
    });
    expect(repository.listPlayers()).toEqual([{ id: 1000, name: 'Alicia', rating: 700 }]);
    expect(repository.deletePlayer(1000).name).toBe('Alicia');
    expect(() => repository.updatePlayerName(1000, 'Nobody')).toThrow('was not found');
  });
  it('backfills honest rating history and preserves inconsistent cached ratings', () => {
    const { db, path } = fixture();
    db.exec(`
      INSERT INTO Player(id, name, rating) VALUES
        (1000, 'Alice', 684), (1001, 'Bob', 716), (1002, 'Manual', 950);
      INSERT INTO ChessGame(
        id, tableNumber, createdAt, finishedAt, blackPlayerId, whitePlayerId, result
      ) VALUES (
        1, 1, '2026-01-01T11:00:00.000Z', '2026-01-01T12:00:00.000Z',
        1000, 1001, '1-0'
      );
      DROP TABLE PlayerRatingEvent;
      DELETE FROM schema_migrations WHERE version IN (5, 6);
    `);
    db.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare(`
      SELECT playerId, gameId, previousRating, rating, delta, reason
      FROM PlayerRatingEvent ORDER BY playerId, id
    `).all()).toEqual([
      { playerId: 1000, gameId: null, previousRating: 700, rating: 700, delta: 0, reason: 'baseline' },
      { playerId: 1000, gameId: 1, previousRating: 700, rating: 684, delta: -16, reason: 'game' },
      { playerId: 1001, gameId: null, previousRating: 700, rating: 700, delta: 0, reason: 'baseline' },
      { playerId: 1001, gameId: 1, previousRating: 700, rating: 716, delta: 16, reason: 'game' },
      { playerId: 1002, gameId: null, previousRating: 950, rating: 950, delta: 0, reason: 'migration' },
    ]);
    const reopened = openDatabase(path);
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM PlayerRatingEvent').get())
      .toEqual({ count: 5 });
    reopened.close();
    migrated.close();
  });

  it('lists stable Elo rankings and detailed profiles from ledger events', () => {
    const { db, repository } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    repository.upsertPlayer(1002, 'Carol');
    const game = repository.createGame(1000, 1001);
    repository.finalizeGame(game.id, '1-0', () => '2027-01-02T12:00:00.000Z');
    expect(repository.listLeaderboard()).toEqual([
      expect.objectContaining({ rank: 1, id: 1001, currentRating: 716, wins: 1, gamesPlayed: 1 }),
      expect.objectContaining({ rank: 2, id: 1002, currentRating: 700, gamesPlayed: 0 }),
      expect.objectContaining({ rank: 3, id: 1000, currentRating: 684, losses: 1 }),
    ]);
    expect(repository.getPlayerProfile(1001)).toMatchObject({
      rank: 1,
      currentRating: 716,
      recentGames: [{
        id: game.id,
        opponent: { id: 1000, name: 'Alice', rating: 684, delta: -16 },
        color: 'white',
        outcome: 'W',
        ratingBefore: 700,
        ratingAfter: 716,
        delta: 16,
      }],
      ratingHistory: [
        { reason: 'baseline', rating: 700 },
        { reason: 'game', gameId: game.id, rating: 716 },
      ],
    });
    db.prepare('UPDATE Player SET rating = 999 WHERE id = 1000').run();
    expect(() => repository.assertRatingProjectionIntegrity()).toThrow(
      'Rating projection divergence for player 1000',
    );
    db.close();
  });

  it('migrates idempotently and persists players and games', () => {
    const { db, repository, path } = fixture();
    repository.upsertPlayer(1000, '  Alice  ');
    repository.upsertPlayer(1001, 'Bob');
    const game = repository.createGame(1000, 1001);
    const reopened = openDatabase(path);
    const persisted = new ChessRepository(reopened);
    expect(persisted.listPlayers()).toEqual([
      { id: 1000, name: 'Alice', rating: 700 },
      { id: 1001, name: 'Bob', rating: 700 },
    ]);
    expect(persisted.getGame(game.id)).toEqual(game);
    expect(reopened.prepare('SELECT count(*) AS count FROM schema_migrations').get())
      .toEqual({ count: 6 });
    expect(db.prepare('SELECT count(*) AS count FROM schema_migrations').get())
      .toEqual({ count: 6 });
    reopened.close();
    db.close();
  });

  it('migrates a non-conflicting v1 game and preserves constraints idempotently', () => {
    mkdirSync(testDirectory, { recursive: true });
    const path = resolve(testDirectory, `migration-${crypto.randomUUID()}.sqlite`);
    files.push(path);
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations VALUES (1, 'legacy');
      CREATE TABLE Player (
        id INTEGER PRIMARY KEY CHECK (id BETWEEN 1000 AND 2000),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80)
      ) STRICT;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        blackPlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        whitePlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        CHECK (blackPlayerId <> whitePlayerId)
      ) STRICT;
      INSERT INTO Player VALUES (1000, 'Alice'), (1001, 'Bob');
      INSERT INTO ChessGame(id, blackPlayerId, whitePlayerId) VALUES
        (8, 1000, 1001);
    `);
    legacy.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare(
      'SELECT id, tableNumber, createdAt, blackPlayerId, whitePlayerId FROM ChessGame ORDER BY id',
    ).all()).toEqual([
      { id: 8, tableNumber: 1, createdAt: expect.any(String), blackPlayerId: 1000, whitePlayerId: 1001 },
    ]);
    expect(() => migrated.exec(
      'INSERT INTO ChessGame(tableNumber, blackPlayerId, whitePlayerId) VALUES (2, 1000, 1001)',
    )).toThrow();
    expect(() => migrated.exec(
      'INSERT INTO ChessGame(tableNumber, blackPlayerId, whitePlayerId) VALUES (0, 1000, 1001)',
    )).toThrow();
    migrated.close();
    const reopened = openDatabase(path);
    expect(reopened.prepare('SELECT count(*) AS count FROM ChessGame').get()).toEqual({ count: 1 });
    expect(reopened.prepare('SELECT count(*) AS count FROM schema_migrations').get()).toEqual({ count: 6 });
    reopened.close();
  });

  it('migrates v2 players, game ids, and table numbers to v3 with stable creation ordering', () => {
    mkdirSync(testDirectory, { recursive: true });
    const path = resolve(testDirectory, `migration-v2-${crypto.randomUUID()}.sqlite`);
    files.push(path);
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations VALUES (1, 'legacy'), (2, 'legacy');
      CREATE TABLE Player (
        id INTEGER PRIMARY KEY CHECK (id BETWEEN 1000 AND 2000),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80)
      ) STRICT;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        tableNumber INTEGER NOT NULL UNIQUE CHECK (tableNumber >= 1),
        blackPlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        whitePlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        CHECK (blackPlayerId <> whitePlayerId)
      ) STRICT;
      INSERT INTO Player VALUES
        (1000, 'Alice'), (1001, 'Bob'), (1002, 'Carol'),
        (1003, 'Dan'), (1004, 'Eve'), (1005, 'Frank');
      INSERT INTO ChessGame VALUES
        (4, 3, 1000, 1001),
        (9, 7, 1002, 1003),
        (15, 10, 1004, 1005);
    `);
    legacy.close();

    const migrated = openDatabase(path);
    const rows = migrated.prepare(`
      SELECT id, tableNumber, createdAt, blackPlayerId, whitePlayerId
      FROM ChessGame ORDER BY createdAt, id
    `).all() as Array<Record<string, unknown>>;
    expect(rows.map(({ id, tableNumber, blackPlayerId, whitePlayerId }) => ({
      id, tableNumber, blackPlayerId, whitePlayerId,
    }))).toEqual([
      { id: 4, tableNumber: 3, blackPlayerId: 1000, whitePlayerId: 1001 },
      { id: 9, tableNumber: 7, blackPlayerId: 1002, whitePlayerId: 1003 },
      { id: 15, tableNumber: 10, blackPlayerId: 1004, whitePlayerId: 1005 },
    ]);
    expect(rows.every((row) => typeof row.createdAt === 'string')).toBe(true);
    expect(migrated.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(migrated.prepare(`
      SELECT playerId
      FROM (
        SELECT blackPlayerId AS playerId FROM ChessGame WHERE blackPlayerId IS NOT NULL
        UNION ALL
        SELECT whitePlayerId FROM ChessGame WHERE whitePlayerId IS NOT NULL
      )
      GROUP BY playerId HAVING COUNT(*) > 1
    `).all()).toEqual([]);
    migrated.close();
  });

  it('fails v3 migration before changing duplicate legacy games and gives recovery steps', () => {
    mkdirSync(testDirectory, { recursive: true });
    const path = resolve(testDirectory, `duplicate-v2-${crypto.randomUUID()}.sqlite`);
    files.push(path);
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations VALUES (1, 'legacy'), (2, 'legacy');
      CREATE TABLE Player (
        id INTEGER PRIMARY KEY CHECK (id BETWEEN 1000 AND 2000),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80)
      ) STRICT;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        tableNumber INTEGER NOT NULL UNIQUE CHECK (tableNumber >= 1),
        blackPlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        whitePlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        CHECK (blackPlayerId <> whitePlayerId)
      ) STRICT;
      INSERT INTO Player VALUES (1000, 'Alice'), (1001, 'Bob'), (1002, 'Carol');
      INSERT INTO ChessGame VALUES
        (4, 3, 1000, 1001),
        (9, 7, 1002, 1000);
    `);
    legacy.close();

    expect(() => openDatabase(path)).toThrow(
      /player 1000 occupies 2 active seats.*Back up the database.*resolve duplicate/s,
    );
    const verify = new DatabaseSync(path);
    expect(verify.prepare('SELECT * FROM ChessGame ORDER BY id').all()).toEqual([
      { id: 4, tableNumber: 3, blackPlayerId: 1000, whitePlayerId: 1001 },
      { id: 9, tableNumber: 7, blackPlayerId: 1002, whitePlayerId: 1000 },
    ]);
    expect(verify.prepare('PRAGMA table_info(ChessGame)').all()
      .map((column) => (column as { name: string }).name))
      .toEqual(['id', 'tableNumber', 'blackPlayerId', 'whitePlayerId']);
    expect(verify.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual([{ version: 1 }, { version: 2 }]);
    expect(verify.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ChessGame_v2'
    `).get()).toBeUndefined();
    verify.close();
  });

  it('rejects a marked-v3 database that violates the duplicate invariant without an active transaction', () => {
    mkdirSync(testDirectory, { recursive: true });
    const path = resolve(testDirectory, `invalid-v3-${crypto.randomUUID()}.sqlite`);
    files.push(path);
    const invalid = new DatabaseSync(path);
    invalid.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations VALUES (1, 'legacy'), (2, 'legacy'), (3, 'legacy');
      CREATE TABLE Player (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        tableNumber INTEGER NOT NULL UNIQUE,
        createdAt TEXT NOT NULL,
        blackPlayerId INTEGER,
        whitePlayerId INTEGER
      ) STRICT;
      INSERT INTO Player VALUES (1000, 'Alice'), (1001, 'Bob'), (1002, 'Carol');
      INSERT INTO ChessGame VALUES
        (1, 1, '2026-01-01T00:00:00.000Z', 1000, 1001),
        (2, 2, '2026-01-02T00:00:00.000Z', 1002, 1000);
    `);
    invalid.close();
    expect(() => openDatabase(path)).toThrow(
      /player 1000 occupies 2 active seats.*Back up the database.*resolve duplicate/s,
    );
    const verify = new DatabaseSync(path);
    expect(verify.isTransaction).toBe(false);
    expect(verify.prepare('SELECT COUNT(*) AS count FROM ChessGame').get()).toEqual({ count: 2 });
    verify.close();
  });

  it('allocates the lowest free table and rolls back failed game creation', () => {
    const { db, repository } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    repository.upsertPlayer(1002, 'Carol');
    repository.upsertPlayer(1003, 'Dan');
    repository.upsertPlayer(1004, 'Eve');
    repository.upsertPlayer(1005, 'Frank');
    const first = repository.createGame(1000, 1001);
    const second = repository.createGame(1002, 1003);
    expect([first.tableNumber, second.tableNumber]).toEqual([1, 2]);
    repository.deleteGame(first.id);
    expect(repository.createGame(1000, 1001).tableNumber).toBe(1);
    expect(() => repository.createGame(1004, 1999)).toThrow(NotFoundError);
    expect(() => repository.createGame(1004, 1004)).toThrow(ValidationError);
    expect(repository.createGame(1004, 1005).tableNumber).toBe(3);
    db.close();
  });

  it('creates players uniformly from the available pool and reports exhaustion', () => {
    const { db } = fixture();
    const limits: number[] = [];
    const repository = new ChessRepository(db, (limit) => {
      limits.push(limit);
      return limit - 1;
    });
    expect(repository.createPlayer('  Last  ')).toEqual({ id: 2000, name: 'Last', rating: 700 });
    expect(limits).toEqual([1001]);
    repository.upsertPlayer(1500, 'Taken');
    expect(repository.createPlayer('Next')).toEqual({ id: 1999, name: 'Next', rating: 700 });
    expect(limits).toEqual([1001, 999]);

    const insert = db.prepare('INSERT OR IGNORE INTO Player(id, name) VALUES (?, ?)');
    for (let id = 1000; id <= 2000; id += 1) insert.run(id, `P${id}`);
    expect(() => repository.createPlayer('Overflow')).toThrow(/No player IDs are available/);
    expect(repository.listPlayers()).toHaveLength(1001);
    db.close();

    const low = fixture();
    expect(new ChessRepository(low.db, () => 0).createPlayer('First'))
      .toEqual({ id: 1000, name: 'First', rating: 700 });
    low.db.close();
  });

  it('deletes only unreferenced players with exactly one baseline event atomically', () => {
    const { db, repository } = fixture();
    const removable = repository.createPlayer('Removable');
    expect(repository.deletePlayer(removable.id)).toEqual(removable);
    expect(() => repository.getPlayer(removable.id)).toThrow(NotFoundError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM PlayerRatingEvent WHERE playerId = ?')
      .get(removable.id)).toEqual({ count: 0 });

    const referenced = repository.createPlayer('Referenced');
    const opponent = repository.createPlayer('Opponent');
    repository.createGame(referenced.id, opponent.id);
    expect(() => repository.deletePlayer(referenced.id)).toThrow(ConflictError);
    expect(repository.getPlayer(referenced.id)).toEqual(referenced);
    expect(db.prepare('SELECT COUNT(*) AS count FROM PlayerRatingEvent WHERE playerId = ?')
      .get(referenced.id)).toEqual({ count: 1 });

    const historical = repository.createPlayer('Historical');
    db.prepare(`
      INSERT INTO PlayerRatingEvent(
        playerId, previousRating, rating, delta, recordedAt, reason
      ) VALUES (?, 700, 700, 0, ?, 'migration')
    `).run(historical.id, '2026-01-01T00:00:00.000Z');
    expect(() => repository.deletePlayer(historical.id)).toThrow(ConflictError);
    expect(repository.getPlayer(historical.id)).toEqual(historical);
    expect(db.prepare('SELECT COUNT(*) AS count FROM PlayerRatingEvent WHERE playerId = ?')
      .get(historical.id)).toEqual({ count: 2 });
    db.close();
  });

  it('enforces player, game, foreign-key, and deletion constraints', () => {
    const { db, repository } = fixture();
    expect(() => repository.upsertPlayer(999, 'Alice')).toThrow(ValidationError);
    expect(() => repository.upsertPlayer(1000, '   ')).toThrow(ValidationError);
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    expect(() => repository.createGame(1000, 1000)).toThrow(ValidationError);
    expect(() => repository.createGame(1000, 1002)).toThrow(NotFoundError);
    repository.createGame(1000, 1001);
    expect(() => repository.deletePlayer(1000)).toThrow(ConflictError);
    db.close();
  });

  it('checks in to a random side, pairs into the oldest waiting game, and is idempotent', () => {
    const { db, repository } = fixture();
    const waiting = repository.checkInPlayer(
      { id: 1000, name: 'Alice' },
      () => 0,
      () => '2026-01-02T00:00:00.000Z',
    );
    expect(waiting).toMatchObject({
      status: 'waiting', side: 'black',
      game: { tableNumber: 1, blackPlayerId: 1000, whitePlayerId: null },
    });
    expect(repository.checkInPlayer({ id: 1000, name: 'Alice Updated' })).toMatchObject({
      status: 'already-checked-in', side: 'black', game: { id: waiting.game.id },
    });
    expect(repository.getPlayer(1000).name).toBe('Alice Updated');
    expect(repository.checkInPlayer({ id: 1001, name: 'Bob' })).toMatchObject({
      status: 'paired', side: 'white', game: { id: waiting.game.id },
    });
    repository.upsertPlayer(1003, 'Dave');
    repository.upsertPlayer(1004, 'Eve');
    db.exec(`
      INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
      VALUES
        (2, '2026-01-03T00:00:00.000Z', 1003, NULL),
        (3, '2026-01-01T00:00:00.000Z', NULL, 1004);
    `);
    const paired = repository.checkInPlayer({ id: 1002, name: 'Carol' });
    expect(paired).toMatchObject({
      status: 'paired', side: 'black',
      game: { tableNumber: 3, blackPlayerId: 1002, whitePlayerId: 1004 },
    });
    expect(repository.listGames()).toHaveLength(3);
    db.close();
  });

  it('uses both random sides, fills the empty side, reuses table gaps, and rolls back errors', () => {
    const { db, repository } = fixture();
    const white = repository.checkInPlayer(
      { id: 1000, name: 'White' },
      () => 1,
      () => '2026-01-01T00:00:00.000Z',
    );
    expect(white).toMatchObject({
      status: 'waiting', side: 'white',
      game: { tableNumber: 1, blackPlayerId: null, whitePlayerId: 1000 },
    });
    expect(repository.checkInPlayer({ id: 1001, name: 'Black' })).toMatchObject({
      status: 'paired', side: 'black',
      game: { tableNumber: 1, blackPlayerId: 1001, whitePlayerId: 1000 },
    });
    repository.upsertPlayer(1002, 'A');
    repository.upsertPlayer(1003, 'B');
    const tableTwo = repository.createGame(1002, 1003);
    repository.deleteGame(white.game.id);
    const gap = repository.checkInPlayer({ id: 1004, name: 'Gap' }, () => 0);
    expect(gap.game.tableNumber).toBe(1);
    repository.deleteGame(gap.game.id);
    repository.deleteGame(tableTwo.id);

    expect(() => repository.checkInPlayer({ id: 1005, name: 'Rollback' }, () => 2))
      .toThrow(/Random side/);
    expect(() => repository.getPlayer(1005)).toThrow(NotFoundError);
    db.close();
  });

  it('enforces nullable-seat, foreign-key, and global participation constraints in SQLite', () => {
    const { db, repository } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    repository.upsertPlayer(1002, 'Carol');
    db.prepare(`
      INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
      VALUES (1, '2026-01-01T00:00:00.000Z', 1000, NULL)
    `).run();
    expect(() => db.exec(`
      INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
      VALUES (2, '2026-01-01T00:00:01.000Z', NULL, 1000)
    `)).toThrow(/already belongs/);
    expect(() => db.exec(`
      INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
      VALUES (2, '2026-01-01T00:00:01.000Z', NULL, NULL)
    `)).not.toThrow();
    expect(() => db.exec(`
      INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
      VALUES (2, '2026-01-01T00:00:01.000Z', 1001, 1001)
    `)).toThrow(/CHECK/);
    expect(() => db.exec(`
      INSERT INTO ChessGame(tableNumber, createdAt, blackPlayerId, whitePlayerId)
      VALUES (3, '2026-01-01T00:00:01.000Z', 1999, NULL)
    `)).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it('finalizes exactly once, updates Elo atomically, and frees players and tables', () => {
    const { db, repository } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    const game = repository.createGame(1000, 1001);
    const finalized = repository.finalizeGame(
      game.id,
      '1-0',
      () => '2026-05-01T12:00:00.000Z',
    );
    expect(finalized).toMatchObject({
      result: '1-0',
      finishedAt: '2026-05-01T12:00:00.000Z',
    });
    expect(repository.getPlayer(1000).rating).toBe(684);
    expect(repository.getPlayer(1001).rating).toBe(716);
    expect(() => repository.finalizeGame(game.id, '0-1')).toThrow(ConflictError);
    expect(repository.deleteGame(game.id).cancelledAt).not.toBeNull();
    expect(repository.getPlayer(1000).rating).toBe(700);
    expect(repository.getPlayer(1001).rating).toBe(700);

    const next = repository.createGame(1000, 1001);
    expect(next.tableNumber).toBe(game.tableNumber);
    expect(repository.listJoinedGames('ongoing')).toHaveLength(1);
    expect(repository.listJoinedGames('finished', 20)).toMatchObject([{ id: game.id }]);
    db.close();
  });

  it('rejects finalizing a waiting game or an invalid result without rating changes', () => {
    const { db, repository } = fixture();
    const waiting = repository.checkInPlayer({ id: 1000, name: 'Alice' }, () => 0);
    expect(() => repository.finalizeGame(waiting.game.id, '1-0')).toThrow(ValidationError);
    repository.upsertPlayer(1001, 'Bob');
    repository.checkInPlayer({ id: 1001, name: 'Bob' });
    expect(() => repository.finalizeGame(waiting.game.id, 'W' as never)).toThrow(ValidationError);
    expect(repository.getPlayer(1000).rating).toBe(700);
    expect(repository.getPlayer(1001).rating).toBe(700);
    db.close();
  });

  it('cancels an active game and supports transactional seat removal and replacement', () => {
    const { db, repository } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    repository.upsertPlayer(1002, 'Carol');
    repository.upsertPlayer(1003, 'Dave');
    const game = repository.createGame(1000, 1001);
    expect(repository.updateGameSeat(game.id, 'black', null).blackPlayerId).toBeNull();
    expect(repository.updateGameSeat(game.id, 'black', 1002).blackPlayerId).toBe(1002);
    expect(() => repository.updateGameSeat(game.id, 'white', 1002)).toThrow(ValidationError);
    const occupied = repository.createGame(1000, 1003);
    expect(() => repository.updateGameSeat(game.id, 'black', 1000)).toThrow(ConflictError);
    expect(repository.cancelGame(occupied.id, 'mistake', () => '2026-06-01T00:00:00.000Z'))
      .toMatchObject({ cancelledAt: '2026-06-01T00:00:00.000Z', cancellationReason: 'mistake' });
    expect(repository.listJoinedGames('ongoing').map(({ id }) => id)).toEqual([game.id]);
    expect(repository.cancelGame(occupied.id).id).toBe(occupied.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM PlayerRatingEvent WHERE gameId = ?').get(occupied.id))
      .toEqual({ count: 0 });
    db.close();
  });

  it('compensates immutable finished Elo exactly once and excludes cancellation from records', () => {
    const { db, repository } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    const game = repository.createGame(1000, 1001);
    repository.finalizeGame(game.id, '1-0', () => '2026-06-01T00:00:00.000Z');
    const cancelled = repository.cancelGame(game.id, undefined, () => '2026-06-02T00:00:00.000Z');
    expect(cancelled.cancelledAt).toBe('2026-06-02T00:00:00.000Z');
    expect(repository.getPlayer(1000).rating).toBe(700);
    expect(repository.getPlayer(1001).rating).toBe(700);
    expect(repository.listLeaderboard()).toEqual([
      expect.objectContaining({ id: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0 }),
      expect.objectContaining({ id: 1001, gamesPlayed: 0, wins: 0, losses: 0, draws: 0 }),
    ]);
    expect(repository.getPlayerProfile(1000).recentGames).toEqual([]);
    expect(repository.getPlayerProfile(1000).ratingHistory.map(({ reason, delta }) => ({ reason, delta })))
      .toEqual([
        { reason: 'baseline', delta: 0 },
        { reason: 'game', delta: -16 },
        { reason: 'compensation', delta: 16 },
      ]);
    expect(repository.cancelGame(game.id).cancelledAt).toBe(cancelled.cancelledAt);
    expect(db.prepare(`
      SELECT reason, COUNT(*) AS count FROM PlayerRatingEvent
      WHERE gameId = ? GROUP BY reason ORDER BY reason
    `).all(game.id)).toEqual([
      { reason: 'compensation', count: 2 },
      { reason: 'game', count: 2 },
    ]);
    db.close();
  });

  it('blocks cancellation for either or both players after later ledger-ordered games', () => {
    const { db, repository } = fixture();
    for (const [id, name] of [[1000, 'Alice'], [1001, 'Bob'], [1002, 'Carol'], [1003, 'Dave']] as const) {
      repository.upsertPlayer(id, name);
    }
    const first = repository.createGame(1000, 1001);
    repository.finalizeGame(first.id, '1-0', () => '2026-06-01T00:00:00.000Z');
    const aliceLater = repository.createGame(1000, 1002);
    repository.finalizeGame(aliceLater.id, '1/2-1/2', () => '2026-06-01T00:00:00.000Z');
    expect(() => repository.cancelGame(first.id)).toThrow(
      'Alice has played other games. Cancelling this game would affect their Elo and other players’ Elo. Contact your administrator.',
    );
    const bobLater = repository.createGame(1001, 1003);
    repository.finalizeGame(bobLater.id, '0-1', () => '2026-06-02T00:00:00.000Z');
    expect(() => repository.cancelGame(first.id)).toThrow(/Alice and Bob have played other games/);
    expect(repository.getGame(first.id).cancelledAt).toBeNull();
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM PlayerRatingEvent WHERE gameId = ? AND reason = 'compensation'
    `).get(first.id)).toEqual({ count: 0 });
    db.close();
  });

  it('maps PGN results to the correct side for wins, draws, and unequal ratings', () => {
    const { db, repository } = fixture();
    const finish = (
      blackId: number,
      whiteId: number,
      result: '1-0' | '0-1' | '1/2-1/2',
    ) => repository.finalizeGame(repository.createGame(blackId, whiteId).id, result);
    for (let id = 1000; id <= 1007; id += 1) repository.upsertPlayer(id, `Player ${id}`);

    finish(1000, 1001, '1-0');
    expect([repository.getPlayer(1000).rating, repository.getPlayer(1001).rating])
      .toEqual([684, 716]);

    finish(1002, 1003, '0-1');
    expect([repository.getPlayer(1002).rating, repository.getPlayer(1003).rating])
      .toEqual([716, 684]);

    finish(1004, 1005, '1/2-1/2');
    expect([repository.getPlayer(1004).rating, repository.getPlayer(1005).rating])
      .toEqual([700, 700]);

    db.prepare(`
      INSERT INTO PlayerRatingEvent(
        playerId, previousRating, rating, delta, recordedAt, reason
      ) VALUES (1006, 700, 900, 200, '2026-01-01T00:00:00.000Z', 'migration')
    `).run();
    db.prepare('UPDATE Player SET rating = 900 WHERE id = 1006').run();
    finish(1006, 1007, '1-0');
    expect([repository.getPlayer(1006).rating, repository.getPlayer(1007).rating])
      .toEqual([876, 724]);
    db.close();
  });
});
