import { z } from 'zod';

export const ResourceKindSchema = z.enum([
  'player',
  'club-session',
  'check-in',
  'game',
  'rating-event',
  'pairing-cohort',
]);

export type ResourceKind = z.infer<typeof ResourceKindSchema>;
