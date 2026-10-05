import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { calculateElo, INITIAL_RATING } from './ratings.js';

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
  {
    version: 5,
    sql: `
      CREATE TABLE PlayerRatingEvent (
        id INTEGER PRIMARY KEY,
        playerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        gameId INTEGER REFERENCES ChessGame(id) ON DELETE RESTRICT,
        previousRating INTEGER NOT NULL CHECK (previousRating BETWEEN 0 AND 10000),
        rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 10000),
        delta INTEGER NOT NULL CHECK (delta BETWEEN -1000 AND 1000),
        recordedAt TEXT NOT NULL CHECK (
          length(recordedAt) >= 20 AND datetime(recordedAt) IS NOT NULL
        ),
        reason TEXT NOT NULL CHECK (reason IN ('baseline', 'game', 'migration')),
        opponentId INTEGER REFERENCES Player(id) ON DELETE RESTRICT,
        result TEXT CHECK (result IS NULL OR result IN ('1-0', '0-1', '1/2-1/2')),
        CHECK (rating = previousRating + delta),
        CHECK (
          (reason = 'game' AND gameId IS NOT NULL AND opponentId IS NOT NULL AND result IS NOT NULL)
          OR (reason <> 'game' AND gameId IS NULL AND opponentId IS NULL AND result IS NULL)
        )
      ) STRICT;
      CREATE UNIQUE INDEX PlayerRatingEvent_player_game
      ON PlayerRatingEvent(playerId, gameId) WHERE gameId IS NOT NULL;
      CREATE INDEX PlayerRatingEvent_player_latest
      ON PlayerRatingEvent(playerId, id DESC);
      CREATE INDEX PlayerRatingEvent_leaderboard
      ON PlayerRatingEvent(rating DESC, playerId, recordedAt DESC);
      CREATE INDEX PlayerRatingEvent_game ON PlayerRatingEvent(gameId);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TEMP TABLE PlayerRatingEvent_backup AS SELECT * FROM PlayerRatingEvent;
      DROP TABLE PlayerRatingEvent;
      DROP TRIGGER ChessGame_unique_player_insert;
      DROP TRIGGER ChessGame_unique_player_update;
      DROP INDEX ChessGame_ongoing_table;
      ALTER TABLE ChessGame RENAME TO ChessGame_v5;
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
        cancelledAt TEXT CHECK (
          cancelledAt IS NULL OR (length(cancelledAt) >= 20 AND datetime(cancelledAt) IS NOT NULL)
        ),
        cancellationReason TEXT CHECK (
          cancellationReason IS NULL OR length(trim(cancellationReason)) BETWEEN 1 AND 500
        ),
        CHECK (
          blackPlayerId IS NULL OR whitePlayerId IS NULL
          OR blackPlayerId <> whitePlayerId
        ),
        CHECK (result IS NULL OR (
          blackPlayerId IS NOT NULL AND whitePlayerId IS NOT NULL AND finishedAt IS NOT NULL
        )),
        CHECK (result IS NOT NULL OR finishedAt IS NULL),
        CHECK (cancelledAt IS NOT NULL OR cancellationReason IS NULL)
      ) STRICT;
      INSERT INTO ChessGame(
        id, tableNumber, createdAt, finishedAt, blackPlayerId, whitePlayerId, result,
        cancelledAt, cancellationReason
      )
      SELECT id, tableNumber, createdAt, finishedAt, blackPlayerId, whitePlayerId, result,
             NULL, NULL
      FROM ChessGame_v5;
      DROP TABLE ChessGame_v5;

      CREATE UNIQUE INDEX ChessGame_ongoing_table
      ON ChessGame(tableNumber) WHERE result IS NULL AND cancelledAt IS NULL;

      CREATE TRIGGER ChessGame_unique_player_insert
      BEFORE INSERT ON ChessGame
      WHEN NEW.result IS NULL AND NEW.cancelledAt IS NULL AND EXISTS (
        SELECT 1 FROM ChessGame
        WHERE result IS NULL AND cancelledAt IS NULL AND (
          blackPlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
          OR whitePlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'player already belongs to an ongoing game');
      END;

      CREATE TRIGGER ChessGame_unique_player_update
      BEFORE UPDATE OF blackPlayerId, whitePlayerId, result, cancelledAt ON ChessGame
      WHEN NEW.result IS NULL AND NEW.cancelledAt IS NULL AND EXISTS (
        SELECT 1 FROM ChessGame
        WHERE id <> OLD.id AND result IS NULL AND cancelledAt IS NULL AND (
          blackPlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
          OR whitePlayerId IN (NEW.blackPlayerId, NEW.whitePlayerId)
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'player already belongs to an ongoing game');
      END;

      CREATE TABLE PlayerRatingEvent (
        id INTEGER PRIMARY KEY,
        playerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        gameId INTEGER REFERENCES ChessGame(id) ON DELETE RESTRICT,
        previousRating INTEGER NOT NULL CHECK (previousRating BETWEEN 0 AND 10000),
        rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 10000),
        delta INTEGER NOT NULL CHECK (delta BETWEEN -1000 AND 1000),
        recordedAt TEXT NOT NULL CHECK (
          length(recordedAt) >= 20 AND datetime(recordedAt) IS NOT NULL
        ),
        reason TEXT NOT NULL CHECK (reason IN ('baseline', 'game', 'migration', 'compensation')),
        opponentId INTEGER REFERENCES Player(id) ON DELETE RESTRICT,
        result TEXT CHECK (result IS NULL OR result IN ('1-0', '0-1', '1/2-1/2')),
        CHECK (rating = previousRating + delta),
        CHECK (
          (reason IN ('game', 'compensation') AND gameId IS NOT NULL
            AND opponentId IS NOT NULL AND result IS NOT NULL)
          OR (reason NOT IN ('game', 'compensation')
            AND gameId IS NULL AND opponentId IS NULL AND result IS NULL)
        )
      ) STRICT;
      INSERT INTO PlayerRatingEvent
      SELECT * FROM PlayerRatingEvent_backup;
      DROP TABLE PlayerRatingEvent_backup;
      CREATE UNIQUE INDEX PlayerRatingEvent_player_game_reason
      ON PlayerRatingEvent(playerId, gameId, reason)
      WHERE gameId IS NOT NULL;
      CREATE INDEX PlayerRatingEvent_player_latest
      ON PlayerRatingEvent(playerId, id DESC);
      CREATE INDEX PlayerRatingEvent_leaderboard
      ON PlayerRatingEvent(rating DESC, playerId, recordedAt DESC);
      CREATE INDEX PlayerRatingEvent_game ON PlayerRatingEvent(gameId);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE ClubEvent (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL CHECK (type = 'club-session'),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        createdAt TEXT NOT NULL CHECK (
          length(createdAt) >= 20 AND datetime(createdAt) IS NOT NULL
        ),
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
      ) STRICT;
      CREATE UNIQUE INDEX ClubEvent_one_active_session
      ON ClubEvent(active) WHERE active = 1;

      CREATE TABLE ClubEventPlayer (
        eventId INTEGER NOT NULL REFERENCES ClubEvent(id) ON DELETE RESTRICT,
        playerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        checkedInAt TEXT NOT NULL CHECK (
          length(checkedInAt) >= 20 AND datetime(checkedInAt) IS NOT NULL
        ),
        PRIMARY KEY (eventId, playerId)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX ClubEventPlayer_player ON ClubEventPlayer(playerId, eventId);

      ALTER TABLE ChessGame ADD COLUMN eventId INTEGER REFERENCES ClubEvent(id) ON DELETE RESTRICT;
      CREATE INDEX ChessGame_event_status
      ON ChessGame(eventId, result, cancelledAt, tableNumber);
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE ClubEvent ADD COLUMN closedAt TEXT CHECK (
        closedAt IS NULL OR (length(closedAt) >= 20 AND datetime(closedAt) IS NOT NULL)
      );
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE ClubEvent ADD COLUMN pairingMode TEXT NOT NULL
      DEFAULT 'club-session-pairing-1'
      CHECK (pairingMode = 'club-session-pairing-1');

      CREATE TABLE ClubEventPairingCohort (
        eventId INTEGER NOT NULL REFERENCES ClubEvent(id) ON DELETE RESTRICT,
        playerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        cohort TEXT NOT NULL CHECK (cohort IN ('A', 'B', 'C', 'D')),
        snapshotRating INTEGER NOT NULL CHECK (snapshotRating BETWEEN 0 AND 10000),
        PRIMARY KEY (eventId, playerId)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX ClubEventPairingCohort_lookup
      ON ClubEventPairingCohort(eventId, cohort, snapshotRating DESC, playerId);

      INSERT INTO ClubEventPairingCohort(eventId, playerId, cohort, snapshotRating)
      SELECT e.id, ranked.id,
        CASE ranked.bucket WHEN 1 THEN 'A' WHEN 2 THEN 'B' WHEN 3 THEN 'C' ELSE 'D' END,
        ranked.rating
      FROM ClubEvent AS e
      CROSS JOIN (
        SELECT id, rating, NTILE(4) OVER (ORDER BY rating DESC, id ASC) AS bucket
        FROM Player
      ) AS ranked
      WHERE e.type = 'club-session';
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE Player RENAME TO PlayerResource;
      ALTER TABLE ChessGame RENAME TO GameResource;
      ALTER TABLE PlayerRatingEvent RENAME TO RatingEventResource;
      ALTER TABLE ClubEvent RENAME TO ClubSessionResource;
      ALTER TABLE ClubEventPairingCohort RENAME TO PairingCohortResource;
      ALTER TABLE ClubEventPlayer RENAME TO CheckInResource_v9;

      CREATE TABLE CheckInResource (
        id INTEGER PRIMARY KEY,
        eventId INTEGER REFERENCES ClubSessionResource(id) ON DELETE RESTRICT,
        playerId INTEGER NOT NULL REFERENCES PlayerResource(id) ON DELETE RESTRICT,
        checkedInAt TEXT NOT NULL CHECK (
          length(checkedInAt) >= 20 AND datetime(checkedInAt) IS NOT NULL
        ),
        gameId INTEGER REFERENCES GameResource(id) ON DELETE SET NULL,
        placement TEXT CHECK (
          placement IS NULL OR placement IN ('paired', 'waiting', 'already-checked-in')
        ),
        side TEXT CHECK (side IS NULL OR side IN ('black', 'white')),
        CHECK (
          (placement IS NULL AND side IS NULL)
          OR (placement IS NOT NULL AND side IS NOT NULL)
        )
      ) STRICT;
      CREATE UNIQUE INDEX CheckInResource_session_player
      ON CheckInResource(eventId, playerId) WHERE eventId IS NOT NULL;
      CREATE UNIQUE INDEX CheckInResource_standalone_game_player
      ON CheckInResource(gameId, playerId) WHERE eventId IS NULL;
      CREATE INDEX CheckInResource_player ON CheckInResource(playerId, eventId);
      INSERT INTO CheckInResource(eventId, playerId, checkedInAt)
      SELECT eventId, playerId, checkedInAt FROM CheckInResource_v9;
      UPDATE CheckInResource
      SET
        gameId = (
          SELECT g.id FROM GameResource AS g
          WHERE g.eventId = CheckInResource.eventId
            AND g.result IS NULL AND g.cancelledAt IS NULL
            AND (g.blackPlayerId = CheckInResource.playerId
              OR g.whitePlayerId = CheckInResource.playerId)
          ORDER BY g.id LIMIT 1
        ),
        placement = (
          SELECT CASE
            WHEN g.blackPlayerId IS NOT NULL AND g.whitePlayerId IS NOT NULL THEN 'paired'
            ELSE 'waiting'
          END
          FROM GameResource AS g
          WHERE g.eventId = CheckInResource.eventId
            AND g.result IS NULL AND g.cancelledAt IS NULL
            AND (g.blackPlayerId = CheckInResource.playerId
              OR g.whitePlayerId = CheckInResource.playerId)
          ORDER BY g.id LIMIT 1
        ),
        side = (
          SELECT CASE WHEN g.blackPlayerId = CheckInResource.playerId THEN 'black' ELSE 'white' END
          FROM GameResource AS g
          WHERE g.eventId = CheckInResource.eventId
            AND g.result IS NULL AND g.cancelledAt IS NULL
            AND (g.blackPlayerId = CheckInResource.playerId
              OR g.whitePlayerId = CheckInResource.playerId)
          ORDER BY g.id LIMIT 1
        )
      WHERE EXISTS (
        SELECT 1 FROM GameResource AS g
        WHERE g.eventId = CheckInResource.eventId
          AND g.result IS NULL AND g.cancelledAt IS NULL
          AND (g.blackPlayerId = CheckInResource.playerId
            OR g.whitePlayerId = CheckInResource.playerId)
      );
      DROP TABLE CheckInResource_v9;

      DROP INDEX IF EXISTS ClubEvent_one_active_session;
      CREATE UNIQUE INDEX ClubSessionResource_one_active
      ON ClubSessionResource(active) WHERE active = 1;
      DROP INDEX IF EXISTS ChessGame_event_status;
      CREATE INDEX GameResource_session_status
      ON GameResource(eventId, result, cancelledAt, tableNumber);
      DROP INDEX IF EXISTS ClubEventPairingCohort_lookup;
      CREATE INDEX PairingCohortResource_lookup
      ON PairingCohortResource(eventId, cohort, snapshotRating DESC, playerId);
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE PlayerResource ADD COLUMN scanningIdentifier TEXT
        CHECK (
          scanningIdentifier IS NULL
          OR length(scanningIdentifier) BETWEEN 1 AND 2048
        );
      CREATE UNIQUE INDEX PlayerResource_scanning_identifier
      ON PlayerResource(scanningIdentifier) WHERE scanningIdentifier IS NOT NULL;
    `,
  },
] as const;

