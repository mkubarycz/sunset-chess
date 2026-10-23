// @vitest-environment node
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApplicationContractSchema,
  CheckInCreateInputSchema,
  ClubSessionCreateInputSchema,
  ClubSessionUpdateInputSchema,
  GameCreateInputSchema,
  GameUpdateInputSchema,
  PlayerCreateInputSchema,
  PlayerUpdateInputSchema,
  ResourceEnvelopeSchema,
  sunsetChessContract,
  type ResourceKind,
} from './data-contract/index.js';
import { openDatabase } from './database.js';
import { ChessRepository } from './repository.js';
import { ResourceService } from './resources.js';

const testDirectory = resolve(process.cwd(), '.test-data');
const files: string[] = [];

function fixture() {
  mkdirSync(testDirectory, { recursive: true });
  const path = resolve(testDirectory, `resources-${crypto.randomUUID()}.sqlite`);
  files.push(path);
  const db = openDatabase(path);
  const repository = new ChessRepository(db, () => 0);
  return { db, repository, resources: new ResourceService(repository), path };
}

it.each([13, 14])('upgrades populated v%i attendance and recovers late manual players without changing frozen cohorts', (version) => {
  const { db, repository, path } = fixture();
  repository.upsertPlayer(1000, 'Alice');
  repository.upsertPlayer(1001, 'Bob');
  const session = repository.createClubSession('Migration attendance');
  const frozen = repository.listPairingCohorts(session.id);
  repository.upsertPlayer(1002, 'Late arrival');
  const game = repository.createGame(1001, 1002, session.id);
  const players = repository.listPlayers();
  const games = repository.listGames();
  const ratingEvents = repository.listRatingEvents();
  db.exec(`
    DELETE FROM CheckInResource;
    DELETE FROM PairingCohortResource WHERE playerId = 1002;
    ${version === 13 ? 'ALTER TABLE CheckInResource DROP COLUMN checkedOutAt;' : ''}
    DELETE FROM schema_migrations WHERE version > ${version};
  `);
  if (version === 14) {
    db.prepare(`
      INSERT INTO CheckInResource(eventId, playerId, checkedInAt, gameId, placement, side)
      VALUES (?, ?, ?, ?, 'paired', ?)
    `).run(session.id, 1001, game.createdAt, game.id, 'black');
    db.prepare(`
      INSERT INTO CheckInResource(eventId, playerId, checkedInAt, gameId, placement, side)
      VALUES (?, ?, ?, ?, 'paired', ?)
    `).run(session.id, 1002, game.createdAt, game.id, 'white');
  }
  db.close();
  const migrated = openDatabase(path);
  try {
    const next = new ChessRepository(migrated);
    expect(next.listPlayers()).toEqual(players);
    expect(next.listGames()).toEqual(games);
    expect(next.listRatingEvents()).toEqual(ratingEvents);
    expect(next.listCheckIns(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 1001, gameId: game.id, checkedOutAt: null }),
      expect.objectContaining({ playerId: 1002, gameId: game.id, checkedOutAt: null }),
    ]));
    expect(next.listPairingCohorts(session.id).filter(({ playerId }) => playerId !== 1002))
      .toEqual(frozen);
    expect(next.listPairingCohorts(session.id)).toContainEqual({
      eventId: session.id, playerId: 1002, cohort: 'A', snapshotRating: 700,
    });
    next.upsertPlayer(1003, 'Next arrival');
    next.checkInPlayer({ id: 1003, name: 'Next arrival' }, () => 0, undefined, session.id);
    next.finalizeGame(game.id, '1/2-1/2');
    expect(next.listJoinedGames()).toEqual([
      expect.objectContaining({
        blackPlayerId: expect.any(Number), whitePlayerId: expect.any(Number),
      }),
    ]);
    expect([next.listJoinedGames()[0].blackPlayerId, next.listJoinedGames()[0].whitePlayerId].sort())
      .toEqual([1002, 1003]);
    expect(migrated.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    migrated.close();
  }
});

