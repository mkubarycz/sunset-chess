import { z } from 'zod';
import type { ResourceDescriptor } from './types.js';

export const GameSpecSchema = z.object({
  tableNumber: z.number().int().positive(),
});

export const GameStatusSchema = z.object({
  lifecycle: z.enum(['waiting', 'playing', 'started', 'finished', 'cancelled']),
  startedAt: z.string().datetime().nullable(),
  result: z.enum(['1-0', '0-1', '1/2-1/2']).nullable(),
  finishedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: z.string().nullable(),
});

export const gameResource: ResourceDescriptor = {
  description: 'A table placement and chess game, optionally scoped to a Club Session.',
  spec: GameSpecSchema,
  status: GameStatusSchema,
  relationships: {
    blackPlayer: 'player|null',
    whitePlayer: 'player|null',
    session: 'club-session|null',
  },
  constraints: [
    'A player occupies at most one active game.',
    'Active table numbers are unique.',
    'Players must differ.',
    'Seat edits and cancellation of Started games require explicit override consent.',
  ],
  lifecycle: [
    'waiting -> playing -> started -> finished',
    'playing -> finished (result reporting does not require explicit Start).',
    'waiting|playing|started -> cancelled',
    'finished -> cancelled only when rating compensation is safe.',
  ],
  effects: ['Finalization appends two rating ledger events and updates both projections atomically.'],
  fields: {
    generated: [
      'metadata.id',
      'metadata.createdAt',
      'spec.tableNumber',
      'status.lifecycle',
      'status.finishedAt',
      'status.startedAt',
      'status.cancelledAt',
    ],
    mutable: [
      'relationships.blackPlayer',
      'relationships.whitePlayer',
      'status.result',
      'status.cancellationReason',
    ],
    immutable: ['relationships.session'],
  },
};
