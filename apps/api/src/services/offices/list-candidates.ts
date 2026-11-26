import type { Db, Tx } from '@citizenrun/db';
import { ApiError, IsoDateSchema, localDateTimeIn } from '@citizenrun/shared';
import type { CandidacyView, Page } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps.ts';
import { decodeCursor, encodeCursor } from '../../lib/cursor.ts';
import { civicReadContextOf, loadCandidacyViews } from '../civic/loaders.ts';
import { resolveOfficeById } from './resolve-office.ts';

// E-OFF-02: an office's candidacies, by election date, status, name and id (PB-32). People on a
// board roster only never appear (D-316).

/** The order of candidacy statuses within an election (PB-32). */
export const CANDIDACY_STATUS_ORDER = [
  'on_ballot',
  'qualified',
  'advanced',
  'filed',
  'committee_registered',
  'won',
  'lost',
  'withdrawn',
  'disqualified',
] as const; // PB-32

/** The cursor of E-OFF-02: the last row's election date, status rank and name, and its id (L-cursor). */
export const CandidacyCursorSchema = z.object({
  s: z.tuple([IsoDateSchema, z.number().int().min(1), z.string()]),
  i: z.uuid(),
});

type CandidacyKey = [string, number, string];

type CandidacyIdRow = { id: string; electionDate: string; rank: number; name: string };

/**
 * The ids of an office's candidacies in E-OFF-02's order, at most `limit + 1`: those of
 * `electionId` when given, else those of the office's non-retired elections on or after `today`.
 */
export async function listCandidacyIds(
  db: Db | Tx,
  input: {
    officeId: string;
    electionId: string | null;
    today: string;
    after: { s: CandidacyKey; i: string } | null;
    limit: number;
  },
): Promise<Array<{ id: string; key: CandidacyKey }>> {
  const order = sql`${sql.param([...CANDIDACY_STATUS_ORDER])}::text[]`;
  const which =
    input.electionId === null
      ? sql`e.retired_at is null and e.election_date >= ${input.today}::date`
      : sql`e.id = ${input.electionId}::uuid`;
  const after =
    input.after === null
      ? sql``
      : sql`and (e.election_date, array_position(${order}, c.status), p.name, c.id)
              > (${input.after.s[0]}::date, ${input.after.s[1]}::int, ${input.after.s[2]}::text,
                 ${input.after.i}::uuid)`;
  // index: elections_contest_key, candidacies_election
  const rows = await db.execute<CandidacyIdRow>(
    sql`select c.id,
               e.election_date::text as "electionDate",
               array_position(${order}, c.status) as rank,
               p.name
        from candidacies c
        join elections e on e.id = c.election_id
        join people p on p.id = c.person_id
        where e.office_id = ${input.officeId}::uuid
          and ${which}
          and not p.roster_only
          ${after}
        order by e.election_date, array_position(${order}, c.status), p.name, c.id
        limit ${input.limit + 1}`,
    'objects',
  );
  return rows.map((row) => ({ id: row.id, key: [row.electionDate, row.rank, row.name] }));
}

/** The number of candidacies listCandidacyIds would list for the office's upcoming elections. */
export async function countUpcomingCandidacies(
  db: Db | Tx,
  input: { officeId: string; today: string },
): Promise<number> {
  // index: elections_contest_key, candidacies_election
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n
        from candidacies c
        join elections e on e.id = c.election_id
        join people p on p.id = c.person_id
        where e.office_id = ${input.officeId}::uuid
          and e.retired_at is null
          and e.election_date >= ${input.today}::date
          and not p.roster_only`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

async function isElectionOf(db: Db | Tx, electionId: string, officeId: string): Promise<boolean> {
  // index: elections_pkey
  const rows = await db.execute<{ found: number }>(
    sql`select 1 as found from elections
        where id = ${electionId}::uuid and office_id = ${officeId}::uuid`,
    'objects',
  );
  return rows.length > 0;
}

/** E-OFF-02: one page of an office's candidacies with the viewer's flags. */
export async function listOfficeCandidates(
  deps: Deps,
  input: {
    officeId: string;
    electionId: string | null;
    cursor: string | null;
    limit: number;
    viewerId: string | null;
    now: Date;
  },
): Promise<Page<CandidacyView>> {
  const after = input.cursor === null ? null : decodeCursor(CandidacyCursorSchema, input.cursor);
  const office = await resolveOfficeById(deps.db, input.officeId);
  if (office === null) {
    throw new ApiError('not_found');
  }
  if (input.electionId !== null && !(await isElectionOf(deps.db, input.electionId, office.id))) {
    throw new ApiError('not_found');
  }
  const rows = await listCandidacyIds(deps.db, {
    officeId: office.id,
    electionId: input.electionId,
    today: localDateTimeIn(office.timezone, input.now).date,
    after,
    limit: input.limit,
  });
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > input.limit && last !== undefined
      ? encodeCursor(CandidacyCursorSchema, { s: last.key, i: last.id })
      : null;
  const views = await loadCandidacyViews(deps.db, {
    ids: page.map((row) => row.id),
    viewerId: input.viewerId,
    now: input.now,
    ctx: civicReadContextOf(deps),
  });
  const items = page.flatMap((row) => {
    const view = views.get(row.id);
    return view === undefined ? [] : [view];
  });
  return { items, nextCursor };
}
