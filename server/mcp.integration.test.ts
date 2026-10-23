// @vitest-environment node
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { posix, win32 } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { NotFoundError } from './errors.js';
import {
  allowedHostAuthority,
  allowedOriginValue,
  createSunsetServer,
  isContainedPath,
} from './httpServer.js';
import { ChessRepository } from './repository.js';

const testDirectory = resolve(process.cwd(), '.test-data');
const files: string[] = [];

function postChunks(
  port: number,
  chunks: Buffer[],
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/check-ins',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      const responseChunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => responseChunks.push(chunk));
      res.on('end', () => {
        try {
          resolveResponse({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(responseChunks).toString('utf8')),
          });
        } catch (error) {
          rejectResponse(error);
        }
      });
    });
    req.on('error', rejectResponse);
    chunks.forEach((chunk) => req.write(chunk));
    req.end();
  });
}

afterEach(() => {
  for (const file of files.splice(0)) rmSync(file, { force: true });
});

async function fixture() {
  mkdirSync(testDirectory, { recursive: true });
  const path = resolve(testDirectory, `mcp-${crypto.randomUUID()}.sqlite`);
  files.push(path);
  const db = openDatabase(path);
  const repository = new ChessRepository(db);
  const server = createSunsetServer(repository, db);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  const client = new Client({ name: 'sunset-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return {
    client,
    db,
    repository,
    port,
    close: async () => {
      await client.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      db.close();
    },
  };
}

describe('Sunset Chess HTTP and MCP', () => {
  it('scopes attendance and enforces checkout through HTTP, MCP, and generic resources', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      app.repository.upsertPlayer(1000, 'Alice');
      app.repository.upsertPlayer(1001, 'Bob');
      for (let id = 1002; id < 1016; id++) app.repository.upsertPlayer(id, `Player ${id}`);
      const session = app.repository.createClubSession('Attendance');
      const endpoint = `${base}/api/sessions/${session.id}/check-ins`;
      const post = (playerId: number, name: string) => fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, name }),
      });
      const first = await post(1000, 'Alice');
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { game: { id: number }; checkIn: { id: number; eventId: number } };
      expect(firstBody.checkIn.eventId).toBe(session.id);
      const second = await post(1001, 'Bob');
      expect(second.status).toBe(200);
      const released = await fetch(`${endpoint}/1000`, { method: 'DELETE' });
      expect(released.status).toBe(200);
      expect(app.repository.listLeaderboard(100, session.id).map(({ id }) => id)).toEqual([1001]);
      expect((await post(1000, 'Alice')).status).toBe(200);
      app.repository.updateGameResource(firstBody.game.id, { start: true });
      const blocked = await fetch(`${endpoint}/1000`, { method: 'DELETE' });
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({ error: expect.stringMatching(/Finish or cancel Table/) });
      app.repository.finalizeGame(firstBody.game.id, '1/2-1/2');
      const available = await fetch(`${base}/api/resources/check-in/${firstBody.checkIn.id}`);
      expect(await available.json()).toMatchObject({ resource: { status: {
        attendance: 'checked-in', placement: 'available',
      } } });
      const checkedOut = await fetch(`${endpoint}/1000`, { method: 'DELETE' });
      expect(checkedOut.status).toBe(200);
      expect(await checkedOut.json()).toMatchObject({ checkIn: {
        playerId: 1000, eventId: session.id, checkedOutAt: expect.any(String),
      } });
      const empty = app.repository.createEmptyGame(undefined, session.id);
      const rejectedSeat = await fetch(`${base}/api/games/${empty.id}/seats/black`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 1000 }),
      });
      expect(rejectedSeat.status).toBe(409);
      const mcp = await app.client.callTool({
        name: 'player-check-out', arguments: { playerId: 1001, eventId: session.id },
      });
      expect(mcp.isError).not.toBe(true);
      expect(mcp.structuredContent).toMatchObject({ checkIn: {
        playerId: 1001, checkedOutAt: expect.any(String),
      } });
      const generic = await fetch(`${base}/api/resources/check-in/${firstBody.checkIn.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkOut: true }),
      });
      expect(generic.status).toBe(200);
      expect(await generic.json()).toMatchObject({ resource: { status: {
        attendance: 'checked-out', placement: 'checked-out',
      } } });
      const reactivated = await app.client.callTool({
        name: 'resource-create',
        arguments: { kind: 'check-in', spec: { playerId: 1000, name: 'Alice', eventId: session.id } },
      });
      expect(reactivated.isError).not.toBe(true);
      expect(app.repository.listCheckIns(session.id, 1000)).toEqual([
        expect.objectContaining({ id: firstBody.checkIn.id, checkedOutAt: null }),
      ]);
      app.repository.closeClubSession(session.id, 'cancel');
      app.repository.createClubSession('Next session');
      expect((await post(1000, 'Alice')).status).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('serves full individual game details and opponent-aware rating history over HTTP', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      app.repository.upsertPlayer(1000, 'Alice');
      app.repository.upsertPlayer(1001, 'Bob');
      const game = app.repository.createGame(1000, 1001);
      const endpoint = `${base}/api/games/${game.id}`;
      const ongoing = await fetch(endpoint);
      expect(ongoing.status).toBe(200);
      expect(await ongoing.json()).toEqual({ game: app.repository.getGameDetails(game.id) });
      app.repository.finalizeGame(game.id, '1-0', () => '2027-01-02T12:00:00.000Z');
      const completed = await fetch(endpoint);
      expect(completed.status).toBe(200);
      expect(await completed.json()).toMatchObject({ game: {
        createdAt: game.createdAt, finishedAt: '2027-01-02T12:00:00.000Z',
        blackRatingDelta: -16, whiteRatingDelta: 16, canCancel: true,
        blackPlayer: { name: 'Alice' }, whitePlayer: { name: 'Bob' },
      } });
      const profile = await fetch(`${base}/api/players/1000/profile?recentLimit=1`);
      expect(await profile.json()).toMatchObject({ profile: { ratingHistory: [
        { reason: 'baseline', opponentName: null, outcome: null, opponentRatingBefore: null, opponentDelta: null },
        { reason: 'game', gameId: game.id, opponentName: 'Bob', outcome: 'loss', opponentRatingBefore: 700, opponentDelta: 16 },
      ] } });
      app.repository.cancelGame(game.id, 'Incorrect result');
      const cancelled = await fetch(endpoint);
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toMatchObject({ game: {
        cancelledAt: expect.any(String), cancellationReason: 'Incorrect result', canCancel: false,
      } });
      const missing = await fetch(`${base}/api/games/999999`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ code: 'not_found', error: expect.any(String) });
    } finally {
      await app.close();
    }
  });

  it('soft-deletes empty sessions over HTTP and rejects stale or populated deletion requests', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      const session = app.repository.createClubSession('Empty active session');
      const endpoint = `${base}/api/sessions/${session.id}`;
      const removed = await fetch(endpoint, { method: 'DELETE' });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({
        session: { id: session.id, active: false, deletedAt: expect.any(String) },
      });
      expect(await (await fetch(`${base}/api/sessions`)).json()).toEqual({ sessions: [] });
      expect((await fetch(`${endpoint}/games`)).status).toBe(404);
      expect((await fetch(endpoint, { method: 'DELETE' })).status).toBe(404);
      expect(app.db.prepare('SELECT COUNT(*) AS count FROM ClubSessionResource WHERE id = ?').get(session.id))
        .toEqual({ count: 1 });
      const populated = app.repository.createClubSession('Now has a game');
      app.repository.createEmptyGame(undefined, populated.id);
      const rejected = await fetch(`${base}/api/sessions/${populated.id}`, { method: 'DELETE' });
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('zero check-ins and zero games') });
      expect(app.repository.getClubSession(populated.id).active).toBe(true);
      expect((await fetch(`${base}/api/sessions/999999`, { method: 'DELETE' })).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('supports soft deletion through the generic MCP resource contract', async () => {
    const app = await fixture();
    try {
      const session = app.repository.createClubSession('Unused MCP session');
      const deleted = await app.client.callTool({
        name: 'resource-delete', arguments: { kind: 'club-session', id: String(session.id) },
      });
      expect(deleted.isError).not.toBe(true);
      expect(deleted.structuredContent).toMatchObject({
        resource: { status: { lifecycle: 'deleted', deletedAt: expect.any(String) } },
      });
      expect(app.repository.listClubSessions()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns complete session history beyond the recent-game limit without mixing sessions', async () => {
    const app = await fixture();
    try {
      app.repository.upsertPlayer(1000, 'Alice');
      app.repository.upsertPlayer(1001, 'Bob');
      const session = app.repository.createClubSession('Past session');
      const ids: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        const game = app.repository.createGame(1000, 1001, session.id);
        app.repository.finalizeGame(game.id, '1/2-1/2');
        ids.push(game.id);
      }
      app.repository.closeClubSession(session.id, 'cancel');
      const active = app.repository.createClubSession('Current session');
      app.repository.createGame(1000, 1001, active.id);
      const base = `http://127.0.0.1:${app.port}`;
      const endpoint = `${base}/api/sessions/${session.id}/games`;
      const response = await fetch(endpoint);
      expect(response.status).toBe(200);
      const body = await response.json() as { games: Array<{ id: number; eventId: number }> };
      expect(body.games).toHaveLength(25);
      expect(body.games.map((game) => game.id).sort((a, b) => a - b)).toEqual(ids);
      expect(body.games.every((game) => game.eventId === session.id)).toBe(true);
      expect((await fetch(endpoint, { method: 'POST' })).status).toBe(405);
      expect((await fetch(`${base}/api/sessions/999999/games`)).status).toBe(404);
      expect(app.repository.getClubSession(active.id).active).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('requires and supports Started consent in the existing waiting-player move workflow', async () => {
    const app = await fixture();
    try {
      for (let id = 1000; id < 1004; id += 1) app.repository.upsertPlayer(id, `Player ${id}`);
      const source = app.repository.createGame(1000, 1001, null);
      const target = app.repository.createGame(1002, 1003, null);
      for (const game of [source, target]) {
        app.repository.updateGameResource(game.id, { start: true });
        app.repository.updateGameSeat(game.id, 'white', null, true);
      }
      const url = `http://127.0.0.1:${app.port}/api/players/1000/move`;
      const denied = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destinationGameId: target.id }),
      });
      expect(denied.status).toBe(409);
      expect(await denied.json()).toMatchObject({ requiresStartedOverride: true });
      expect((await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destinationGameId: target.id, overrideStarted: true }),
      })).status).toBe(200);
      expect(() => app.repository.getGame(source.id)).toThrow(NotFoundError);
      expect(app.repository.getGame(target.id)).toMatchObject({
        blackPlayerId: 1002, whitePlayerId: 1000, startedAt: expect.any(String),
      });
      expect(app.repository.listCheckIns(undefined, 1000)).toEqual([
        expect.objectContaining({ gameId: target.id, placement: 'paired', side: 'white' }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('sets Playing back to Paired through HTTP, MCP and generic resources without resetting results', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      app.repository.upsertPlayer(1000, 'Alice');
      app.repository.upsertPlayer(1001, 'Bob');
      const game = app.repository.createGame(1000, 1001, null);
      const url = `${base}/api/games/${game.id}/start`;
      const post = (body: unknown) => fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect((await fetch(url, { method: 'POST' })).status).toBe(200);
      const started = app.repository.getGame(game.id);
      for (const body of [{ start: 'false' }, {}, { start: false, result: '1-0' }]) {
        expect((await post(body)).status).toBe(400);
      }
      expect(app.repository.getGame(game.id)).toEqual(started);
      const paired = await post({ start: false });
      expect(paired.status).toBe(200);
      expect(await paired.json()).toMatchObject({ game: {
        startedAt: null, blackPlayerId: 1000, whitePlayerId: 1001, result: null,
      } });
      expect((await app.client.callTool({ name: 'game-start', arguments: { id: game.id } })).isError).not.toBe(true);
      expect((await app.client.callTool({
        name: 'game-start', arguments: { id: game.id, start: false },
      })).isError).not.toBe(true);
      expect(app.repository.getGame(game.id).startedAt).toBeNull();
      expect((await post({ start: true })).status).toBe(200);
      expect((await fetch(`${base}/api/resources/game/${game.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: false }),
      })).status).toBe(200);
      expect(app.repository.getGame(game.id).startedAt).toBeNull();
      app.repository.finalizeGame(game.id, '1-0');
      const completed = app.repository.getGame(game.id);
      expect((await post({ start: false })).status).toBe(409);
      expect((await app.client.callTool({
        name: 'game-start', arguments: { id: game.id, start: false },
      })).isError).toBe(true);
      expect(app.repository.getGame(game.id)).toEqual(completed);
    } finally {
      await app.close();
    }
  });

  it('immediately cancels unfinished tables but never silently cancels a newly recorded result', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      app.repository.upsertPlayer(1000, 'Alice');
      app.repository.upsertPlayer(1001, 'Bob');
      const cancel = (id: number, body: unknown) => fetch(`${base}/api/games/${id}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      for (const started of [false, true]) {
        const game = app.repository.createGame(1000, 1001, null);
        if (started) app.repository.updateGameResource(game.id, { start: true });
        expect((await cancel(game.id, { unfinishedOnly: 'true', overrideStarted: true })).status).toBe(400);
        expect((await cancel(game.id, { unfinishedOnly: true, overrideStarted: true })).status).toBe(200);
        expect(() => app.repository.getGame(game.id)).toThrow(NotFoundError);
        expect(app.repository.getPlayer(1000).rating).toBe(700);
        expect(app.repository.getPlayerProfile(1000).ratingHistory).toHaveLength(1);
      }
      const empty = app.repository.createEmptyGame(undefined, null);
      expect((await cancel(empty.id, { unfinishedOnly: true, overrideStarted: true })).status).toBe(200);
      const game = app.repository.createGame(1000, 1001, null);
      app.repository.finalizeGame(game.id, '1-0');
      const finished = app.repository.getGame(game.id);
      const history = app.repository.getPlayerProfile(1000).ratingHistory;
      const response = await cancel(game.id, { unfinishedOnly: true, overrideStarted: true });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('result has been recorded') });
      expect(app.repository.getGame(game.id)).toEqual(finished);
      expect(app.repository.getPlayerProfile(1000).ratingHistory).toEqual(history);
      expect((await cancel(game.id, {})).status).toBe(200);
      expect(app.repository.getGame(game.id).cancelledAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('switches colors atomically over HTTP and generic resources with Started consent', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      app.repository.upsertPlayer(1000, 'Black player');
      app.repository.upsertPlayer(1001, 'White player');
      const game = app.repository.createGame(1000, 1001, null);
      const url = `${base}/api/games/${game.id}/switch-sides`;
      const post = (body: unknown) => fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect((await fetch(url)).status).toBe(405);
      expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(400);
      expect((await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
      })).status).toBe(400);
      for (const body of [{ overrideStarted: 'true' }, { playerId: 1000 }, null, []]) {
        expect((await post(body)).status).toBe(400);
      }
      expect(app.repository.getGame(game.id)).toEqual(game);
      const response = await post({});
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ game: {
        id: game.id, blackPlayer: { id: 1001 }, whitePlayer: { id: 1000 },
      } });
      const started = app.repository.updateGameResource(game.id, { start: true });
      const denied = await post({});
      expect(denied.status).toBe(409);
      expect(await denied.json()).toMatchObject({ requiresStartedOverride: true });
      expect(app.repository.getGame(game.id)).toEqual(started);
      const allowed = await post({ overrideStarted: true });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ game: {
        blackPlayerId: 1000, whitePlayerId: 1001, startedAt: started.startedAt,
      } });
      const resourceUrl = `${base}/api/resources/game/${game.id}`;
      const patch = (body: unknown) => fetch(resourceUrl, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect((await patch({ swapSides: true })).status).toBe(409);
      expect((await patch({ swapSides: true, overrideStarted: true, blackPlayerId: 1000 })).status).toBe(400);
      expect((await patch({ swapSides: true, overrideStarted: true })).status).toBe(200);
      expect(app.repository.getGame(game.id)).toMatchObject({ blackPlayerId: 1001, whitePlayerId: 1000 });
      expect((await app.client.callTool({
        name: 'resource-update', arguments: { kind: 'game', id: String(game.id), spec: { swapSides: true } },
      })).isError).toBe(true);
      expect((await app.client.callTool({
        name: 'resource-update',
        arguments: { kind: 'game', id: String(game.id), spec: { swapSides: true, overrideStarted: true } },
      })).isError).not.toBe(true);
      expect(app.repository.getGame(game.id)).toMatchObject({ blackPlayerId: 1000, whitePlayerId: 1001 });
    } finally {
      await app.close();
    }
  });

  it('checks in full-roster seat selections and enforces Started consent over HTTP, MCP, and generic resources', async () => {
    const app = await fixture();
    try {
      const base = `http://127.0.0.1:${app.port}`;
      for (let id = 1000; id < 1005; id += 1) app.repository.upsertPlayer(id, `Player ${id}`);
      const session = app.repository.createClubSession('Manual pairing');
      const source = app.repository.createGame(1000, 1001, session.id);
      const target = app.repository.createEmptyGame(undefined, session.id);
      const seat = (id: number, side: string, playerId: number | null, overrideStarted?: unknown) =>
        fetch(`${base}/api/games/${id}/seats/${side}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId, ...(overrideStarted === undefined ? {} : { overrideStarted }) }),
        });
      const options = await (await fetch(`${base}/api/players?gameId=${target.id}`)).json();
      expect(options.players).toHaveLength(5);
      expect(options.players).toContainEqual(expect.objectContaining({ id: 1004, checkedIn: false }));
      expect((await fetch(`${base}/api/games/${target.id}/start`, { method: 'POST' })).status).toBe(409);
      expect((await seat(target.id, 'black', 1002)).status).toBe(200);
      expect(app.repository.listCheckIns(session.id, 1002)).toEqual([
        expect.objectContaining({ gameId: target.id, placement: 'waiting', side: 'black' }),
      ]);
      const started = await fetch(`${base}/api/games/${source.id}/start`, { method: 'POST' });
      expect(started.status).toBe(200);
      expect(await started.json()).toMatchObject({ game: { startedAt: expect.any(String), blackPlayer: { id: 1000 } } });
      const denied = await seat(target.id, 'white', 1000);
      expect(denied.status).toBe(409);
      expect(await denied.json()).toMatchObject({ requiresStartedOverride: true, error: expect.stringContaining('already started') });
      expect((await seat(target.id, 'white', 1000, 'true')).status).toBe(400);
      expect((await seat(target.id, 'white', 1000, true)).status).toBe(200);
      expect(app.repository.getGame(source.id)).toMatchObject({ blackPlayerId: null, whitePlayerId: 1001 });
      expect(app.repository.listCheckIns(session.id, 1000)).toEqual([
        expect.objectContaining({ gameId: target.id, side: 'white', placement: 'paired' }),
      ]);
      expect((await app.client.callTool({ name: 'game-start', arguments: { id: target.id } })).isError).not.toBe(true);
      const generic = await (await fetch(`${base}/api/resources/game/${target.id}`)).json();
      expect(generic.resource.status).toMatchObject({ lifecycle: 'started', startedAt: expect.any(String) });
      expect((await app.client.callTool({
        name: 'game-seat-update', arguments: { id: target.id, side: 'white', playerId: 1004 },
      })).isError).toBe(true);
      expect((await app.client.callTool({
        name: 'game-seat-update', arguments: { id: target.id, side: 'white', playerId: 1004, overrideStarted: true },
      })).isError).not.toBe(true);
      expect((await fetch(`${base}/api/resources/game/${target.id}`, { method: 'DELETE' })).status).toBe(409);
      expect((await fetch(`${base}/api/games/${target.id}`, { method: 'DELETE' })).status).toBe(409);
      expect((await fetch(`${base}/api/resources/game/${target.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancel: true, overrideStarted: true }),
      })).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('discovers one contract and exposes conforming generic resources over HTTP and MCP', async () => {
    const app = await fixture();
    const base = `http://127.0.0.1:${app.port}`;
    const contract = await (await fetch(`${base}/api/contract`)).json() as {
      application: { version: string };
      resources: Record<string, {
        schemas: {
          createInput: { properties: Record<string, unknown> } | null;
          updateInput: { properties: Record<string, unknown> } | null;
        };
      }>;
    };
    expect(contract.application.version).toBe('1.4.0');
    expect(contract.resources).toHaveProperty('check-in');
    expect(Object.keys(contract.resources.game.schemas.createInput?.properties ?? {}).sort())
      .toEqual(['blackPlayerId', 'eventId', 'whitePlayerId']);
    expect(Object.keys(contract.resources.game.schemas.updateInput?.properties ?? {}).sort())
      .toEqual(['blackPlayerId', 'cancel', 'cancellationReason', 'overrideStarted', 'result', 'start', 'swapSides', 'whitePlayerId']);
    expect(Object.keys(
      contract.resources['club-session'].schemas.createInput?.properties ?? {},
    ).sort()).toEqual(['name', 'pairingMode']);

    const sessionResponse = await fetch(`${base}/api/resources/club-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Contract Client Session',
        pairingMode: 'club-session-pairing-1',
      }),
    });
    expect(sessionResponse.status).toBe(201);
    expect(await sessionResponse.json()).toMatchObject({
      resource: {
        kind: 'club-session',
        spec: {
          name: 'Contract Client Session',
          pairingMode: 'club-session-pairing-1',
        },
      },
    });
    const unsupportedSession = await fetch(`${base}/api/resources/club-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Unsupported Session',
        pairingMode: 'club-session-pairing-1',
        unsupported: true,
      }),
    });
    const unsupportedSessionBody = await unsupportedSession.json();
    expect({
      status: unsupportedSession.status,
      body: unsupportedSessionBody,
    }).toMatchObject({
      status: 400,
      body: { code: 'validation' },
    });

    const createdResponse = await fetch(`${base}/api/resources/player`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1000, name: 'HTTP Resource Player' }),
    });
    expect(createdResponse.status).toBe(201);
    expect(await createdResponse.json()).toMatchObject({
      resource: {
        kind: 'player',
        metadata: { id: '1000' },
        spec: { name: 'HTTP Resource Player' },
        status: { rating: 700 },
        relationships: {},
      },
    });
    expect(await (await fetch(`${base}/api/resources/player/1000`)).json())
      .toMatchObject({ resource: { metadata: { id: '1000' } } });

    const discovered = await app.client.callTool({ name: 'contract-discover', arguments: {} });
    expect(discovered.structuredContent).toMatchObject({
      application: { version: '1.4.0' },
      resources: { player: expect.any(Object) },
    });
    const queried = await app.client.callTool({
      name: 'resource-query',
      arguments: { kind: 'player' },
    });
    expect(queried.structuredContent).toMatchObject({
      resources: [{ kind: 'player', metadata: { id: '1000' } }],
    });
    await app.close();
  });

  it('rolls back a generic multi-field game update when the second seat duplicates the first', async () => {
    const app = await fixture();
    const base = `http://127.0.0.1:${app.port}`;
    await fetch(`${base}/api/resources/player`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1000, name: 'Alice' }),
    });
    const created = await (await fetch(`${base}/api/resources/game`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).json() as { resource: { metadata: { id: string } } };
    const update = await fetch(`${base}/api/resources/game/${created.resource.metadata.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blackPlayerId: 1000, whitePlayerId: 1000 }),
    });
    expect(update.status).toBe(400);
    expect(await update.json()).toMatchObject({
      code: 'validation',
      error: 'A player cannot occupy both seats.',
    });
    expect(await (await fetch(
      `${base}/api/resources/game/${created.resource.metadata.id}`,
    )).json()).toMatchObject({
      resource: {
        relationships: { blackPlayer: null, whitePlayer: null },
        status: { lifecycle: 'waiting', result: null },
      },
    });
    await app.close();
  });

  it('accepts exact IPv4/IPv6 loopback authorities and rejects malformed or remote values', () => {
    for (const authority of ['localhost', 'localhost:4175', '127.0.0.1:4175', '[::1]', '[::1]:4175']) {
      expect(allowedHostAuthority(authority)).toBe(true);
    }
    for (const authority of ['', '::1', '[::1', 'example.com', '[2001:db8::1]:4175', 'localhost/path']) {
      expect(allowedHostAuthority(authority)).toBe(false);
    }
    for (const origin of ['http://localhost:4175', 'http://127.0.0.1:4175', 'http://[::1]:4175']) {
      expect(allowedOriginValue(origin)).toBe(true);
    }
    for (const origin of [
      'https://[::1]:4175',
      'http://[2001:db8::1]:4175',
      'http://[::1]:4175/path',
      'not-an-origin',
    ]) {
      expect(allowedOriginValue(origin)).toBe(false);
    }
  });

  it('checks static containment with POSIX and Windows path semantics', () => {
    expect(isContainedPath('/srv/public', '/srv/public/assets/app.js', posix)).toBe(true);
    expect(isContainedPath('/srv/public', '/srv/publicity/app.js', posix)).toBe(false);
    expect(isContainedPath('/srv/public', '/srv/secret.txt', posix)).toBe(false);
    expect(isContainedPath('/srv/public', '/absolute.txt', posix)).toBe(false);
    expect(isContainedPath('/srv/public', '/srv/public', posix)).toBe(false);

    expect(isContainedPath(
      'C:\\srv\\public',
      'C:\\srv\\public\\assets\\app.js',
      win32,
    )).toBe(true);
    expect(isContainedPath(
      'C:\\srv\\public',
      'C:\\srv\\publicity\\app.js',
      win32,
    )).toBe(false);
    expect(isContainedPath(
      'C:\\srv\\public',
      'C:\\srv\\secret.txt',
      win32,
    )).toBe(false);
    expect(isContainedPath(
      'C:\\srv\\public',
      'D:\\srv\\public\\app.js',
      win32,
    )).toBe(false);
  });

  it('serves health, joined games API, static navigation, and JSON API errors', async () => {
    const app = await fixture();
    expect((await fetch(`http://127.0.0.1:${app.port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${app.port}/`, {
      headers: { accept: 'text/html' },
    })).headers.get('content-type')).toContain('text/html');
    const missing = await fetch(`http://127.0.0.1:${app.port}/api/missing`, {
      headers: { accept: 'text/html' },
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    expect(await (await fetch(`http://127.0.0.1:${app.port}/api/games`)).json())
      .toEqual({ games: [], recentGames: [] });
    const created = await fetch(`http://127.0.0.1:${app.port}/api/games`, { method: 'POST' });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      game: {
        tableNumber: 1,
        blackPlayerId: null,
        whitePlayerId: null,
        blackPlayer: null,
        whitePlayer: null,
      },
    });
    expect((await fetch(`http://127.0.0.1:${app.port}/api/games`, { method: 'PUT' })).status).toBe(405);
    const listJoinedGames = app.repository.listJoinedGames;
    app.repository.listJoinedGames = () => { throw new Error('test database failure'); };
    const failed = await fetch(`http://127.0.0.1:${app.port}/api/games`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'test database failure' });
    app.repository.listJoinedGames = listJoinedGames;
    await app.close();
  });

  it('creates, renames, and scopes club sessions over HTTP', async () => {
    const app = await fixture();
    const base = `http://127.0.0.1:${app.port}`;
    expect(await (await fetch(`${base}/api/sessions`)).json()).toEqual({ sessions: [] });

    const createdResponse = await fetch(`${base}/api/sessions`, { method: 'POST' });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      session: { id: number; name: string; active: boolean }
    };
    expect(created.session).toMatchObject({ name: expect.stringContaining('Club Session'), active: true });
    expect(created.session).toMatchObject({ pairingMode: 'club-session-pairing-1' });

    const renamed = await fetch(`${base}/api/sessions/${created.session.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Thursday Club Night' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ session: { name: 'Thursday Club Night' } });
    const pairingMode = await fetch(`${base}/api/sessions/${created.session.id}/pairing-mode`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingMode: 'club-session-pairing-1' }),
    });
    expect(pairingMode.status).toBe(200);
    expect(await pairingMode.json()).toMatchObject({
      session: { pairingMode: 'club-session-pairing-1' },
    });

    const checkedIn = await (await fetch(`${base}/api/check-ins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1000, name: 'Alice' }),
    })).json() as {
      game: { id: number; blackPlayerId: number | null; whitePlayerId: number | null };
    };
    expect(await (await fetch(
      `${base}/api/leaderboard?eventId=${created.session.id}`,
    )).json()).toMatchObject({ leaderboard: [{ id: 1000, name: 'Alice' }] });
    expect(await (await fetch(`${base}/api/games?eventId=${created.session.id}`)).json())
      .toMatchObject({ games: [{ eventId: created.session.id }] });
    const emptyTable = await (await fetch(`${base}/api/games?eventId=${created.session.id}`, {
      method: 'POST',
    })).json() as { game: { id: number } };
    app.repository.upsertPlayer(1001, 'Bob');
    app.repository.upsertPlayer(1002, 'Black King');
    app.db.prepare(`
      INSERT INTO CheckInResource(eventId, playerId, checkedInAt) VALUES (?, ?, ?)
    `).run(created.session.id, 1001, '2026-10-02T12:00:00.000Z');
    const seated = await fetch(`${base}/api/games/${emptyTable.game.id}/seats/white`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1001 }),
    });
    expect(seated.status).toBe(200);
    expect(await (await fetch(`${base}/api/players?gameId=${checkedIn.game.id}`)).json())
      .toMatchObject({ players: expect.arrayContaining([expect.objectContaining({ id: 1001, name: 'Bob' })]) });
    expect(JSON.stringify(await (await fetch(
      `${base}/api/players?gameId=${checkedIn.game.id}`,
    )).json())).toContain('Black King');
    const openSide = checkedIn.game.blackPlayerId === null ? 'black' : 'white';
    const moved = await fetch(`${base}/api/games/${checkedIn.game.id}/seats/${openSide}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1001 }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({
      game: {
        id: checkedIn.game.id,
      },
    });
    expect(app.repository.getGame(emptyTable.game.id)).toMatchObject({ blackPlayerId: null, whitePlayerId: null });
    expect((await fetch(`${base}/api/games?eventId=bad`)).status).toBe(400);
    const closed = await fetch(`${base}/api/sessions/${created.session.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'cancel' }),
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({
      session: { active: false, activeGameCount: 0, closedAt: expect.any(String) },
    });
    expect(await (await fetch(`${base}/api/games?eventId=${created.session.id}`)).json())
      .toEqual({ games: [], recentGames: [] });
    await app.close();
  });

  it('validates HTTP check-ins and returns the exact matchmaking result shape', async () => {
    const app = await fixture();
    const endpoint = `http://127.0.0.1:${app.port}/api/check-ins`;
    expect((await fetch(endpoint, { method: 'GET' })).status).toBe(405);
    expect((await fetch(endpoint, { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://example.com' },
      body: JSON.stringify({ playerId: 1000, name: 'Alice' }),
    })).status).toBe(403);
    expect((await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })).status).toBe(400);
    expect((await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 999, name: 'Alice' }),
    })).status).toBe(400);

    const first = await (await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1000, name: 'Alice' }),
    })).json();
    expect(first).toMatchObject({
      status: 'waiting',
      side: expect.stringMatching(/^(black|white)$/),
      game: { tableNumber: 1, createdAt: expect.any(String) },
    });

    const repeat = await (await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1000, name: 'Alice Updated' }),
    })).json();
    expect(repeat).toMatchObject({
      status: 'already-checked-in',
      side: first.side,
      game: { id: first.game.id, tableNumber: 1 },
    });

    const original = app.repository.checkInPlayer;
    app.repository.checkInPlayer = () => { throw new Error('test check-in failure'); };
    const failed = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1001, name: 'Bob' }),
    });
    expect(failed.status).toBe(500);
    app.repository.checkInPlayer = original;
    await app.close();
  });

  it('creates authoritative players before compact QR display and resolves them by id', async () => {
    const app = await fixture();
    const endpoint = `http://127.0.0.1:${app.port}/api/players`;
    expect(await (await fetch(endpoint)).json()).toEqual({ players: [] });
    expect((await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })).status).toBe(400);
    const createdResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Ada ' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { player: { id: number; name: string } };
    expect(created.player.id).toBeGreaterThanOrEqual(1000);
    expect(created.player.id).toBeLessThanOrEqual(2000);
    expect(created.player.name).toBe('Ada');
    const lookup = await fetch(`${endpoint}/${created.player.id}`);
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toEqual({ player: { ...created.player, rating: 700 } });
    const renamed = await fetch(`${endpoint}/${created.player.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({
      player: { ...created.player, name: 'Ada Lovelace', rating: 700 },
    });
    expect((await fetch(endpoint).then((response) => response.json()))).toMatchObject({
      players: [{ id: created.player.id, name: 'Ada Lovelace', currentRating: 700 }],
    });
    expect((await fetch(`${endpoint}/999`)).status).toBe(404);
    const removed = await fetch(`${endpoint}/${created.player.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      player: { ...created.player, name: 'Ada Lovelace', rating: 700 },
    });
    expect((await fetch(`${endpoint}/${created.player.id}`)).status).toBe(404);

    const checkedIn = await app.repository.createPlayer('Busy');
    app.repository.checkInPlayer(checkedIn);
    const refused = await fetch(`${endpoint}/${checkedIn.id}`, { method: 'DELETE' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'conflict' });
    expect((await fetch(`${endpoint}/${checkedIn.id}`)).status).toBe(200);
    await app.close();
  });

  it('preserves a multibyte player name split across raw request chunks', async () => {
    const app = await fixture();
    const name = 'Zoë ♟️';
    const encoded = Buffer.from(JSON.stringify({ playerId: 1000, name }), 'utf8');
    const symbol = Buffer.from('♟', 'utf8');
    const symbolStart = encoded.indexOf(symbol);
    expect(symbolStart).toBeGreaterThan(0);
    const response = await postChunks(app.port, [
      encoded.subarray(0, symbolStart + 1),
      encoded.subarray(symbolStart + 1, symbolStart + 2),
      encoded.subarray(symbolStart + 2),
    ]);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'waiting',
      game: { tableNumber: 1 },
    });
    expect(app.repository.getPlayer(1000)).toEqual({
      id: 1000, name, rating: 700, scanningIdentifier: null,
    });
    await app.close();
  });

  it('resolves and transfers scanning identifiers without changing player IDs', async () => {
    const app = await fixture();
    app.repository.upsertPlayer(1000, 'Alice');
    app.repository.upsertPlayer(1001, 'Bob');

    const resolveCode = (identifier: string) => fetch(
      `http://127.0.0.1:${app.port}/api/players/resolve?scanningIdentifier=${
        encodeURIComponent(identifier)
      }`,
    );
    expect(await (await resolveCode('1000')).json()).toMatchObject({
      player: { id: 1000, name: 'Alice', scanningIdentifier: null },
    });

    const conflict = await fetch(
      `http://127.0.0.1:${app.port}/api/players/1001/scanning-identifier`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanningIdentifier: '1000' }),
      },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      existingPlayer: { id: 1000, name: 'Alice' },
    });

    const transfer = await fetch(
      `http://127.0.0.1:${app.port}/api/players/1001/scanning-identifier`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanningIdentifier: '1000', transfer: true }),
      },
    );
    expect(transfer.status).toBe(200);
    expect(await transfer.json()).toMatchObject({
      player: { id: 1001, name: 'Bob', scanningIdentifier: '1000' },
      previousOwner: { id: 1000, name: 'Alice', scanningIdentifier: '1001' },
    });
    expect(await (await resolveCode('1000')).json()).toMatchObject({
      player: { id: 1001, name: 'Bob' },
    });
    expect(await (await resolveCode('1001')).json()).toMatchObject({
      player: { id: 1000, name: 'Alice' },
    });
    await app.close();
  });

  it('exposes exact tools and supports the complete player/game lifecycle', async () => {
    const app = await fixture();
    const tools = await app.client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'club-session-close', 'club-session-create', 'club-session-list', 'club-session-name-update',
      'club-session-pairing-mode-update', 'contract-discover',
      'game-cancel', 'game-create', 'game-delete', 'game-get', 'game-list', 'game-result-set',
      'game-seat-update', 'game-start',
      'leaderboard-list', 'player-check-in', 'player-check-out', 'player-create', 'player-delete',
      'player-get', 'player-list', 'player-name-update', 'player-profile-get', 'player-upsert',
      'resource-create', 'resource-delete', 'resource-get', 'resource-query', 'resource-update',
      'waiting-player-move',
    ]);
    expect(Object.fromEntries(tools.tools.map((tool) => [tool.name, tool.annotations]))).toMatchObject({
      'player-list': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'player-get': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'leaderboard-list': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'club-session-list': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'club-session-create': { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      'club-session-close': { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      'club-session-name-update': { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'club-session-pairing-mode-update': { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'player-profile-get': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'player-upsert': { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'player-create': { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      'player-check-in': { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'waiting-player-move': { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      'player-delete': { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      'game-list': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'game-get': { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      'game-create': { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      'game-delete': { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      'game-result-set': { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    });
    const byName = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool]));
    expect(byName['player-create'].description).toContain('natural-language request');
    expect(Object.keys(byName['player-create'].inputSchema.properties)).toEqual(['name']);
    expect(byName['player-upsert'].description).toContain('known ID');
    expect(byName['player-check-in'].description).toContain('oldest waiting game');
    expect(byName['game-create'].description).toContain('automatically assigns');
    expect(Object.keys(byName['game-create'].inputSchema.properties).sort())
      .toEqual(['blackPlayerId', 'whitePlayerId']);
    const aliceResult = await app.client.callTool({ name: 'player-create', arguments: { name: 'Alice' } });
    const alice = (aliceResult.structuredContent as { player: { id: number; name: string } }).player;
    expect(alice).toEqual({
      id: expect.any(Number), name: 'Alice', rating: 700, scanningIdentifier: null,
    });
    await app.client.callTool({ name: 'player-upsert', arguments: { id: 1001, name: 'Bob' } });
    const created = await app.client.callTool({
      name: 'game-create',
      arguments: { blackPlayerId: alice.id, whitePlayerId: 1001 },
    });
    const game = (created.structuredContent as { game: { id: number; tableNumber: number } }).game;
    expect(game.tableNumber).toBe(1);
    expect((await app.client.callTool({ name: 'game-get', arguments: { id: game.id } })).isError)
      .not.toBe(true);
    expect((await app.client.callTool({ name: 'game-list', arguments: {} })).structuredContent)
      .toEqual({ games: [{
        id: game.id, tableNumber: 1, createdAt: expect.any(String), startedAt: null,
        blackPlayerId: alice.id, whitePlayerId: 1001,
        finishedAt: null, result: null, cancelledAt: null, cancellationReason: null, eventId: null,
      }] });
    expect(await (await fetch(`http://127.0.0.1:${app.port}/api/games`)).json()).toEqual({
      games: [{
        id: game.id,
        tableNumber: 1,
        createdAt: expect.any(String),
        startedAt: null,
        finishedAt: null,
        result: null,
        cancelledAt: null,
        cancellationReason: null,
        eventId: null,
        canCancel: true,
        blackPlayerId: alice.id,
        whitePlayerId: 1001,
        blackStartingRating: 700,
        whiteStartingRating: 700,
        blackRatingDelta: null,
        whiteRatingDelta: null,
        blackPlayer: { id: alice.id, name: 'Alice', rating: 700 },
        whitePlayer: { id: 1001, name: 'Bob', rating: 700 },
      }],
      recentGames: [],
    });
    expect((await app.client.callTool({
      name: 'game-create',
      arguments: { blackPlayerId: alice.id, whitePlayerId: alice.id },
    })).isError).toBe(true);
    expect((await app.client.callTool({
      name: 'player-delete', arguments: { id: alice.id },
    })).isError).toBe(true);
    expect((await app.client.callTool({ name: 'game-delete', arguments: { id: game.id } })).isError)
      .not.toBe(true);
    expect((await app.client.callTool({
      name: 'player-delete', arguments: { id: alice.id },
    })).isError).not.toBe(true);
    expect((await app.client.callTool({
      name: 'player-delete', arguments: { id: 1001 },
    })).isError).not.toBe(true);
    expect((await app.client.callTool({ name: 'player-list', arguments: {} })).structuredContent)
      .toEqual({ players: [] });
    const sessionResult = await app.client.callTool({
      name: 'club-session-create', arguments: { name: 'Thursday Club Night' },
    });
    const session = (sessionResult.structuredContent as { session: { id: number } }).session;
    expect((await app.client.callTool({
      name: 'club-session-pairing-mode-update',
      arguments: { id: session.id, pairingMode: 'club-session-pairing-1' },
    })).structuredContent).toMatchObject({
      session: { id: session.id, pairingMode: 'club-session-pairing-1' },
    });
    expect((await app.client.callTool({
      name: 'club-session-close', arguments: { id: session.id, resolution: 'cancel' },
    })).structuredContent).toMatchObject({
      session: { id: session.id, active: false, activeGameCount: 0, closedAt: expect.any(String) },
    });
    await app.close();
  });

  it('finalizes through HTTP and MCP with canonical immutable results', async () => {
    const app = await fixture();
    app.repository.upsertPlayer(1000, 'Alice');
    app.repository.upsertPlayer(1001, 'Bob');
    const game = app.repository.createGame(1000, 1001);
    const response = await fetch(`http://127.0.0.1:${app.port}/api/games/${game.id}/result`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: '1/2-1/2' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      game: {
        result: '1/2-1/2',
        blackPlayer: { id: 1000, rating: 700 },
        whitePlayer: { id: 1001, rating: 700 },
        blackRatingDelta: 0,
        whiteRatingDelta: 0,
      },
    });
    expect(app.repository.getPlayer(1000).rating).toBe(700);
    expect(app.repository.getPlayer(1001).rating).toBe(700);
    const repeated = await fetch(`http://127.0.0.1:${app.port}/api/games/${game.id}/result`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: '1/2-1/2' }),
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      game: {
        result: '1/2-1/2',
        blackRatingDelta: 0,
        whiteRatingDelta: 0,
      },
    });
    expect((await fetch(`http://127.0.0.1:${app.port}/api/games/${game.id}/result`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: '1-0' }),
    })).status).toBe(409);

    const next = app.repository.createGame(1000, 1001);
    const mcp = await app.client.callTool({
      name: 'game-result-set',
      arguments: { id: next.id, result: '0-1' },
    });
    expect(mcp.structuredContent).toMatchObject({ game: { result: '0-1' } });
    expect(app.repository.getPlayer(1000).rating).toBe(716);
    expect(app.repository.getPlayer(1001).rating).toBe(684);
    await app.close();
  });

  it('updates active seats and deletes an unfinished game through HTTP', async () => {
    const app = await fixture();
    for (const [id, name] of [[1000, 'Alice'], [1001, 'Bob'], [1002, 'Carol']] as const) {
      app.repository.upsertPlayer(id, name);
    }
    const game = app.repository.createGame(1000, 1001);
    const seat = await fetch(`http://127.0.0.1:${app.port}/api/games/${game.id}/seats/black`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 1002 }),
    });
    expect(seat.status).toBe(200);
    expect(await seat.json()).toMatchObject({ game: { blackPlayerId: 1002 } });
    const removed = await app.client.callTool({
      name: 'game-seat-update',
      arguments: { id: game.id, side: 'white', playerId: null },
    });
    expect(removed.structuredContent).toMatchObject({ game: { whitePlayerId: null } });
    const cancelled = await fetch(`http://127.0.0.1:${app.port}/api/games/${game.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'duplicate table' }),
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ game: { id: game.id, result: null } });
    expect(() => app.repository.getGame(game.id)).toThrow(NotFoundError);
    expect((await app.client.callTool({
      name: 'game-cancel', arguments: { id: game.id },
    })).isError).toBe(true);
    await app.close();
  });

  it('checks players in through MCP using the same idempotent domain service', async () => {
    const app = await fixture();
    const first = await app.client.callTool({
      name: 'player-check-in', arguments: { playerId: 1000, name: 'Alice' },
    });
    expect(first.structuredContent).toMatchObject({
      status: 'waiting', game: { tableNumber: 1 }, side: expect.any(String),
    });
    const second = await app.client.callTool({
      name: 'player-check-in', arguments: { playerId: 1001, name: 'Bob' },
    });
    expect(second.structuredContent).toMatchObject({
      status: 'paired', game: { tableNumber: 1 }, side: expect.any(String),
    });
    const repeat = await app.client.callTool({
      name: 'player-check-in', arguments: { playerId: 1001, name: 'Bobby' },
    });
    expect(repeat.structuredContent).toMatchObject({
      status: 'already-checked-in',
      game: { id: (second.structuredContent as { game: { id: number } }).game.id },
    });
    await app.close();
  });
});
