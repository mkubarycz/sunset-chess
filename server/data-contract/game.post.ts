import { z } from 'zod';
import { GamePlayerIdSchema } from './game.shared.js';
import { createOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const GameCreateInputSchema = z.object({
  blackPlayerId: GamePlayerIdSchema.optional()
    .describe('Black seat. Supply both player IDs for a seated game or null for both seats.'),
  whitePlayerId: GamePlayerIdSchema.optional()
    .describe('White seat. Supply both player IDs for a seated game or null for both seats.'),
  eventId: z.number().int().positive().nullable().optional()
    .describe('Club Session identity, null for a standalone game, or omitted for the active session.'),
}).strict().refine(
  ({ blackPlayerId, whitePlayerId }) =>
    (blackPlayerId === undefined && whitePlayerId === undefined)
    || (blackPlayerId === null && whitePlayerId === null)
    || (typeof blackPlayerId === 'number' && typeof whitePlayerId === 'number'),
  { message: 'Seats must both be omitted, both be null, or both contain player IDs.' },
).describe('Generic game creation input. Table number, identity, timestamps, and lifecycle are generated.');
export const GamePostOutputSchema = createOutputSchema();

export const gamePostOperation: ResourceOperationDefinition = {
  method: 'post',
  description: 'Create an empty or fully seated game.',
  input: GameCreateInputSchema,
  output: GamePostOutputSchema,
};
