import { z } from 'zod';
import type { ResourceDescriptor } from './types.js';

export const PairingCohortSpecSchema = z.object({
  cohort: z.enum(['A', 'B', 'C', 'D']),
  snapshotRating: z.number().int().min(0).max(10_000),
});

export const PairingCohortStatusSchema = z.object({ frozen: z.literal(true) });

export const pairingCohortResource: ResourceDescriptor = {
  description: 'A frozen session/player rating cohort used as a mandatory pairing boundary.',
  spec: PairingCohortSpecSchema,
  status: PairingCohortStatusSchema,
  relationships: { player: 'player', session: 'club-session' },
  constraints: ['Unique for each session/player.', 'Cohort is A, B, C, or D.'],
  lifecycle: ['Frozen for the lifetime of the Club Session.'],
  effects: ['Late check-in assigns from the original cohort rating boundaries.'],
  fields: {
    generated: ['metadata.id'],
    mutable: [],
    immutable: ['spec', 'status', 'relationships'],
  },
};
