import { z } from 'zod';
import { GamePlayerIdSchema } from './game.shared.js';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const GameUpdateInputSchema = z.object({
  start: z.boolean().optional()
    .describe('True marks a fully seated unfinished game Playing; false returns an unfinished game to Paired and clears startedAt.'),
  swapSides: z.boolean().optional().describe('Atomically exchange the black and white seats, including an empty seat.'),
  overrideStarted: z.boolean().optional()
    .describe('Explicit consent to modify seats or cancel a Started game, including a source table.'),
  blackPlayerId: GamePlayerIdSchema.optional().describe('Replacement black seat. Null clears it.'),
  whitePlayerId: GamePlayerIdSchema.optional().describe('Replacement white seat. Null clears it.'),
  result: z.enum(['1-0', '0-1', '1/2-1/2']).optional()
    .describe('Canonical final result. Both seats must be occupied.'),
  cancel: z.boolean().optional()
    .describe('True cancels the game under the cancellation lifecycle rules.'),
  cancellationReason: z.string().max(500).optional()
    .describe('Optional reason; valid only when cancel is true. Empty text is treated as no reason.'),
}).strict().refine(
  (value) => value.cancel === true || value.cancellationReason === undefined,
  { message: 'cancellationReason requires cancel: true.' },
).refine(
  (value) => !value.swapSides || (value.blackPlayerId === undefined && value.whitePlayerId === undefined),
  { message: 'Switching sides cannot be combined with replacement seat assignments.' },
).describe('Generic atomic game update input.');
export const GamePutOutputSchema = mutationOutputSchema();

export const gamePutOperation: ResourceOperationDefinition = {
  method: 'put',
  description: 'Atomically update or switch seats, start, result, and cancellation state. Seating checks players in and moves them within the same event; Started edits require explicit override.',
  input: GameUpdateInputSchema,
  output: GamePutOutputSchema,
};
