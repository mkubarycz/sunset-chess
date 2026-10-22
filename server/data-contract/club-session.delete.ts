import { z } from 'zod';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const ClubSessionDeleteInputSchema = z.object({ id: z.string().min(1) }).strict();
export const ClubSessionDeleteOutputSchema = mutationOutputSchema();

export const clubSessionDeleteOperation: ResourceOperationDefinition = {
  method: 'delete',
  description: 'Soft-delete a Club Session only when it has zero check-ins and zero games.',
  input: ClubSessionDeleteInputSchema,
  output: ClubSessionDeleteOutputSchema,
};
