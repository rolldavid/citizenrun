import type { Db, Tx } from '@citizenrun/db';
import type { PersonSummary } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { toPersonPhoto } from '../../lib/media.ts';
import type { CivicReadContext } from './loaders.ts';

// L-person-resolve
export const MAX_MERGE_HOPS = 5;

type PersonDbRow = {
  id: string;
  slug: string;
  name: string;
  party: string | null;
  photoKey: string | null;
  photoWidth: number | null;
  photoHeight: number | null;
  photoCredit: string | null;
  claimedBy: string | null;
  rosterOnly: boolean;
  retiredAt: string | null;
  mergedInto: string | null;
};

// A walk from a requested id: the survivor, a row still to read, or a chain that cannot resolve.
type Walk =
  | { kind: 'resolved'; row: PersonDbRow }
  | { kind: 'missing'; id: string }
  | { kind: 'unresolvable' };

async function readPeople(db: Db | Tx, ids: readonly string[]): Promise<PersonDbRow[]> {
  // index: people_pkey
  return db.execute<PersonDbRow>(
    sql`select id, slug, name, party,
               photo_key as "photoKey", photo_width as "photoWidth", photo_height as "photoHeight",
               photo_credit as "photoCredit", claimed_by as "claimedBy", roster_only as "rosterOnly",
               to_char(retired_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "retiredAt",
               merged_into as "mergedInto"
        from people
        where id = any(${sql.param(ids)}::uuid[])`,
    'objects',
  );
}

// Follows merged_into from `id` through the rows read so far, at most MAX_MERGE_HOPS hops; a cycle
// or a longer chain cannot resolve.
function walk(id: string, read: ReadonlyMap<string, PersonDbRow | null>): Walk {
  const seen = new Set<string>();
  let current = id;
  for (let hops = 0; ; hops += 1) {
    if (!read.has(current)) {
      return { kind: 'missing', id: current };
    }
    const row = read.get(current) ?? null;
    if (row === null) {
      return { kind: 'unresolvable' };
    }
    if (row.mergedInto === null) {
      return { kind: 'resolved', row };
    }
    seen.add(current);
    if (hops === MAX_MERGE_HOPS || seen.has(row.mergedInto)) {
      return { kind: 'unresolvable' };
    }
    current = row.mergedInto;
  }
}

/** PersonSummary of each id (merged people resolved to the survivor, at most five hops; a longer chain or a cycle is left out); roster-only people only when asked. Keyed by the requested id. */
export async function personSummaryRows(
  db: Db | Tx,
  input: {
    ids: readonly string[];
    viewerId: string | null;
    includeRosterOnly: boolean;
    now: Date;
    ctx: CivicReadContext;
  },
): Promise<Map<string, PersonSummary>> {
  const requested = [...new Set(input.ids)];
  const result = new Map<string, PersonSummary>();
  if (requested.length === 0) {
    return result;
  }
  // A row read as absent is kept as null, so it is never read twice.
  const read = new Map<string, PersonDbRow | null>();
  let toRead = requested;
  // Round 1, then one round per hop: no merge costs one statement.
  for (let round = 0; round <= MAX_MERGE_HOPS && toRead.length > 0; round += 1) {
    const rows = await readPeople(db, toRead);
    for (const id of toRead) {
      read.set(id, null);
    }
    for (const row of rows) {
      read.set(row.id, row);
    }
    const missing = new Set<string>();
    for (const id of requested) {
      const step = walk(id, read);
      if (step.kind === 'missing') {
        missing.add(step.id);
      }
    }
    toRead = [...missing];
  }

  const survivors = new Map<string, PersonDbRow>();
  for (const id of requested) {
    const step = walk(id, read);
    if (step.kind !== 'resolved') {
      continue;
    }
    if (step.row.rosterOnly && !input.includeRosterOnly) {
      continue;
    }
    survivors.set(id, step.row);
  }
  if (survivors.size === 0) {
    return result;
  }

  const following = await viewerFollows(db, input.viewerId, [...survivors.values()]);
  for (const [id, row] of survivors) {
    result.set(id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      party: row.party,
      photo: await toPersonPhoto(row, input.ctx.media, input.now),
      photoCredit: row.photoCredit,
      claimed: row.claimedBy !== null,
      rosterOnly: row.rosterOnly,
      retiredAt: row.retiredAt,
      viewer: {
        following:
          following.has(`person:${row.id}`) ||
          (row.claimedBy !== null && following.has(`user:${row.claimedBy}`)),
      },
    });
  }
  return result;
}

// The viewer's follows of these people and of the users who claimed them, as `<type>:<id>`.
async function viewerFollows(
  db: Db | Tx,
  viewerId: string | null,
  people: readonly PersonDbRow[],
): Promise<Set<string>> {
  if (viewerId === null) {
    return new Set();
  }
  const personIds = [...new Set(people.map((row) => row.id))];
  const claimedBy = [
    ...new Set(people.flatMap((row) => (row.claimedBy === null ? [] : [row.claimedBy]))),
  ];
  // index: follows_pkey
  const rows = await db.execute<{ targetType: string; targetId: string }>(
    sql`select target_type as "targetType", target_id as "targetId"
        from follows
        where follower_id = ${viewerId}::uuid
          and ((target_type = 'person' and target_id = any(${sql.param(personIds)}::uuid[]))
            or (target_type = 'user' and target_id = any(${sql.param(claimedBy)}::uuid[])))`,
    'objects',
  );
  return new Set(rows.map((row) => `${row.targetType}:${row.targetId}`));
}
