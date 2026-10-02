import { z } from 'zod';
import { ClubSessionPairingModeSchema } from './club-session.shared.js';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const ClubSessionUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional()
    .describe('Replacement Club Session name.'),
  pairingMode: ClubSessionPairingModeSchema.optional()
    .describe('Replacement policy; Sunset Chess 1.2 supports one policy.'),
}).strict().refine(
  (value) => value.name !== undefined || value.pairingMode !== undefined,
  { message: 'At least one Club Session update field is required.' },
).describe('Generic Club Session update input.');
export const ClubSessionPutOutputSchema = mutationOutputSchema();

export const clubSessionPutOperation: ResourceOperationDefinition = {
  method: 'put',
  description: 'Update Club Session name or pairing policy.',
  input: ClubSessionUpdateInputSchema,
  output: ClubSessionPutOutputSchema,
};
