import { z } from 'zod';
import type { ResourceDescriptor } from './types.js';

export const PlayerSpecSchema = z.object({
  name: z.string().trim().min(1).max(80).describe('Player display name.'),
  scanningIdentifier: z.string().min(1).max(2048).nullable()
    .describe('QR scanning identifier; null falls back to the player resource ID.'),
});

export const PlayerStatusSchema = z.object({
  rating: z.number().int().min(0).max(10_000).describe('Authoritative projected Elo rating.'),
});

export const playerResource: ResourceDescriptor = {
  description: 'A club player with a server-constrained identity and Elo projection.',
  spec: PlayerSpecSchema,
  status: PlayerStatusSchema,
  relationships: { ratingEvents: 'rating-event[]', checkIns: 'check-in[]', games: 'game[]' },
  constraints: [
    'ID is an integer from 1000 through 2000.',
    'Name is 1–80 trimmed characters.',
    'A non-null scanning identifier is unique; null resolves to the player ID.',
  ],
  lifecycle: [
    'Created with a baseline rating event.',
    'Deletable only before game or non-baseline rating history exists.',
  ],
  effects: ['Create allocates an unused random ID when none is supplied.'],
  fields: {
    generated: ['metadata.id', 'metadata.createdAt', 'status.rating'],
    mutable: ['spec.name', 'spec.scanningIdentifier'],
    immutable: [],
  },
};
