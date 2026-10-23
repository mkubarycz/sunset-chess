import { z } from 'zod';
import type { ResourceDescriptor } from './types.js';

export const CheckInSpecSchema = z.object({
  playerId: z.number().int().min(1000).max(2000),
  name: z.string().trim().min(1).max(80),
});

export const CheckInStatusSchema = z.object({
  placement: z.enum(['paired', 'waiting', 'already-checked-in', 'available', 'checked-out', 'migrated'])
    .describe('migrated means v9 attendance existed but its original placement was not recoverable.'),
  side: z.enum(['black', 'white']).nullable(),
  checkedInAt: z.string().datetime(),
  checkedOutAt: z.string().datetime().nullable(),
  attendance: z.enum(['checked-in', 'checked-out']),
});

export const checkInResource: ResourceDescriptor = {
  description: 'Session attendance, retained until explicit checkout, and the atomic entry point to pairing placement.',
  spec: CheckInSpecSchema,
  status: CheckInStatusSchema,
  relationships: {
    player: 'player',
    session: 'club-session|null',
    game: 'game|null',
    cohort: 'pairing-cohort|null',
  },
  constraints: [
    'One check-in per player per Club Session.',
    'Session pairing never crosses frozen cohorts or repeats an opponent.',
  ],
  lifecycle: [
    'Created once per session; attendance remains active after scoring until checkout or session closure.',
    'Checkout releases unstarted seats but is blocked during started games; explicit check-in reactivates attendance.',
    'Game placement tracks current assignment; historical games and rating events remain unchanged.',
    'Migrated v9 attendance without a reconstructable active placement is explicitly marked migrated.',
  ],
  effects: [
    'Create atomically upserts the player, freezes a late player cohort, records attendance, and preserves pairing/game placement.',
    'Existing active placement returns already-checked-in without duplicating attendance.',
    'Scoring automatically pairs available checked-in players within cohorts without repeating opponents.',
    'Checked-out players cannot be assigned to another game without explicit check-in.',
  ],
  fields: {
    generated: [
      'metadata.id',
      'metadata.createdAt',
      'status',
      'relationships.game',
      'relationships.cohort',
    ],
    mutable: ['status.checkedOutAt', 'status.attendance', 'relationships.game', 'status.placement', 'status.side'],
    immutable: ['spec.playerId', 'relationships.player', 'relationships.session'],
  },
};
