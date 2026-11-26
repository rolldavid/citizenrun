import {
  SET_PATH_MAX,
  countSetCandidates,
  officeListRankedPage,
  officeListSetPage,
} from '@citizenrun/db';
import type {
  Db,
  OfficeListAfter,
  OfficeListFilters,
  OfficeListRow,
  OfficeListSet,
} from '@citizenrun/db';
import { ApiError, daysUntil, localDateTimeIn } from '@citizenrun/shared';
import type { OfficeListPage, OfficeListQuery, OfficeSummary } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { flagsOf } from '../../deps.ts';
import type { Deps } from '../../deps.ts';
import type { Viewer } from '../../middleware/session.ts';
import { civicReadContextOf, loadOfficeSummaries } from '../civic/loaders.ts';
import { officeListCursorOf, readOfficeListCursor } from './office-list-cursor.ts';

// E-EXP-01 with L-office-list: the set path for a district, a jurisdiction or the
// viewer's own districts, the ranked path for a state or the nation. Nothing is written, and the
// query string is never logged.

// The zone whose date is the earliest anywhere: every deadline still open is on or after it.
const PREFILTER_ZONE = 'Pacific/Pago_Pago';

type Scope = 'mine' | 'state' | 'nation';

async function hasDistricts(db: Db, userId: string): Promise<boolean> {
  // index: user_districts_pkey
  const rows = await db.execute<{ found: boolean }>(
    sql`select exists (select 1 from user_districts where user_id = ${userId}::uuid) as found`,
    'objects',
  );
  return rows[0]?.found === true;
}

/** The state of most of the viewer's districts, ties by code; null with no districts. */
async function viewerState(db: Db, userId: string): Promise<string | null> {
  // index: user_districts_pkey, districts_pkey, jurisdictions_pkey
  const rows = await db.execute<{ state: string }>(
    sql`select j.state::text as state
        from user_districts ud
        join districts d on d.id = ud.district_id
        join jurisdictions j on j.id = d.jurisdiction_id
        where ud.user_id = ${userId}::uuid
        group by j.state
        order by count(*) desc, j.state
        limit 1`,
    'objects',
  );
  return rows[0]?.state ?? null;
}

async function everyState(db: Db): Promise<string[]> {
  // index: state_rules_pkey
  const rows = await db.execute<{ state: string }>(
    sql`select state::text as state from state_rules order by state`,
    'objects',
  );
  return rows.map((row) => row.state);
}

/** The scope of 5.1: as given; else `state` with a state; else `mine` with districts and no area; else `nation`. */
async function resolveScope(db: Db, userId: string, query: OfficeListQuery): Promise<Scope> {
  if (query.scope !== undefined) {
    return query.scope;
  }
  if (query.state !== undefined) {
    return 'state';
  }
  if (query.district === undefined && query.jurisdiction === undefined) {
    if (await hasDistricts(db, userId)) {
      return 'mine';
    }
  }
  return 'nation';
}

function filtersOf(query: OfficeListQuery): OfficeListFilters {
  return {
    issueIds: query.issue ?? null,
    levels: query.level ?? null,
    officeTypeIds: query.officeType ?? null,
    jurisdictionKinds: query.jurisdictionKind ?? null,
    minPayCents: query.minPay ?? null,
    fitsDayJob: query.fitsDayJob === true,
    maxHours: query.maxHours ?? null,
    deadlineWithinDays: query.deadlineWithin ?? null,
    q: query.q ?? null,
  };
}

/** Whether the row's deadline is within `days` days in its own zone, today included (L-days-until). */
function withinDays(row: OfficeListRow, days: number, now: Date): boolean {
  if (row.nextFilingDeadline === null) {
    return false;
  }
  const left = daysUntil(row.nextFilingDeadline, row.timezone, now);
  return left >= 0 && left <= days;
}

