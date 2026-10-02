import { z } from 'zod';
import { readOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const CheckInGetInputSchema = z.object({
  id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  eventId: z.number().int().positive().optional(),
  playerId: z.number().int().min(1000).max(2000).optional(),
}).strict();
export const CheckInGetOutputSchema = readOutputSchema();

export const checkInGetOperation: ResourceOperationDefinition = {
  method: 'get',
  description: 'Read one check-in or query check-ins by session or player.',
  input: CheckInGetInputSchema,
  output: CheckInGetOutputSchema,
};
