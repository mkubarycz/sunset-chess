import { z } from 'zod';
import { mutationOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const CheckInUpdateInputSchema = z.object({ checkOut: z.literal(true) }).strict();

export const checkInPutOperation: ResourceOperationDefinition = {
  method: 'put',
  description: 'Check a player out of their active Club Session after their current game is finished or cancelled.',
  input: CheckInUpdateInputSchema,
  output: mutationOutputSchema(),
};
