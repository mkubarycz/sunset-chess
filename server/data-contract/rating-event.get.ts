import { z } from 'zod';
import { readOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const RatingEventGetInputSchema = z.object({
  id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  playerId: z.number().int().min(1000).max(2000).optional(),
}).strict();
export const RatingEventGetOutputSchema = readOutputSchema();

export const ratingEventGetOperation: ResourceOperationDefinition = {
  method: 'get',
  description: 'Read one rating event or query the immutable ledger by player.',
  input: RatingEventGetInputSchema,
  output: RatingEventGetOutputSchema,
};
