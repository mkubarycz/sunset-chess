import { z } from 'zod';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const GameDeleteInputSchema = z.object({ id: z.string().min(1) }).strict();
export const GameDeleteOutputSchema = mutationOutputSchema();

export const gameDeleteOperation: ResourceOperationDefinition = {
  method: 'delete',
  description: 'Delete a game when its lifecycle rules permit removal.',
  input: GameDeleteInputSchema,
  output: GameDeleteOutputSchema,
};
