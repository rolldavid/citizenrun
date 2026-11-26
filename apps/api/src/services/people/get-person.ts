import type { Db } from '@citizenrun/db';
import type { CandidacyView, PersonDetail } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { civicReadContextOf, loadCandidacyViews } from '../civic/loaders.ts';
import type { CivicReadContext } from '../civic/loaders.ts';
import { personSummaryRows } from '../civic/person-summary.ts';
import { resolvePerson } from './resolve-person.ts';

// E-PPL-01: the person page of an officeholder or candidate. The claim, link and
// help keys arrive with claims and have their empty forms until then (D-798). Nothing is written.

type DetailRow = {
  photoLicense: string | null;
  photoSourceUrl: string | null;
  origin: string | null;
  website: string | null;
  followerCount: number;
};

type SeatRow = {
  seatLabel: string | null;
  since: string | null;
  until: string | null;
  id: string;
  slug: string;
  title: string;
  state: string;
  jurisdictionName: string;
  retiredAt: string | null;
};

const ORIGINS = ['bundle', 'filing', 'admin'] as const;

function originOf(stored: string | null): PersonDetail['origin'] {
  return ORIGINS.find((origin) => origin === stored) ?? null;
}

/** The page's own columns and the follower count (a follower of the person and of its claimed user counts once). */
async function readDetail(db: Db, personId: string): Promise<DetailRow | null> {
  // index: people_pkey, follows_target
  const rows = await db.execute<DetailRow>(
    sql`select p.photo_license as "photoLicense",
               p.photo_source_url as "photoSourceUrl",
               p.origin ->> 'created_by' as origin,
               p.website,
               (select count(distinct f.follower_id)::int
                from follows f
                where (f.target_type = 'person' and f.target_id = p.id)
                   or (p.claimed_by is not null and f.target_type = 'user'
                       and f.target_id = p.claimed_by)) as "followerCount"
        from people p
        where p.id = ${personId}::uuid`,
    'objects',
  );
  return rows[0] ?? null;
}

/** The person's seats, current first, then by end date. */
async function readSeats(db: Db, personId: string): Promise<PersonDetail['seats']> {
  // index: officeholders_person, offices_pkey, jurisdictions_pkey
  const rows = await db.execute<SeatRow>(
    sql`select oh.seat_label as "seatLabel",
               oh.since::text as since,
               oh.until::text as until,
               o.id,
               o.slug,
               o.title,
               o.state::text as state,
               j.name as "jurisdictionName",
               to_char(o.retired_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "retiredAt"
        from officeholders oh
        join offices o on o.id = oh.office_id
        join jurisdictions j on j.id = o.jurisdiction_id
        where oh.person_id = ${personId}::uuid
        order by (oh.until is not null), oh.until desc, oh.id`,
    'objects',
  );
  return rows.map((row) => ({
    office: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      state: row.state,
      jurisdictionName: row.jurisdictionName,
      retiredAt: row.retiredAt,
    },
    seatLabel: row.seatLabel,
    since: row.since,
    until: row.until,
    current: row.until === null,
  }));
}

/** Every candidacy of the person, newest election first. */
async function readCandidacies(
  db: Db,
  input: { personId: string; viewerId: string | null; now: Date; ctx: CivicReadContext },
): Promise<CandidacyView[]> {
  // index: candidacies_person_election_key (person prefix), elections_pkey
  const rows = await db.execute<{ id: string }>(
    sql`select c.id
        from candidacies c
        join elections e on e.id = c.election_id
        where c.person_id = ${input.personId}::uuid
        order by e.election_date desc, c.id`,
    'objects',
  );
  const views = await loadCandidacyViews(db, {
    ids: rows.map((row) => row.id),
    viewerId: input.viewerId,
    now: input.now,
    ctx: input.ctx,
  });
  return rows.flatMap((row) => {
    const view = views.get(row.id);
    return view === undefined ? [] : [view];
  });
}

/** PersonDetail for a viewer (null when logged out); null when the person does not resolve. Also called by the public person page (D-165). */
export async function loadPersonDetail(
  deps: Deps,
  input: { idOrSlug: string; viewerId: string | null; now: Date },
): Promise<PersonDetail | null> {
  const { db } = deps;
  const { viewerId, now } = input;
  const person = await resolvePerson(db, input.idOrSlug);
  if (person === null) {
    return null;
  }
  const ctx = civicReadContextOf(deps);
  const summaries = await personSummaryRows(db, {
    ids: [person.id],
    viewerId,
    includeRosterOnly: false,
    now,
    ctx,
  });
  const summary = summaries.get(person.id);
  if (summary === undefined) {
    return null;
  }
  const [detail, seats, candidacies] = await Promise.all([
    readDetail(db, summary.id),
    readSeats(db, summary.id),
    readCandidacies(db, { personId: summary.id, viewerId, now, ctx }),
  ]);
  if (detail === null) {
    return null;
  }
  return {
    ...summary,
    photoLicense: detail.photoLicense,
    photoSourceUrl: detail.photoSourceUrl,
    photoSource: null,
    origin: originOf(detail.origin),
    website: detail.website,
    donateUrl: null,
    volunteerUrl: null,
    pendingLinks: null,
    seats,
    candidacies,
    claimedBy: null,
    followerCount: detail.followerCount,
    tools: { claims: false, links: false, help: false },
    help: null,
    viewer: {
      following: summary.viewer.following,
      isOwner: false,
      claimStatus: null,
      photoPending: false,
      pendingClaim: null,
    },
  };
}
