import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrations = [
  {
    version: 1,
    sql: `
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
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE ChessGame RENAME TO ChessGame_v1;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        tableNumber INTEGER NOT NULL UNIQUE CHECK (tableNumber >= 1),
        blackPlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        whitePlayerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        CHECK (blackPlayerId <> whitePlayerId)
      ) STRICT;
      INSERT INTO ChessGame(id, tableNumber, blackPlayerId, whitePlayerId)
      SELECT id, ROW_NUMBER() OVER (ORDER BY id), blackPlayerId, whitePlayerId
      FROM ChessGame_v1
      ORDER BY id;
      DROP TABLE ChessGame_v1;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE ChessGame RENAME TO ChessGame_v2;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        tableNumber INTEGER NOT NULL UNIQUE CHECK (tableNumber >= 1),
        createdAt TEXT NOT NULL CHECK (
          length(createdAt) >= 20 AND datetime(createdAt) IS NOT NULL
        ),
        blackPlayerId INTEGER REFERENCES Player(id) ON DELETE RESTRICT,
        whitePlayerId INTEGER REFERENCES Player(id) ON DELETE RESTRICT,
        CHECK (blackPlayerId IS NOT NULL OR whitePlayerId IS NOT NULL),
        CHECK (
          blackPlayerId IS NULL OR whitePlayerId IS NULL
          OR blackPlayerId <> whitePlayerId
        )
      ) STRICT;
      WITH reconciled AS (
        SELECT
          game.id,
          game.tableNumber,
          CASE WHEN game.id = (
            SELECT MIN(other.id)
            FROM ChessGame_v2 AS other
            WHERE other.blackPlayerId = game.blackPlayerId
               OR other.whitePlayerId = game.blackPlayerId
          ) THEN game.blackPlayerId ELSE NULL END AS blackPlayerId,
          CASE WHEN game.id = (
            SELECT MIN(other.id)
            FROM ChessGame_v2 AS other
            WHERE other.blackPlayerId = game.whitePlayerId
               OR other.whitePlayerId = game.whitePlayerId
          ) THEN game.whitePlayerId ELSE NULL END AS whitePlayerId
        FROM ChessGame_v2 AS game
      )
      INSERT INTO ChessGame(id, tableNumber, createdAt, blackPlayerId, whitePlayerId)
      SELECT id, tableNumber, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             blackPlayerId, whitePlayerId
      FROM reconciled
      WHERE blackPlayerId IS NOT NULL OR whitePlayerId IS NOT NULL
      ORDER BY id;
      DROP TABLE ChessGame_v2;

      CREATE TRIGGER ChessGame_unique_player_insert
      BEFORE INSERT ON ChessGame
      WHEN EXISTS (
        SELECT 1 FROM ChessGame
        WHERE blackPlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
           OR whitePlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
      )
      BEGIN
        SELECT RAISE(ABORT, 'player already belongs to an ongoing game');
      END;

      CREATE TRIGGER ChessGame_unique_player_update
      BEFORE UPDATE OF blackPlayerId, whitePlayerId ON ChessGame
      WHEN EXISTS (
        SELECT 1 FROM ChessGame
        WHERE id <> OLD.id
          AND (
            blackPlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
            OR whitePlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'player already belongs to an ongoing game');
      END;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE Player ADD COLUMN rating INTEGER NOT NULL DEFAULT 700;

      DROP TRIGGER ChessGame_unique_player_insert;
      DROP TRIGGER ChessGame_unique_player_update;
      ALTER TABLE ChessGame RENAME TO ChessGame_v3;
      CREATE TABLE ChessGame (
        id INTEGER PRIMARY KEY,
        tableNumber INTEGER NOT NULL CHECK (tableNumber >= 1),
        createdAt TEXT NOT NULL CHECK (
          length(createdAt) >= 20 AND datetime(createdAt) IS NOT NULL
        ),
        finishedAt TEXT CHECK (
          finishedAt IS NULL OR (length(finishedAt) >= 20 AND datetime(finishedAt) IS NOT NULL)
        ),
        blackPlayerId INTEGER REFERENCES Player(id) ON DELETE RESTRICT,
        whitePlayerId INTEGER REFERENCES Player(id) ON DELETE RESTRICT,
        result TEXT CHECK (result IS NULL OR result IN ('1-0', '0-1', '1/2-1/2')),
        CHECK (blackPlayerId IS NOT NULL OR whitePlayerId IS NOT NULL),
        CHECK (
          blackPlayerId IS NULL OR whitePlayerId IS NULL
          OR blackPlayerId <> whitePlayerId
        ),
        CHECK (result IS NULL OR (
          blackPlayerId IS NOT NULL AND whitePlayerId IS NOT NULL AND finishedAt IS NOT NULL
        )),
        CHECK (result IS NOT NULL OR finishedAt IS NULL)
      ) STRICT;
      INSERT INTO ChessGame(
        id, tableNumber, createdAt, finishedAt, blackPlayerId, whitePlayerId, result
      )
      SELECT id, tableNumber, createdAt, NULL, blackPlayerId, whitePlayerId, NULL
      FROM ChessGame_v3;
      DROP TABLE ChessGame_v3;

      CREATE UNIQUE INDEX ChessGame_ongoing_table
      ON ChessGame(tableNumber) WHERE result IS NULL;

      CREATE TRIGGER ChessGame_unique_player_insert
      BEFORE INSERT ON ChessGame
      WHEN NEW.result IS NULL AND EXISTS (
        SELECT 1 FROM ChessGame
        WHERE result IS NULL AND (
          blackPlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
          OR whitePlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'player already belongs to an ongoing game');
      END;

      CREATE TRIGGER ChessGame_unique_player_update
      BEFORE UPDATE OF blackPlayerId, whitePlayerId, result ON ChessGame
      WHEN NEW.result IS NULL AND EXISTS (
        SELECT 1 FROM ChessGame
        WHERE id <> OLD.id AND result IS NULL AND (
          blackPlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
          OR whitePlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'player already belongs to an ongoing game');
      END;
    `,
  },
] as const;

