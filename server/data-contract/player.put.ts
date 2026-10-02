import { z } from 'zod';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const PlayerUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(80).describe('Replacement player display name.'),
}).strict().describe('Generic player update input.');
export const PlayerPutOutputSchema = mutationOutputSchema();

export const playerPutOperation: ResourceOperationDefinition = {
  method: 'put',
  description: 'Replace the mutable player name.',
  input: PlayerUpdateInputSchema,
  output: PlayerPutOutputSchema,
};
