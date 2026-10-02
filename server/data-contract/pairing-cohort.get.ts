import { z } from 'zod';
import { readOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const PairingCohortGetInputSchema = z.object({
  id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  eventId: z.number().int().positive().optional(),
  playerId: z.number().int().min(1000).max(2000).optional(),
}).strict();
export const PairingCohortGetOutputSchema = readOutputSchema();

export const pairingCohortGetOperation: ResourceOperationDefinition = {
  method: 'get',
  description: 'Read one pairing cohort or query frozen cohorts by session or player.',
  input: PairingCohortGetInputSchema,
  output: PairingCohortGetOutputSchema,
};