function assertUniqueGameParticipation(db: DatabaseSync): void {
  const hasResult = (db.prepare('PRAGMA table_info(ChessGame)').all() as Array<{ name: string }>)
    .some((column) => column.name === 'result');
  const duplicate = db.prepare(`
    SELECT playerId, COUNT(*) AS appearances
    FROM (
      SELECT blackPlayerId AS playerId FROM ChessGame
      WHERE blackPlayerId IS NOT NULL ${hasResult ? 'AND result IS NULL' : ''}
      UNION ALL
      SELECT whitePlayerId AS playerId FROM ChessGame
      WHERE whitePlayerId IS NOT NULL ${hasResult ? 'AND result IS NULL' : ''}
    )
    GROUP BY playerId
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get() as { playerId: number; appearances: number } | undefined;
  if (duplicate) {
    throw new Error(`Migration v3 duplicate invariant failed for player ${duplicate.playerId}.`);
  }
}

export function defaultDatabasePath(): string {
  return resolve(process.cwd(), '.data', 'sunset-chess.sqlite');
}

export function openDatabase(path = process.env.SUNSET_CHESS_DB_PATH || defaultDatabasePath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  for (const migration of migrations) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const applied = db.prepare(
        'SELECT 1 FROM schema_migrations WHERE version = ?',
      ).get(migration.version);
      if (applied) {
        if (migration.version === 3) assertUniqueGameParticipation(db);
        db.exec('COMMIT');
        continue;
      }
      db.exec(migration.sql);
      if (migration.version === 3) assertUniqueGameParticipation(db);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}

export function checkDatabase(db: DatabaseSync): void {
  db.prepare('SELECT 1').get();
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number };
  if (foreignKeys.foreign_keys !== 1) throw new Error('SQLite foreign keys are disabled.');
}
