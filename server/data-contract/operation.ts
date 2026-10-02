import { z } from 'zod';
import { ResourceEnvelopeSchema } from './envelope.js';

export function readOutputSchema() {
  return z.union([
    z.object({ resource: ResourceEnvelopeSchema }).strict(),
    z.object({ resources: z.array(ResourceEnvelopeSchema) }).strict(),
  ]);
}

export function createOutputSchema() {
  return z.object({
    resource: ResourceEnvelopeSchema,
    effects: z.array(ResourceEnvelopeSchema).optional(),
  }).strict();
}

export function mutationOutputSchema() {
  return z.object({ resource: ResourceEnvelopeSchema }).strict();
}
