import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DomainError } from './errors.js';
import type { ChessRepository } from './repository.js';

const playerId = z.number().int().min(1000).max(2000);
const gameId = z.number().int().positive();
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
    if (error instanceof DomainError) {
      const body = { error: { code: error.code, message: error.message } };
      return { ...result(body), isError: true };
    }
    throw error;
  }
}

export function createMcpServer(repository: ChessRepository): McpServer {
  const server = new McpServer({ name: 'sunset-chess', version: '1.0.0' });
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
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit }) => domainResult(() => ({ leaderboard: repository.listLeaderboard(limit) })));
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
    description: 'Check in a player by known QR player ID and name. Atomically updates the player and returns their existing game, pairs them into the oldest waiting game, or creates a waiting game at the lowest available table.',
    inputSchema: { playerId, name: z.string().trim().min(1).max(80) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ playerId: id, name }) =>
    domainResult(() => repository.checkInPlayer({ id, name })));
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
    description: 'Audit-cancel a game. Finished games are compensated only when latest for both players.',
    inputSchema: { id: gameId, reason: z.string().trim().min(1).max(500).optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id, reason }) => domainResult(() => ({ game: repository.cancelGame(id, reason) })));
  server.registerTool('game-delete', {
    description: 'Backward-compatible alias that audit-cancels one game without deleting history.',
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ id, result: finalResult }) =>
    domainResult(() => ({ game: repository.finalizeGame(id, finalResult) })));
  return server;
}
