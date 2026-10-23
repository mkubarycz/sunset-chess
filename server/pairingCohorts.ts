import type { DatabaseSync } from 'node:sqlite';

export function ensurePairingCohort(
  db: DatabaseSync, eventId: number, player: { id: number; rating: number },
): void {
  if (db.prepare(`
    SELECT 1 FROM PairingCohortResource WHERE eventId = ? AND playerId = ?
  `).get(eventId, player.id)) return;
  const boundaries = db.prepare(`
    SELECT cohort, MIN(snapshotRating) AS minimumRating
    FROM PairingCohortResource
    WHERE eventId = ?
    GROUP BY cohort
    ORDER BY CASE cohort WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
  `).all(eventId) as Array<{
    cohort: 'A' | 'B' | 'C' | 'D';
    minimumRating: number;
  }>;
  const cohort = boundaries.find(({ minimumRating }) => player.rating >= minimumRating)?.cohort
    ?? boundaries.at(-1)?.cohort
    ?? 'A';
  db.prepare(`
    INSERT INTO PairingCohortResource(eventId, playerId, cohort, snapshotRating)
    VALUES (?, ?, ?, ?)
  `).run(eventId, player.id, cohort, player.rating);
}
