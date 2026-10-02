import { z } from 'zod';
import { ClubSessionPairingModeSchema } from './club-session.shared.js';
import type { ResourceDescriptor } from './types.js';

export const ClubSessionSpecSchema = z.object({
  name: z.string().trim().min(1).max(120),
  pairingMode: ClubSessionPairingModeSchema,
});

export const ClubSessionStatusSchema = z.object({
  lifecycle: z.enum(['active', 'closed']),
  closedAt: z.string().datetime().nullable(),
  playerCount: z.number().int().nonnegative(),
  gameCount: z.number().int().nonnegative(),
  activeGameCount: z.number().int().nonnegative(),
});

export const clubSessionResource: ResourceDescriptor = {
  description: 'A bounded club session that freezes pairing cohorts and scopes check-ins and games.',
  spec: ClubSessionSpecSchema,
  status: ClubSessionStatusSchema,
  relationships: { checkIns: 'check-in[]', games: 'game[]', cohorts: 'pairing-cohort[]' },
  constraints: [
    'At most one Club Session may be active.',
    'Pairing mode is club-session-pairing-1.',
  ],
  lifecycle: ['active -> closed', 'Closing resolves every unfinished game atomically.'],
  effects: [
    'Create defaults pairingMode to club-session-pairing-1 when omitted.',
    'Create snapshots every existing player into one of four rating cohorts.',
  ],
  fields: {
    generated: ['metadata.id', 'metadata.createdAt', 'status'],
    mutable: ['spec.name', 'spec.pairingMode'],
    immutable: [],
  },
};
