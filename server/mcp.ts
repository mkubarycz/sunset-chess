import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sunsetChessContract } from './data-contract/index.js';
import { DomainError } from './errors.js';
import type { ChessRepository } from './repository.js';
import { ResourceService } from './resources.js';

const playerId = z.number().int().min(1000).max(2000);
const gameId = z.number().int().positive();
const sessionId = z.number().int().positive();
const gameResult = z.enum(['1-0', '0-1', '1/2-1/2']);

function result(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function domainResult(action: () => unknown) {
  try {
    return result(action());
  } catch (error) {
    if (error instanceof z.ZodError) {
      const body = {
        error: {
          code: 'validation',
          message: 'Resource input does not conform to the application contract.',
          issues: error.issues,
        },
      };
      return { ...result(body), isError: true };
    }
    if (error instanceof DomainError) {
      const body = { error: { code: error.code, message: error.message } };
      return { ...result(body), isError: true };
    }
    throw error;
  }
}

export function createMcpServer(repository: ChessRepository): McpServer {
  const server = new McpServer({ name: 'sunset-chess', version: '1.3.0' });
  const resources = new ResourceService(repository);
  server.registerTool('contract-discover', {
    description: 'Discover the self-describing Sunset Chess application/resource contract, including schemas, relationships, capabilities, constraints, lifecycle rules, effects, errors, and events.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(sunsetChessContract));
  server.registerTool('resource-query', {
    description: 'Query common-envelope resources by kind and supported relationship filters.',
    inputSchema: {
      kind: z.string(),
      limit: z.number().int().min(1).max(200).optional(),
      eventId: z.number().int().positive().optional(),
      playerId: playerId.optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ kind, limit, eventId, playerId: queryPlayerId }) =>
    domainResult(() => ({
      resources: resources.query(kind, { limit, eventId, playerId: queryPlayerId }),
    })));
  server.registerTool('resource-get', {
    description: 'Read one common-envelope resource by kind and stable identifier.',
    inputSchema: { kind: z.string(), id: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ kind, id }) => domainResult(() => ({ resource: resources.get(kind, id) })));
  server.registerTool('resource-create', {
    description: 'Create a resource through its declared domain operation and return atomic effects.',
    inputSchema: { kind: z.string(), spec: z.record(z.string(), z.unknown()) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ kind, spec }) => domainResult(() => resources.create(kind, spec)));
  server.registerTool('resource-update', {
    description: 'Update mutable resource specification through declared lifecycle rules.',
    inputSchema: {
      kind: z.string(),
      id: z.string().min(1),
      spec: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ kind, id, spec }) =>
    domainResult(() => ({ resource: resources.update(kind, id, spec) })));
  server.registerTool('resource-delete', {
    description: 'Delete a resource only when its declared capability and lifecycle permit it.',
    inputSchema: { kind: z.string(), id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ kind, id }) =>
    domainResult(() => ({ resource: resources.delete(kind, id) })));
  server.registerTool('player-list', {
    description: 'List every player ordered by id.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => domainResult(() => ({ players: repository.listPlayers() })));
  server.registerTool('player-get', {
    description: 'Get one player.',
    inputSchema: { id: playerId },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => domainResult(() => ({ player: repository.getPlayer(id) })));
  server.registerTool('leaderboard-list', {
    description: 'List players by authoritative Elo, then games played, case-insensitive name, and id.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      eventId: sessionId.optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit, eventId }) =>
    domainResult(() => ({ leaderboard: repository.listLeaderboard(limit, eventId) })));
  server.registerTool('club-session-list', {
    description: 'List Club Sessions with active state and checked-in player and game counts.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => domainResult(() => ({ sessions: repository.listClubSessions() })));
  server.registerTool('club-session-create', {
    description: 'Create and activate a Club Session. The server generates a date-based title when none is provided.',
    inputSchema: { name: z.string().trim().min(1).max(120).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name }) => domainResult(() => ({ session: repository.createClubSession(name) })));
  server.registerTool('club-session-name-update', {
    description: 'Rename an existing Club Session.',
    inputSchema: { id: sessionId, name: z.string().trim().min(1).max(120) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, name }) =>
    domainResult(() => ({ session: repository.updateClubSessionName(id, name) })));
  server.registerTool('club-session-pairing-mode-update', {
    description: 'Select the pairing policy for a Club Session.',
    inputSchema: { id: sessionId, pairingMode: z.literal('club-session-pairing-1') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, pairingMode }) =>
    domainResult(() => ({ session: repository.updateClubSessionPairingMode(id, pairingMode) })));
  server.registerTool('club-session-close', {
    description: 'Close an active Club Session. Draw finalizes fully seated games as draws and cancels incomplete games; cancel removes every unfinished game.',
    inputSchema: { id: sessionId, resolution: z.enum(['draw', 'cancel']) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, resolution }) =>
    domainResult(() => ({ session: repository.closeClubSession(id, resolution) })));
  server.registerTool('player-profile-get', {
    description: 'Get a player profile with Elo rank and record, recent completed games, and chronological immutable rating history.',
    inputSchema: {
      id: playerId,
      recentLimit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, recentLimit }) =>
    domainResult(() => ({ profile: repository.getPlayerProfile(id, recentLimit) })));
  server.registerTool('player-upsert', {
    description: 'Idempotently create or update a player with a known ID, such as one read from a QR code or scanner.',
    inputSchema: { id: playerId, name: z.string().trim().min(1).max(80) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, name }) => domainResult(() => ({ player: repository.upsertPlayer(id, name) })));
  server.registerTool('player-create', {
    description: 'Create a new player from a natural-language request using only their name; the server assigns an available random ID.',
    inputSchema: { name: z.string().trim().min(1).max(80) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name }) => domainResult(() => ({ player: repository.createPlayer(name) })));
  server.registerTool('player-name-update', {
    description: 'Rename an existing player without changing their identity or rating history.',
    inputSchema: { id: playerId, name: z.string().trim().min(1).max(80) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, name }) =>
    domainResult(() => ({ player: repository.updatePlayerName(id, name) })));
  server.registerTool('player-check-in', {
    description: 'Check in a player by known QR player ID and name. Atomically updates the player and returns their existing game, pairs them into the oldest waiting game, uses the lowest-numbered empty table, or creates a waiting game at the lowest available table.',
    inputSchema: { playerId, name: z.string().trim().min(1).max(80) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ playerId: id, name }) =>
    domainResult(() => repository.checkInPlayer({ id, name })));
  server.registerTool('waiting-player-move', {
    description: 'Move a player who is waiting alone to another waiting table in the same event and close the table they vacated.',
    inputSchema: { playerId, destinationGameId: gameId },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ playerId: id, destinationGameId }) =>
    domainResult(() => ({ game: repository.moveWaitingPlayer(id, destinationGameId) })));
  server.registerTool('player-delete', {
    description: 'Delete an unreferenced player.',
    inputSchema: { id: playerId },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => domainResult(() => ({ player: repository.deletePlayer(id) })));
  server.registerTool('game-list', {
    description: 'List every chess game ordered by id.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => domainResult(() => ({ games: repository.listGames() })));
  server.registerTool('game-get', {
    description: 'Get one chess game.',
    inputSchema: { id: gameId },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => domainResult(() => ({ game: repository.getGame(id) })));
  server.registerTool('game-create', {
    description: 'Create a chess game between two existing, distinct players; the server automatically assigns the lowest available table number.',
    inputSchema: { blackPlayerId: playerId, whitePlayerId: playerId },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ blackPlayerId, whitePlayerId }) =>
    domainResult(() => ({ game: repository.createGame(blackPlayerId, whitePlayerId) })));
  server.registerTool('game-cancel', {
    description: 'Delete an unfinished game or audit-cancel a finished game when latest for both players.',
    inputSchema: { id: gameId, reason: z.string().trim().min(1).max(500).optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id, reason }) => domainResult(() => ({ game: repository.cancelGame(id, reason) })));
  server.registerTool('game-delete', {
    description: 'Backward-compatible alias that deletes an unfinished game or audit-cancels a finished game.',
    inputSchema: { id: gameId },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => domainResult(() => ({ game: repository.deleteGame(id) })));
  server.registerTool('game-seat-update', {
    description: 'Remove or replace one seat on a non-cancelled unfinished game.',
    inputSchema: { id: gameId, side: z.enum(['black', 'white']), playerId: playerId.nullable() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id, side, playerId: replacementId }) =>
    domainResult(() => ({ game: repository.updateGameSeat(id, side, replacementId) })));
  server.registerTool('game-result-set', {
    description: 'Finalize a fully seated game with a canonical PGN result and atomically update both player Elo ratings exactly once.',
    inputSchema: { id: gameId, result: gameResult },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, result: finalResult }) =>
    domainResult(() => ({ game: repository.finalizeGame(id, finalResult) })));
  return server;
}
