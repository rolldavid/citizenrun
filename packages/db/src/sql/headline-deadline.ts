import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../client.ts';

/**
 * Recomputes filing_opens, filing_deadline, filing_deadline_time, petition_due and deadline_basis
 * of each given election from its filing tracks. Returns the rows updated. An empty list sends no
 * statement. L-headline-deadline (D-330); nothing else writes these five columns.
 *
 * - The deadline is the earliest `closes_on` of the election's tracks.
 * - Its time is the earliest known `closes_time` among the tracks that close that day (`min`
 *   ignores nulls), and null when none is sourced, so no hour is invented.
 * - `filing_opens` is the earliest `opens_on` of the tracks that close on the headline date, or of
 *   any track when none has a closing date, so the pair describes one real window.
 * - `petition_due` is the earliest of any track.
 * - `deadline_basis` is `both` when a headline track is `both`, else `scraped` when one is
 *   `scraped`, else `computed`; null when there is no headline date.
 */
export async function recomputeHeadlineDeadlines(
  tx: Db | Tx,
  electionIds: readonly string[],
): Promise<number> {
  if (electionIds.length === 0) {
    return 0;
  }
  const updated = await tx.execute<{ id: string }>(
    sql`update elections e
        set filing_opens = h.opens,
            filing_deadline = h.deadline,
            filing_deadline_time = h.deadline_time,
            petition_due = h.petition_due,
            deadline_basis = h.basis
        from (
          select e2.id,
            (select min(t.opens_on) from filing_tracks t
              where t.election_id = e2.id
                and (d.deadline is null or t.closes_on = d.deadline)) as opens,
            d.deadline,
            (select min(t.closes_time) from filing_tracks t
              where t.election_id = e2.id and t.closes_on = d.deadline) as deadline_time,
            (select min(t.petition_due) from filing_tracks t where t.election_id = e2.id) as petition_due,
            (select case when bool_or(t.basis = 'both') then 'both'
                         when bool_or(t.basis = 'scraped') then 'scraped'
                         when count(*) > 0 then 'computed' end
               from filing_tracks t
              where t.election_id = e2.id and t.closes_on = d.deadline) as basis
          from elections e2
          cross join lateral (
            select min(t.closes_on) as deadline from filing_tracks t where t.election_id = e2.id) d
          where e2.id = any(${sql.param(electionIds)}::uuid[])
        ) h
        where e.id = h.id
        returning e.id`,
    'objects',
  );
  return updated.length;
}