it.each([true, false])('recovers completed manual-game participants as checked out (active session: %s)', (active) => {
  const { db, repository, path } = fixture();
  repository.upsertPlayer(1000, 'Alice');
  repository.upsertPlayer(1001, 'Bob');
  const session = repository.createClubSession('Historical manual game');
  const game = repository.createGame(1000, 1001, session.id);
  repository.finalizeGame(game.id, '1/2-1/2');
  if (!active) repository.closeClubSession(session.id, 'cancel');
  const players = repository.listPlayers();
  const games = repository.listGames();
  const ledger = repository.listRatingEvents();
  const cohorts = repository.listPairingCohorts(session.id);
  db.exec('DELETE FROM CheckInResource; DELETE FROM schema_migrations WHERE version = 15;');
  db.close();
  const migrated = openDatabase(path);
  try {
    const next = new ChessRepository(migrated);
    const resources = new ResourceService(next);
    expect(next.listPlayers()).toEqual(players);
    expect(next.listGames()).toEqual(games);
    expect(next.listRatingEvents()).toEqual(ledger);
    expect(next.listPairingCohorts(session.id)).toEqual(cohorts);
    expect(next.listLeaderboard(100, session.id)).toEqual([
      expect.objectContaining({ id: 1000, sessionGamesPlayed: 1, sessionDraws: 1, checkInStatus: 'checked-out' }),
      expect.objectContaining({ id: 1001, sessionGamesPlayed: 1, sessionDraws: 1, checkInStatus: 'checked-out' }),
    ]);
    for (const attendance of next.listCheckIns(session.id)) {
      expect(attendance).toMatchObject({
        checkedOutAt: expect.any(String), gameId: null, placement: null, side: null,
      });
      expect(resources.get('check-in', String(attendance.id))).toMatchObject({
        status: { attendance: 'checked-out', placement: 'checked-out' },
      });
    }
    expect(migrated.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    migrated.close();
  }
  const reopened = openDatabase(path);
  expect(new ChessRepository(reopened).listCheckIns(session.id)).toHaveLength(2);
  reopened.close();
});

afterEach(() => {
  for (const file of files.splice(0)) rmSync(file, { force: true });
});

describe('Sunset Chess application contract', () => {
  it('advertises and applies empty-session soft deletion without exposing retained cohorts', () => {
    const { db, resources } = fixture();
    resources.create('player', { id: 1000, name: 'Alice' });
    const session = resources.create('club-session', { name: 'Unused session' }).resource;
    expect(sunsetChessContract.resources['club-session'].capabilities.delete).toBe(true);
    const deleted = resources.delete('club-session', session.metadata.id);
    expect(ResourceEnvelopeSchema.parse(deleted)).toEqual(deleted);
    expect(deleted.status).toMatchObject({ lifecycle: 'deleted', deletedAt: expect.any(String) });
    expect(resources.query('club-session')).toEqual([]);
    expect(resources.query('pairing-cohort')).toEqual([]);
    expect(() => resources.get('club-session', session.metadata.id)).toThrow('was not found');
    expect(() => resources.get('pairing-cohort', `${session.metadata.id}:1000`)).toThrow('was not found');
    db.close();
  });

  it('is self-describing and declares every common-envelope resource concern', () => {
    expect(ApplicationContractSchema.parse(sunsetChessContract)).toEqual(sunsetChessContract);
    expect(sunsetChessContract.envelope.fields).toEqual([
      'kind', 'metadata', 'spec', 'status', 'relationships',
    ]);
    expect(Object.keys(sunsetChessContract.resources).sort()).toEqual([
      'check-in', 'club-session', 'game', 'pairing-cohort', 'player', 'rating-event',
    ]);
    for (const resource of Object.values(sunsetChessContract.resources)) {
      expect(resource.description).not.toBe('');
      expect(resource.schemas.spec).toMatchObject({ $schema: expect.any(String) });
      expect(resource.schemas.status).toMatchObject({ $schema: expect.any(String) });
      expect(resource.constraints.length).toBeGreaterThan(0);
      expect(resource.lifecycle.length).toBeGreaterThan(0);
      expect(resource.effects.length).toBeGreaterThan(0);
    }
    expect(sunsetChessContract.errors.map(({ code }) => code)).toContain('conflict');
    expect(sunsetChessContract.events.map(({ type }) => type)).toContain('check-in.placed');
  });

  it('advertises the exact generic game inputs and generated/mutable fields', () => {
    const game = sunsetChessContract.resources.game;
    expect(game.schemas.createInput).toEqual(z.toJSONSchema(GameCreateInputSchema));
    expect(game.schemas.updateInput).toEqual(z.toJSONSchema(GameUpdateInputSchema));
    expect(Object.keys((game.schemas.createInput as {
      properties: Record<string, unknown>;
    }).properties).sort()).toEqual(['blackPlayerId', 'eventId', 'whitePlayerId']);
    expect(Object.keys((game.schemas.updateInput as {
      properties: Record<string, unknown>;
    }).properties).sort()).toEqual([
      'blackPlayerId', 'cancel', 'cancellationReason', 'overrideStarted', 'result', 'start', 'swapSides', 'whitePlayerId',
    ]);
    expect(game.fields.generated).toContain('spec.tableNumber');
    expect(game.fields.generated).toEqual(expect.arrayContaining([
      'status.finishedAt',
      'status.cancelledAt',
    ]));
    expect(game.fields.mutable).toEqual(expect.arrayContaining([
      'relationships.blackPlayer',
      'relationships.whitePlayer',
      'status.result',
      'status.cancellationReason',
    ]));
    expect(game.fields.mutable).not.toContain('status.cancelledAt');
    expect(game.fields.immutable).toContain('relationships.session');
    expect(() => GameCreateInputSchema.parse({ blackPlayerId: 1000 })).toThrow();
    expect(() => GameUpdateInputSchema.parse({
      cancel: false,
      cancellationReason: 'No show',
    })).toThrow();
  });

  it('advertises the exact Club Session create input and intentional pairing default', () => {
    const session = sunsetChessContract.resources['club-session'];
    expect(session.schemas.createInput).toEqual(
      z.toJSONSchema(ClubSessionCreateInputSchema),
    );
    expect(Object.keys((session.schemas.createInput as {
      properties: Record<string, unknown>;
    }).properties).sort()).toEqual(['name', 'pairingMode']);
    expect(ClubSessionCreateInputSchema.parse({})).toEqual({});
    expect(ClubSessionCreateInputSchema.parse({
      name: 'Friday Club',
      pairingMode: 'club-session-pairing-1',
    })).toEqual({
      name: 'Friday Club',
      pairingMode: 'club-session-pairing-1',
    });
    expect(() => ClubSessionCreateInputSchema.parse({
      name: 'Friday Club',
      unsupported: true,
    })).toThrow();
  });

  it('keeps every supported runtime operation conformant with its advertised schema', () => {
    type OperationCase = {
      kind: ResourceKind;
      operation: 'create' | 'update';
      schema: z.ZodType;
      valid: Record<string, unknown>;
      invalid: Record<string, unknown>;
      setup?: (resources: ResourceService) => string;
    };
    const cases: OperationCase[] = [
      {
        kind: 'player',
        operation: 'create',
        schema: PlayerCreateInputSchema,
        valid: { id: 1000, name: 'Alice' },
        invalid: { id: 1000, name: 'Alice', unsupported: true },
      },
      {
        kind: 'player',
        operation: 'update',
        schema: PlayerUpdateInputSchema,
        valid: { name: 'Alicia' },
        invalid: { name: 'Alicia', unsupported: true },
        setup: (resources) =>
          resources.create('player', { id: 1000, name: 'Alice' }).resource.metadata.id,
      },
      {
        kind: 'club-session',
        operation: 'create',
        schema: ClubSessionCreateInputSchema,
        valid: { name: 'Friday Club', pairingMode: 'club-session-pairing-1' },
        invalid: { name: 'Friday Club', unsupported: true },
      },
      {
        kind: 'club-session',
        operation: 'update',
        schema: ClubSessionUpdateInputSchema,
        valid: { name: 'Renamed Club', pairingMode: 'club-session-pairing-1' },
        invalid: { name: 'Renamed Club', unsupported: true },
        setup: (resources) =>
          resources.create('club-session', { name: 'Friday Club' }).resource.metadata.id,
      },
      {
        kind: 'check-in',
        operation: 'create',
        schema: CheckInCreateInputSchema,
        valid: { playerId: 1000, name: 'Alice' },
        invalid: { playerId: 1000, name: 'Alice', unsupported: true },
      },
      {
        kind: 'game',
        operation: 'create',
        schema: GameCreateInputSchema,
        valid: {},
        invalid: { unsupported: true },
      },
      {
        kind: 'game',
        operation: 'update',
        schema: GameUpdateInputSchema,
        valid: { blackPlayerId: 1000 },
        invalid: { blackPlayerId: 1000, unsupported: true },
        setup: (resources) => {
          resources.create('player', { id: 1000, name: 'Alice' });
          return resources.create('game', {}).resource.metadata.id;
        },
      },
    ];

    for (const operationCase of cases) {
      const advertised = sunsetChessContract.resources[operationCase.kind]
        .schemas[`${operationCase.operation}Input`];
      expect(advertised, `${operationCase.kind}.${operationCase.operation}`).not.toBeNull();
      expect(advertised).toEqual(z.toJSONSchema(operationCase.schema));
      const advertisedSchema = z.fromJSONSchema(
        advertised as Parameters<typeof z.fromJSONSchema>[0],
      );
      expect(operationCase.schema.safeParse(operationCase.valid).success).toBe(true);
      expect(advertisedSchema.safeParse(operationCase.valid).success).toBe(true);
      expect(operationCase.schema.safeParse(operationCase.invalid).success).toBe(false);
      expect(advertisedSchema.safeParse(operationCase.invalid).success).toBe(false);

      const { db, resources } = fixture();
      const id = operationCase.setup?.(resources);
      expect(() => operationCase.operation === 'create'
        ? resources.create(operationCase.kind, operationCase.valid)
        : resources.update(operationCase.kind, id as string, operationCase.valid)).not.toThrow();
      expect(() => operationCase.operation === 'create'
        ? resources.create(operationCase.kind, operationCase.invalid)
        : resources.update(operationCase.kind, id as string, operationCase.invalid)).toThrow();
      db.close();
    }

    for (const resource of Object.values(sunsetChessContract.resources)) {
      expect(resource.schemas.createInput === null).toBe(!resource.capabilities.create);
      expect(resource.schemas.updateInput === null).toBe(!resource.capabilities.update);
    }
  });

  it('physically migrates to first-class resource tables at the latest schema', () => {
    const { db } = fixture();
    expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get())
      .toEqual({ version: 15 });
    const tables = (db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE '%Resource'
      ORDER BY name
    `).all() as Array<{ name: string }>).map(({ name }) => name);
    expect(tables).toEqual([
      'CheckInResource',
      'ClubSessionResource',
      'GameResource',
      'PairingCohortResource',
      'PlayerResource',
      'RatingEventResource',
    ]);
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'Player', 'ChessGame', 'PlayerRatingEvent',
        'ClubEvent', 'ClubEventPlayer', 'ClubEventPairingCohort'
      )
    `).all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('upgrades a populated v9-shaped database without changing domain data', () => {
    const { db, repository, path } = fixture();
    repository.upsertPlayer(1000, 'Alice');
    repository.upsertPlayer(1001, 'Bob');
    const session = repository.createClubSession('Migration Night', () => '2026-10-02T18:00:00.000Z');
    const placement = repository.checkInPlayer(
      { id: 1000, name: 'Alice' },
      () => 0,
      () => '2026-10-02T18:05:00.000Z',
    );
    db.exec(`
      ALTER TABLE PlayerResource RENAME TO Player;
      ALTER TABLE GameResource RENAME TO ChessGame;
      ALTER TABLE RatingEventResource RENAME TO PlayerRatingEvent;
      ALTER TABLE ClubSessionResource RENAME TO ClubEvent;
      ALTER TABLE PairingCohortResource RENAME TO ClubEventPairingCohort;
      DROP INDEX ClubSessionResource_one_active;
      CREATE UNIQUE INDEX ClubEvent_one_active_session ON ClubEvent(active) WHERE active = 1;
      DROP INDEX GameResource_session_status;
      CREATE INDEX ChessGame_event_status
      ON ChessGame(eventId, result, cancelledAt, tableNumber);
      DROP INDEX PairingCohortResource_lookup;
      CREATE INDEX ClubEventPairingCohort_lookup
      ON ClubEventPairingCohort(eventId, cohort, snapshotRating DESC, playerId);
      CREATE TABLE ClubEventPlayer (
        eventId INTEGER NOT NULL REFERENCES ClubEvent(id) ON DELETE RESTRICT,
        playerId INTEGER NOT NULL REFERENCES Player(id) ON DELETE RESTRICT,
        checkedInAt TEXT NOT NULL,
        PRIMARY KEY (eventId, playerId)
      ) STRICT, WITHOUT ROWID;
      INSERT INTO ClubEventPlayer(eventId, playerId, checkedInAt)
      SELECT eventId, playerId, checkedInAt FROM CheckInResource WHERE eventId IS NOT NULL;
      DROP TABLE CheckInResource;
      DELETE FROM schema_migrations WHERE version IN (10, 14, 15);
    `);
    db.close();

    const migrated = openDatabase(path);
    const migratedRepository = new ChessRepository(migrated);
    expect(migratedRepository.getPlayer(1000)).toEqual({
      id: 1000, name: 'Alice', rating: 700, scanningIdentifier: null,
    });
    expect(migratedRepository.getClubSession(session.id)).toMatchObject({
      id: session.id,
      name: 'Migration Night',
      playerCount: 1,
    });
    expect(migratedRepository.getGame(placement.game.id)).toMatchObject({
      id: placement.game.id,
      eventId: session.id,
      blackPlayerId: 1000,
    });
    expect(migratedRepository.listCheckIns(session.id, 1000)).toEqual([
      expect.objectContaining({
        eventId: session.id,
        playerId: 1000,
        checkedInAt: '2026-10-02T18:05:00.000Z',
      }),
    ]);
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    migrated.close();
  });

  it('conforms generic CRUD/query and atomically records check-in placement effects', () => {
    const { db, resources } = fixture();
    const alice = resources.create('player', { id: 1000, name: 'Alice' }).resource;
    expect(ResourceEnvelopeSchema.parse(alice)).toMatchObject({
      kind: 'player',
      metadata: { id: '1000' },
      spec: { name: 'Alice' },
      status: { rating: 700 },
    });
    const session = resources.create('club-session', { name: 'Friday Club' }).resource;
    const checkedIn = resources.create('check-in', { playerId: 1001, name: 'Bob' });
    expect(ResourceEnvelopeSchema.parse(checkedIn.resource)).toMatchObject({
      kind: 'check-in',
      spec: { playerId: 1001, name: 'Bob' },
      status: { placement: 'waiting', side: expect.stringMatching(/^(black|white)$/) },
      relationships: {
        player: '1001',
        session: session.metadata.id,
        game: expect.any(String),
        cohort: `${session.metadata.id}:1001`,
      },
    });
    expect(checkedIn.effects?.map(({ kind }) => kind).sort()).toEqual(['game', 'player']);
    expect(resources.query('check-in', { eventId: Number(session.metadata.id) })).toHaveLength(1);
    expect(resources.query('pairing-cohort', { playerId: 1001 })).toHaveLength(1);
    expect(db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM CheckInResource WHERE playerId = 1001) AS checkIns,
        (SELECT COUNT(*) FROM PairingCohortResource WHERE playerId = 1001) AS cohorts,
        (SELECT COUNT(*) FROM GameResource
          WHERE blackPlayerId = 1001 OR whitePlayerId = 1001) AS games
    `).get()).toEqual({ checkIns: 1, cohorts: 1, games: 1 });
    db.close();
  });

  it('rolls back an earlier generic seat update when a later seat is invalid', () => {
    const { db, resources } = fixture();
    resources.create('player', { id: 1000, name: 'Alice' });
    const game = resources.create('game', {}).resource;
    expect(() => resources.update('game', game.metadata.id, {
      blackPlayerId: 1000,
      whitePlayerId: 1000,
    })).toThrow('A player cannot occupy both seats.');
    expect(resources.get('game', game.metadata.id)).toMatchObject({
      relationships: { blackPlayer: null, whitePlayer: null },
      status: { lifecycle: 'waiting', result: null },
    });
    expect(db.prepare(`
      SELECT blackPlayerId, whitePlayerId FROM GameResource WHERE id = ?
    `).get(Number(game.metadata.id))).toEqual({
      blackPlayerId: null,
      whitePlayerId: null,
    });
    db.close();
  });

  it('commits seats, result, and rating effects in one generic update', () => {
    const { db, resources } = fixture();
    resources.create('player', { id: 1000, name: 'Alice' });
    resources.create('player', { id: 1001, name: 'Bob' });
    const game = resources.create('game', {}).resource;
    const updated = resources.update('game', game.metadata.id, {
      blackPlayerId: 1000,
      whitePlayerId: 1001,
      result: '1-0',
    });
    expect(updated).toMatchObject({
      relationships: { blackPlayer: '1000', whitePlayer: '1001' },
      status: { lifecycle: 'finished', result: '1-0' },
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM RatingEventResource
      WHERE gameId = ? AND reason = 'game'
    `).get(Number(game.metadata.id))).toEqual({ count: 2 });
    db.close();
  });
});
