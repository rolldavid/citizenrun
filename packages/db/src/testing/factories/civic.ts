import { civicId } from '@citizenrun/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../client.ts';
import {
  elections,
  filingTracks,
  officeIssues,
  officePowers,
  offices,
} from '../../schema/civic.ts';
import type {
  ElectionRow,
  FilingTrackRow,
  NewElectionRow,
  NewFilingTrackRow,
  NewOfficePowerRow,
  NewOfficeRow,
  OfficeIssueRow,
  OfficePowerRow,
  OfficeRow,
} from '../../schema/civic.ts';
import { districts, jurisdictions } from '../../schema/geo.ts';
import { officeTypes, powers } from '../../schema/reference.ts';
import { recomputeHeadlineDeadlines } from '../../sql/headline-deadline.ts';
import { nextSequence } from '../sequence.ts';
import { DAY_MS, defaultFactoryContext, shiftMs } from './context.ts';
import type { FactoryContext } from './context.ts';
import { fixtureSourceKey, insertDistrict, insertJurisdiction } from './geo.ts';

// The office and election factories (TEST-harness-factories, milestone 2). Every fact stays null
// unless the test sets it (00 section 4.5).

/** The UTC calendar date `days` days after `at`, as `YYYY-MM-DD`. */
function utcDatePlus(at: Date, days: number): string {
  return shiftMs(at, days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * An office titled `Fixture Office <seq>`, slug `fixture-office-<seq>`, keyed
 * `fixture:offices:<seq>`, not a placeholder, one seat, every fact null. The office type and the
 * parents are the test's to give; insertOffice reads the first office type by id and creates the
 * parents it lacks.
 */
export function makeOffice(
  overrides: Partial<NewOfficeRow> &
    Pick<NewOfficeRow, 'officeTypeId' | 'jurisdictionId' | 'districtId' | 'state'>,
): NewOfficeRow {
  const seq = nextSequence();
  const sourceKey = overrides.sourceKey ?? fixtureSourceKey('offices', seq);
  return {
    title: `Fixture Office ${String(seq)}`,
    slug: `fixture-office-${String(seq)}`,
    placeholder: false,
    seats: 1,
    ...overrides,
    id: overrides.id ?? civicId('offices', sourceKey),
    sourceKey,
  };
}

/**
 * Writes an office in one transaction. Without a `jurisdictionId` it inserts a jurisdiction, and
 * without a `districtId` a district of that jurisdiction; `state` is the jurisdiction's and the
 * office type is the first `office_types` row by id, unless given.
 */
export async function insertOffice(
  db: Db | Tx,
  overrides: Partial<NewOfficeRow> = {},
): Promise<OfficeRow> {
  return db.transaction(async (tx) => {
    let jurisdictionId = overrides.jurisdictionId;
    let districtId = overrides.districtId;
    if (jurisdictionId === undefined && districtId !== undefined) {
      const [district] = await tx
        .select({ jurisdictionId: districts.jurisdictionId })
        .from(districts)
        .where(eq(districts.id, districtId));
      jurisdictionId = district?.jurisdictionId;
    }
    jurisdictionId ??= (await insertJurisdiction(tx)).id;
    districtId ??= (await insertDistrict(tx, { jurisdictionId })).id;
    let state = overrides.state;
    if (state === undefined) {
      const [jurisdiction] = await tx
        .select({ state: jurisdictions.state })
        .from(jurisdictions)
        .where(eq(jurisdictions.id, jurisdictionId));
      state = jurisdiction?.state;
    }
    let officeTypeId = overrides.officeTypeId;
    if (officeTypeId === undefined) {
      const [first] = await tx
        .select({ id: officeTypes.id })
        .from(officeTypes)
        .orderBy(asc(officeTypes.id))
        .limit(1);
      officeTypeId = first?.id;
    }
    if (state === undefined || officeTypeId === undefined) {
      throw new Error('The office factory found no jurisdiction state or office type.');
    }
    const [row] = await tx
      .insert(offices)
      .values(makeOffice({ ...overrides, jurisdictionId, districtId, state, officeTypeId }))
      .returning();
    if (row === undefined) {
      throw new Error('The offices insert returned no row.');
    }
    return row;
  });
}

/** A power of an office at relevance 1 and `low` confidence, with no quote, source or check. */
export function makeOfficePower(
  overrides: Partial<NewOfficePowerRow> & Pick<NewOfficePowerRow, 'officeId' | 'powerId'>,
): NewOfficePowerRow {
  return {
    relevance: 1,
    confidence: 'low',
    quote: null,
    sourceUrl: null,
    checkedAt: null,
    ...overrides,
  };
}

/**
 * Writes makeOfficePower; without an `officeId` it inserts an office, and the power is the first
 * `powers` row by id unless given.
 */
export async function insertOfficePower(
  db: Db | Tx,
  overrides: Partial<NewOfficePowerRow> = {},
): Promise<OfficePowerRow> {
  return db.transaction(async (tx) => {
    const officeId = overrides.officeId ?? (await insertOffice(tx)).id;
    let powerId = overrides.powerId;
    if (powerId === undefined) {
      const [first] = await tx
        .select({ id: powers.id })
        .from(powers)
        .orderBy(asc(powers.id))
        .limit(1);
      powerId = first?.id;
    }
    if (powerId === undefined) {
      throw new Error('The office power factory found no power.');
    }
    const [row] = await tx
      .insert(officePowers)
      .values(makeOfficePower({ ...overrides, officeId, powerId }))
      .returning();
    if (row === undefined) {
      throw new Error('The office_powers insert returned no row.');
    }
    return row;
  });
}

/** One issue relevance of setOfficeIssues. */
export type OfficeIssuePick = { issueId: string; relevance: 1 | 2 | 3 };

/** Replaces the office's `office_issues` rows with `rows` in one transaction; returns them. */
export async function setOfficeIssues(
  db: Db | Tx,
  officeId: string,
  rows: readonly OfficeIssuePick[],
): Promise<OfficeIssueRow[]> {
  return db.transaction(async (tx) => {
    await tx.delete(officeIssues).where(eq(officeIssues.officeId, officeId));
    if (rows.length === 0) {
      return [];
    }
    return tx
      .insert(officeIssues)
      .values(rows.map((row) => ({ officeId, issueId: row.issueId, relevance: row.relevance })))
      .returning();
  });
}

/**
 * A nonpartisan general election 120 days after `ctx.now` (its UTC date), keyed
 * `fixture:elections:<seq>`, turnout class `standalone_local`, the five headline columns null.
 * Without an `officeId` the row names the civic id of a fixture key; insertElection then creates
 * an office.
 */
export function makeElection(
  overrides: Partial<NewElectionRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): NewElectionRow {
  const seq = nextSequence();
  const sourceKey = overrides.sourceKey ?? fixtureSourceKey('elections', seq);
  return {
    officeId: civicId('offices', fixtureSourceKey('offices', seq)),
    kind: 'general',
    party: null,
    electionDate: utcDatePlus(ctx.now, 120),
    turnoutClass: 'standalone_local',
    filingOpens: null,
    filingDeadline: null,
    filingDeadlineTime: null,
    petitionDue: null,
    deadlineBasis: null,
    ...overrides,
    id: overrides.id ?? civicId('elections', sourceKey),
    sourceKey,
  };
}

/** Writes makeElection, creating its office when none is given; returns the stored row. */
export async function insertElection(
  db: Db | Tx,
  overrides: Partial<NewElectionRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<ElectionRow> {
  return db.transaction(async (tx) => {
    const officeId = overrides.officeId ?? (await insertOffice(tx)).id;
    const [row] = await tx
      .insert(elections)
      .values(makeElection({ ...overrides, officeId }, ctx))
      .returning();
    if (row === undefined) {
      throw new Error('The elections insert returned no row.');
    }
    return row;
  });
}

/** The overrides of the FilingTrack factory: any column, and the election's key for the default key. */
export type FilingTrackOverrides = Partial<NewFilingTrackRow> & { electionSourceKey?: string };

/**
 * A `nonpartisan`, `computed` track opening 60 and closing 74 days after `ctx.now` (UTC dates),
 * no closing time, a fixture source and quote at `medium` confidence, checked at `ctx.now`; every
 * other fact null. Its key is `<election source key>|<track>` when the election's key is
 * given, else `fixture:filing_tracks:<seq>`.
 */
export function makeFilingTrack(
  overrides: FilingTrackOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): NewFilingTrackRow {
  const { electionSourceKey, ...columns } = overrides;
  const seq = nextSequence();
  const track = columns.track ?? 'nonpartisan';
  const sourceKey =
    columns.sourceKey ??
    (electionSourceKey === undefined
      ? fixtureSourceKey('filing_tracks', seq)
      : `${electionSourceKey}|${track}`);
  return {
    electionId: civicId('elections', fixtureSourceKey('elections', seq)),
    opensOn: utcDatePlus(ctx.now, 60),
    closesOn: utcDatePlus(ctx.now, 74),
    closesTime: null,
    petitionOpens: null,
    petitionDue: null,
    feeCents: null,
    signatures: null,
    whereToFile: null,
    ruleCitation: null,
    basis: 'computed',
    sourceUrl: 'https://example.test/fixture-source',
    quote: 'Fixture quote.',
    confidence: 'medium',
    checkedAt: ctx.now,
    ...columns,
    track,
    id: columns.id ?? civicId('filing_tracks', sourceKey),
    sourceKey,
  };
}

/**
 * Writes makeFilingTrack in one transaction, creating its election when none is given, then
 * recomputes that election's headline deadline with L-headline-deadline in the same transaction
 * (TEST-harness-factories rule 5). A track that makes the headline invalid rolls back whole.
 */
export async function insertFilingTrack(
  db: Db | Tx,
  overrides: FilingTrackOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<FilingTrackRow> {
  return db.transaction(async (tx) => {
    let electionId = overrides.electionId;
    let electionSourceKey = overrides.electionSourceKey;
    if (electionId === undefined) {
      const election = await insertElection(tx, {}, ctx);
      electionId = election.id;
      electionSourceKey ??= election.sourceKey;
    } else if (electionSourceKey === undefined) {
      const [election] = await tx
        .select({ sourceKey: elections.sourceKey })
        .from(elections)
        .where(eq(elections.id, electionId));
      electionSourceKey = election?.sourceKey;
    }
    const [row] = await tx
      .insert(filingTracks)
      .values(
        makeFilingTrack(
          {
            ...overrides,
            electionId,
            ...(electionSourceKey === undefined ? {} : { electionSourceKey }),
          },
          ctx,
        ),
      )
      .returning();
    if (row === undefined) {
      throw new Error('The filing_tracks insert returned no row.');
    }
    await recomputeHeadlineDeadlines(tx, [electionId]);
    return row;
  });
}
