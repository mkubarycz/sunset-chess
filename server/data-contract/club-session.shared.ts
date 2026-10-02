import { z } from 'zod';

export const ClubSessionPairingModeSchema = z.literal('club-session-pairing-1')
  .describe('The only supported pairing policy in Sunset Chess 1.2.');