/** E-EXP-01: one page of the office list for a signed-in viewer. */
export async function listOffices(
  deps: Deps,
  input: { viewer: Viewer; query: OfficeListQuery; now: Date },
): Promise<OfficeListPage> {
  const { db } = deps;
  const { viewer, query, now } = input;
  const cursor = query.cursor === undefined ? null : readOfficeListCursor(query.cursor, query.sort);
  if (query.state !== undefined && (await flagsOf(deps).stateRule(query.state)) === null) {
    throw new ApiError('invalid_request', { fields: { state: 'invalid_value' } });
  }
  const scope = await resolveScope(db, viewer.userId, query);
  let state = query.state ?? null;
  if (scope === 'state' && state === null) {
    state = await viewerState(db, viewer.userId);
    if (state === null) {
      throw new ApiError('invalid_request', { fields: { state: 'required' } });
    }
  }

  const todayPagoPago = localDateTimeIn(PREFILTER_ZONE, now).date;
  const filters = filtersOf(query);
  const deadlineWithin = query.deadlineWithin ?? null;
  const setPath =
    query.district !== undefined || query.jurisdiction !== undefined || scope === 'mine';

  let fetchPage: (after: OfficeListAfter, withTotal: boolean) => Promise<OfficeListRow[]>;
  let countable = false;
  if (setPath) {
    const set: OfficeListSet = {
      mineUserId: scope === 'mine' ? viewer.userId : null,
      districtId: query.district ?? null,
      includeContained: query.includeContained,
      jurisdictionId: query.jurisdiction ?? null,
      state: scope === 'state' ? state : null,
    };
    // PB-43: a seat still to be named appears in its district's and jurisdiction's sheets.
    const keepPlaceholders = set.districtId !== null || set.jurisdictionId !== null;
    if ((await countSetCandidates(db, { set, keepPlaceholders })) > SET_PATH_MAX) {
      throw new ApiError('area_too_large');
    }
    countable = true;
    fetchPage = (after, withTotal) =>
      officeListSetPage(db, {
        set,
        keepPlaceholders,
        filters,
        sort: query.sort,
        todayPagoPago,
        after,
        limit: query.limit,
        withTotal,
      });
  } else {
    const states = scope === 'state' && state !== null ? [state] : await everyState(db);
    fetchPage = (after) =>
      officeListRankedPage(db, {
        states,
        filters,
        sort: query.sort,
        todayPagoPago,
        after,
        limit: query.limit,
      });
  }

  const withTotal = countable && cursor === null && deadlineWithin === null;
  const wanted = query.limit + 1;
  const kept: OfficeListRow[] = [];
  let after: OfficeListAfter = cursor === null ? null : { k: cursor.k, id: cursor.id, p: cursor.p };
  let first: OfficeListRow | undefined;
  for (let round = 0; kept.length < wanted; round += 1) {
    const rows = await fetchPage(after, withTotal && round === 0);
    if (round === 0) {
      first = rows[0];
    }
    for (const row of rows) {
      if (deadlineWithin === null || withinDays(row, deadlineWithin, now)) {
        kept.push(row);
      }
    }
    const last = rows.at(-1);
    // A refill continues after the last fetched row, kept or not, so a dropped row is read once.
    if (rows.length < wanted || last === undefined || deadlineWithin === null) {
      break;
    }
    after = { k: last.k, id: last.id, p: last.p };
  }

  const page = kept.slice(0, query.limit);
  const lastKept = page.at(-1);
  const nextCursor =
    kept.length > query.limit && lastKept !== undefined
      ? officeListCursorOf(query.sort, lastKept)
      : null;
  const summaries = await loadOfficeSummaries(db, {
    ids: page.map((row) => row.id),
    viewerId: viewer.userId,
    now,
    ctx: civicReadContextOf(deps),
  });
  const items = page.flatMap((row): OfficeSummary[] => {
    const summary = summaries.get(row.id);
    return summary === undefined ? [] : [summary];
  });
  return { items, nextCursor, total: withTotal ? (first?.total ?? 0) : null };
}
