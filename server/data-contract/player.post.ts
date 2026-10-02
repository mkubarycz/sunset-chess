import { z } from 'zod';
import { createOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const PlayerCreateInputSchema = z.object({
  id: z.number().int().min(1000).max(2000).optional()
    .describe('Optional known QR identity; omitted allocates an available ID.'),
  name: z.string().trim().min(1).max(80).describe('Player display name.'),
}).strict().describe('Generic player creation input.');
export const PlayerPostOutputSchema = createOutputSchema();

export const playerPostOperation: ResourceOperationDefinition = {
  method: 'post',
  description: 'Create a player and its baseline rating event.',
  input: PlayerCreateInputSchema,
  output: PlayerPostOutputSchema,
};
