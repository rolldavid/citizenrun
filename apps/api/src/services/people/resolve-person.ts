import type { Db, Tx } from '@citizenrun/db';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { MAX_MERGE_HOPS } from '../civic/person-summary.ts';

// L-person-resolve.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The slug rule of people_slug_check.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 120;

type ResolveRow = { id: string; mergedInto: string | null; rosterOnly: boolean };

async function readPerson(db: Db | Tx, where: SQL): Promise<ResolveRow | null> {
  const rows = await db.execute<ResolveRow>(
    sql`select id, merged_into as "mergedInto", roster_only as "rosterOnly"
        from people
        where ${where}`,
    'objects',
  );
  return rows[0] ?? null;
}

function readById(db: Db | Tx, id: string): Promise<ResolveRow | null> {
  // index: people_pkey
  return readPerson(db, sql`id = ${id}::uuid`);
}

/** The surviving person for an id or slug (rules 1 to 3): null when the value matches neither pattern, nothing is found, the merge chain is longer than five or loops, or the person is roster-only. */
export async function resolvePerson(db: Db | Tx, idOrSlug: string): Promise<{ id: string } | null> {
  let row: ResolveRow | null;
  if (UUID_PATTERN.test(idOrSlug)) {
    row = await readById(db, idOrSlug.toLowerCase());
  } else if (idOrSlug.length <= SLUG_MAX && SLUG_PATTERN.test(idOrSlug)) {
    // index: people_slug_key
    row = await readPerson(db, sql`slug = ${idOrSlug}`);
  } else {
    return null;
  }
  const seen = new Set<string>();
  for (let hops = 0; row !== null && row.mergedInto !== null; hops += 1) {
    // R-045: at most five hops; a sixth, or a person already visited, does not resolve.
    seen.add(row.id);
    if (hops === MAX_MERGE_HOPS || seen.has(row.mergedInto)) {
      return null;
    }
    row = await readById(db, row.mergedInto);
  }
  // D-316: a director on a board roster only has no profile.
  if (row === null || row.rosterOnly) {
    return null;
  }
  return { id: row.id };
}

/** The state whose candidate-tools flag applies to a person (L-person-resolve rule 4), or null. */
export async function toolsStateOf(db: Db | Tx, personId: string): Promise<string | null> {
  // PB-13: the latest candidacy's office, else a current seat's, first by `since`.
  // index: candidacies_person_election_key (person prefix), elections_pkey, offices_pkey
  // index: officeholders_person
  const rows = await db.execute<{ state: string | null }>(
    sql`select coalesce(
              (select o.state::text
               from candidacies c
               join elections e on e.id = c.election_id
               join offices o on o.id = e.office_id
               where c.person_id = ${personId}::uuid
               order by e.election_date desc, c.id
               limit 1),
              (select o.state::text
               from officeholders oh
               join offices o on o.id = oh.office_id
               where oh.person_id = ${personId}::uuid and oh.until is null
               order by oh.since nulls last, oh.id
               limit 1)) as state`,
    'objects',
  );
  return rows[0]?.state ?? null;
}
