import { z } from 'zod';

export const ResourceMetadataSchema = z.object({
  id: z.string().describe('Stable resource identifier.'),
  createdAt: z.string().datetime().describe('ISO-8601 creation time.'),
  updatedAt: z.string().datetime().optional().describe('ISO-8601 last modification time.'),
  version: z.number().int().positive().default(1).describe('Optimistic resource version.'),
}).describe('Common identity and revision metadata.');

export const RelationshipValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.null(),
]);

export const ResourceEnvelopeSchema = z.object({
  kind: z.string().min(1).describe('Resource kind registered by the application contract.'),
  metadata: ResourceMetadataSchema,
  spec: z.record(z.string(), z.unknown()).describe('Desired and immutable domain attributes.'),
  status: z.record(z.string(), z.unknown()).describe('Observed lifecycle and computed state.'),
  relationships: z.record(z.string(), RelationshipValueSchema)
    .describe('Stable identifiers of related resources.'),
}).describe('Sunset Chess resource envelope.');
