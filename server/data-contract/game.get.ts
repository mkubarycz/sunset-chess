import { z } from 'zod';
import { readOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const GameGetInputSchema = z.object({
  id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  eventId: z.number().int().positive().optional(),
}).strict();
export const GameGetOutputSchema = readOutputSchema();

export const gameGetOperation: ResourceOperationDefinition = {
  method: 'get',
  description: 'Read one game or query games by Club Session.',
  input: GameGetInputSchema,
  output: GameGetOutputSchema,
};
