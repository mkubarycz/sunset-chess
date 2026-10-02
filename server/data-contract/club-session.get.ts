import { z } from 'zod';
import { readOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const ClubSessionGetInputSchema = z.object({
  id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
export const ClubSessionGetOutputSchema = readOutputSchema();

export const clubSessionGetOperation: ResourceOperationDefinition = {
  method: 'get',
  description: 'Read one Club Session or query Club Session envelopes.',
  input: ClubSessionGetInputSchema,
  output: ClubSessionGetOutputSchema,
};
