import { z } from 'zod';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const PlayerDeleteInputSchema = z.object({ id: z.string().min(1) }).strict();
export const PlayerDeleteOutputSchema = mutationOutputSchema();

export const playerDeleteOperation: ResourceOperationDefinition = {
  method: 'delete',
  description: 'Delete a player when no protected game or rating history exists.',
  input: PlayerDeleteInputSchema,
  output: PlayerDeleteOutputSchema,
};
