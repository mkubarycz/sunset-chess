import { z } from 'zod';
import { readOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const PlayerGetInputSchema = z.object({
  id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
export const PlayerGetOutputSchema = readOutputSchema();

export const playerGetOperation: ResourceOperationDefinition = {
  method: 'get',
  description: 'Read one player or query player envelopes.',
  input: PlayerGetInputSchema,
  output: PlayerGetOutputSchema,
};
