import { z } from 'zod';
import type { ResourceDescriptor } from './types.js';

export const RatingEventSpecSchema = z.object({
  previousRating: z.number().int(),
  rating: z.number().int(),
  delta: z.number().int(),
  reason: z.enum(['baseline', 'game', 'migration', 'compensation']),
  result: z.enum(['1-0', '0-1', '1/2-1/2']).nullable(),
});

export const RatingEventStatusSchema = z.object({ recordedAt: z.string().datetime() });

export const ratingEventResource: ResourceDescriptor = {
  description: 'An immutable entry in the authoritative player rating ledger.',
  spec: RatingEventSpecSchema,
  status: RatingEventStatusSchema,
  relationships: { player: 'player', game: 'game|null', opponent: 'player|null' },
  constraints: [
    'rating = previousRating + delta.',
    'Exactly two game events are written for a finalized game.',
  ],
  lifecycle: ['Append-only.'],
  effects: ['Game cancellation appends compensation events rather than rewriting history.'],
  fields: {
    generated: ['metadata.id'],
    mutable: [],
    immutable: ['spec', 'status', 'relationships'],
  },
};
