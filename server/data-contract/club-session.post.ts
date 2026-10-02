import { z } from 'zod';
import { ClubSessionPairingModeSchema } from './club-session.shared.js';
import { createOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const ClubSessionCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional()
    .describe('Optional session name; omitted uses the server-generated date-based name.'),
  pairingMode: ClubSessionPairingModeSchema.optional()
    .describe('Optional explicit policy; omitted intentionally defaults to club-session-pairing-1.'),
}).strict().describe('Generic Club Session creation input.');
export const ClubSessionPostOutputSchema = createOutputSchema();

export const clubSessionPostOperation: ResourceOperationDefinition = {
  method: 'post',
  description: 'Create the sole active Club Session and freeze rating cohorts.',
  input: ClubSessionCreateInputSchema,
  output: ClubSessionPostOutputSchema,
};
