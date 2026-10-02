import { z } from 'zod';
import { createOutputSchema } from './operation.js';
import type { ResourceOperationDefinition } from './types.js';

export const CheckInCreateInputSchema = z.object({
  playerId: z.number().int().min(1000).max(2000)
    .describe('Known QR player identity.'),
  name: z.string().trim().min(1).max(80)
    .describe('Authoritative player name to create or refresh during check-in.'),
}).strict().describe('Generic atomic check-in creation input.');
export const CheckInPostOutputSchema = createOutputSchema();

export const checkInPostOperation: ResourceOperationDefinition = {
  method: 'post',
  description: 'Atomically check in a player and preserve pairing placement effects.',
  input: CheckInCreateInputSchema,
  output: CheckInPostOutputSchema,
};