function backfillRatingLedger(db: DatabaseSync, recordedAt: string): void {
  const players = db.prepare('SELECT id, rating FROM Player ORDER BY id').all() as unknown as
    Array<{ id: number; rating: number }>;
  if (players.length === 0) return;
  const ratings = new Map(players.map((player) => [player.id, INITIAL_RATING]));
  const histories = new Map<number, Array<{
    gameId: number; previousRating: number; rating: number; delta: number;
    recordedAt: string; opponentId: number; result: '1-0' | '0-1' | '1/2-1/2';
  }>>();
  for (const player of players) histories.set(player.id, []);
  const games = db.prepare(`
    SELECT id, blackPlayerId, whitePlayerId, result, finishedAt
    FROM ChessGame WHERE result IS NOT NULL
    ORDER BY finishedAt ASC, id ASC
  `).all() as unknown as Array<{
    id: number; blackPlayerId: number; whitePlayerId: number;
    result: '1-0' | '0-1' | '1/2-1/2'; finishedAt: string;
  }>;
  for (const game of games) {
    const whiteBefore = ratings.get(game.whitePlayerId) ?? INITIAL_RATING;
    const blackBefore = ratings.get(game.blackPlayerId) ?? INITIAL_RATING;
    const { whiteDelta, blackDelta } = calculateElo(whiteBefore, blackBefore, game.result);
    const whiteAfter = whiteBefore + whiteDelta;
    const blackAfter = blackBefore + blackDelta;
    ratings.set(game.whitePlayerId, whiteAfter);
    ratings.set(game.blackPlayerId, blackAfter);
    histories.get(game.whitePlayerId)?.push({
      gameId: game.id, previousRating: whiteBefore, rating: whiteAfter,
      delta: whiteDelta, recordedAt: game.finishedAt,
      opponentId: game.blackPlayerId, result: game.result,
    });
    histories.get(game.blackPlayerId)?.push({
      gameId: game.id, previousRating: blackBefore, rating: blackAfter,
      delta: blackDelta, recordedAt: game.finishedAt,
      opponentId: game.whitePlayerId, result: game.result,
    });
  }
  const insert = db.prepare(`
    INSERT INTO PlayerRatingEvent(
      playerId, gameId, previousRating, rating, delta, recordedAt, reason, opponentId, result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const player of players) {
    const history = histories.get(player.id) ?? [];
    const consistent = ratings.get(player.id) === player.rating;
    if (!consistent) {
      insert.run(player.id, null, player.rating, player.rating, 0, recordedAt, 'migration', null, null);
      continue;
    }
    const baselineAt = history[0]?.recordedAt ?? recordedAt;
    insert.run(player.id, null, INITIAL_RATING, INITIAL_RATING, 0, baselineAt, 'baseline', null, null);
    for (const event of history) {
      insert.run(
        player.id, event.gameId, event.previousRating, event.rating, event.delta,
        event.recordedAt, 'game', event.opponentId, event.result,
      );
    }
  }
}

function assertUniqueGameParticipation(db: DatabaseSync): void {
  const gameTable = db.prepare(`
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ChessGame')
        THEN 'ChessGame'
      WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'GameResource')
        THEN 'GameResource'
    END AS name
  `).get() as { name?: 'ChessGame' | 'GameResource' };
  if (!gameTable.name) return;
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${gameTable.name})`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const activeGamePredicate = [
    columns.has('result') ? 'result IS NULL' : null,
    columns.has('cancelledAt') ? 'cancelledAt IS NULL' : null,
  ].filter((predicate): predicate is string => predicate !== null)
    .map((predicate) => `AND ${predicate}`)
    .join(' ');
  const duplicate = db.prepare(`
    SELECT playerId, COUNT(*) AS appearances
    FROM (
      SELECT blackPlayerId AS playerId FROM ${gameTable.name}
      WHERE blackPlayerId IS NOT NULL ${activeGamePredicate}
      UNION ALL
      SELECT whitePlayerId AS playerId FROM ${gameTable.name}
      WHERE whitePlayerId IS NOT NULL ${activeGamePredicate}
    )
    GROUP BY playerId
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get() as { playerId: number; appearances: number } | undefined;
  if (duplicate) {
    throw new Error(
      `Migration v3 cannot continue: player ${duplicate.playerId} occupies `
      + `${duplicate.appearances} active seats. Back up the database, resolve duplicate `
      + 'active-player participation, and restart Sunset Chess.',
    );
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
  const v3Applied = db.prepare(
    'SELECT 1 FROM schema_migrations WHERE version = 3',
  ).get();
  const hasLegacyGames = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ChessGame'
  `).get();
  if (!v3Applied && hasLegacyGames) assertUniqueGameParticipation(db);
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
      if (migration.version === 3) assertUniqueGameParticipation(db);
      db.exec(migration.sql);
      if (migration.version === 5) backfillRatingLedger(db, new Date().toISOString());
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
