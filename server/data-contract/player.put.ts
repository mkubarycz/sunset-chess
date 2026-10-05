import { z } from 'zod';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const PlayerUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional()
    .describe('Replacement player display name.'),
  scanningIdentifier: z.string().min(1).max(2048).nullable().optional()
    .describe('Replacement QR scanning identifier; null restores player-ID fallback.'),
}).strict().refine(
  ({ name, scanningIdentifier }) => name !== undefined || scanningIdentifier !== undefined,
  { message: 'At least one mutable player field is required.' },
).describe('Generic player update input.');
export const PlayerPutOutputSchema = mutationOutputSchema();

export const playerPutOperation: ResourceOperationDefinition = {
  method: 'put',
  description: 'Replace the mutable player name.',
  input: PlayerUpdateInputSchema,
  output: PlayerPutOutputSchema,
};
