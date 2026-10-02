import { z } from 'zod';

export const GamePlayerIdSchema = z.number().int().min(1000).max(2000).nullable();
