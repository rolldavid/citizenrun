import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db, Tx } from '../client.ts';
import { LOADER_COLUMNS, nameLiteral, stagedValue } from './columns.ts';
import type { LoaderTable } from './columns.ts';

// The holds (PIPE-loader-hold-revert, P8-54). Evaluated on the staged rows
// against the live tables before anything is written; `today` is a date parameter, never the
// database's own date.

export const FUTURE_DEADLINES_PERCENT = 2; // PIPE-loader-hold-revert
export const FUTURE_DEADLINES_MIN = 10; // PIPE-loader-hold-revert
export const OFFICES_CHANGED_PERCENT = 20; // PIPE-loader-hold-revert

/** The office columns whose change is material (T-offices). */
const MATERIAL_OFFICE_COLUMNS = [
  'title',
  'pay_annual_cents',
  'pay_kind',
  'pay_amount_cents',
  'pay_period',
  'pay_change_note',
  'benefits',
  'hours_per_week',
  'full_time',
  'meeting_times',
  'fits_day_job',
  'filing_fee_cents',
  'signatures_required',
  'where_to_file',
  'eligibility',
  'seats',
  'body_size',
  'seats_up_next',
  'vacant_seats_up_next',
  'term_years',
  'partisan',
  'party_selection',
] as const;

function columnTypeOf(table: LoaderTable, name: string) {
  const found = LOADER_COLUMNS[table].find((column) => column.name === name);
  if (found === undefined) {
    throw new RangeError('No such loader column.');
  }
  return found.type;
}

/**
 * `(<live recorded columns>) is distinct from (<staged values>)` over a table's LOADER_COLUMNS but
 * `source_key` (the join key); a reference column takes its resolved id from `refs`, and
 * `retired_at` compares "is retired" with false (a staged row is live).
 */
function recordedDiffers(
  table: LoaderTable,
  live: string,
  staged: string,
  refs: Readonly<Record<string, SQL>>,
): SQL {
  const left: SQL[] = [];
  const right: SQL[] = [];
  for (const { name, type } of LOADER_COLUMNS[table]) {
    if (name === 'source_key') {
      continue;
    }
    const liveValue = sql`${sql.identifier(live)}.${sql.identifier(name)}`;
    if (name === 'retired_at') {
      left.push(sql`${liveValue} is not null`);
      right.push(sql`false`);
      continue;
    }
    left.push(liveValue);
    right.push(refs[name] ?? stagedValue(staged, name, type));
  }
  return sql`(${sql.join(left, sql`, `)}) is distinct from (${sql.join(right, sql`, `)})`;
}

/** select office_id, state for every live office in the staged file with a material change (T-offices). */
export function materialChangeQuery(bundleId: string): SQL {
  const b = sql`${bundleId}::uuid`;
  const direct = sql.join(
    MATERIAL_OFFICE_COLUMNS.map(
      (name) =>
        sql`case when o.overrides ? ${nameLiteral(name)} then false
                 else o.${sql.identifier(name)} is distinct from ${stagedValue('so', name, columnTypeOf('offices', name))} end`,
    ),
    sql` or `,
  );
  // index: bundle_rows_key; <table>_source_key_key; elections_contest_key; officeholders_office;
  // filing_tracks_track_key
  return sql`with recursive
    so as (select s.source_key, s.data from staging.bundle_rows s
           where s.bundle_id = ${b} and s.file = 'offices'),
    pchain(person_key, cur_id, depth) as (
      select distinct h.data ->> 'person_key', coalesce(p.id, sp.id), 0
      from staging.bundle_rows h
      left join people p on p.source_key = h.data ->> 'person_key'
      left join staging.bundle_rows sp on sp.bundle_id = ${b} and sp.file = 'people'
                                       and sp.source_key = h.data ->> 'person_key'
      where h.bundle_id = ${b} and h.file = 'officeholders'
      union
      select c.person_key, p.merged_into, c.depth + 1
      from pchain c join people p on p.id = c.cur_id
      where p.merged_into is not null and c.depth < 10),
    ptarget as (select distinct on (person_key) person_key, cur_id as person_id
                from pchain order by person_key, depth desc),
    changed_elections as (
      select e.data ->> 'office_key' as office_key
      from staging.bundle_rows e
      left join elections l on l.source_key = e.source_key
      left join offices lo on lo.source_key = e.data ->> 'office_key'
      where e.bundle_id = ${b} and e.file = 'elections'
        and (l.id is null or ${recordedDiffers('elections', 'l', 'e', { office_id: sql`lo.id` })})
      group by 1),
    track_offices as (
      select t.source_key, t.data,
             coalesce(se.data ->> 'office_key', lo.source_key) as office_key
      from staging.bundle_rows t
      left join staging.bundle_rows se on se.bundle_id = ${b} and se.file = 'elections'
                                       and se.source_key = t.data ->> 'election_key'
      left join elections le on le.source_key = t.data ->> 'election_key'
      left join offices lo on lo.id = le.office_id
      where t.bundle_id = ${b} and t.file = 'filing_tracks'),
    changed_tracks as (
      select t.office_key
      from track_offices t
      left join filing_tracks l on l.source_key = t.source_key
      left join elections le on le.source_key = t.data ->> 'election_key'
      where l.id is null or ${recordedDiffers('filing_tracks', 'l', 't', { election_id: sql`le.id` })}
      group by 1),
    removed_tracks as (
      select se.data ->> 'office_key' as office_key
      from staging.bundle_rows se
      join elections le on le.source_key = se.source_key
      join filing_tracks l on l.election_id = le.id
      where se.bundle_id = ${b} and se.file = 'elections'
        and exists (select 1 from staging.bundle_rows x where x.bundle_id = ${b} and x.file = 'filing_tracks')
        and not exists (select 1 from staging.bundle_rows t
                        where t.bundle_id = ${b} and t.file = 'filing_tracks' and t.source_key = l.source_key)
      group by 1),
    changed_holders as (
      select h.data ->> 'office_key' as office_key
      from staging.bundle_rows h
      left join officeholders l on l.source_key = h.source_key
      left join offices lo on lo.source_key = h.data ->> 'office_key'
      left join ptarget pt on pt.person_key = h.data ->> 'person_key'
      where h.bundle_id = ${b} and h.file = 'officeholders'
        and (l.id is null or ${recordedDiffers('officeholders', 'l', 'h', {
          office_id: sql`lo.id`,
          person_id: sql`pt.person_id`,
        })})
      group by 1),
    removed_holders as (
      select so.source_key as office_key
      from so
      join offices lo on lo.source_key = so.source_key
      join officeholders l on l.office_id = lo.id
      where exists (select 1 from staging.bundle_rows x where x.bundle_id = ${b} and x.file = 'officeholders')
        and not exists (select 1 from staging.bundle_rows h
                        where h.bundle_id = ${b} and h.file = 'officeholders' and h.source_key = l.source_key)
      group by 1),
    child_changes as (
      select office_key from changed_elections
      union select office_key from changed_tracks
      union select office_key from removed_tracks
      union select office_key from changed_holders
      union select office_key from removed_holders)
    select o.id as office_id, o.state
    from so
    join offices o on o.source_key = so.source_key
    where o.retired_at is null
      and ((${direct}) or exists (select 1 from child_changes c where c.office_key = so.source_key))`;
}

async function futureDeadlines(
  db: Db | Tx,
  bundleId: string,
  today: string,
): Promise<{ c: number; d: number }> {
  const b = sql`${bundleId}::uuid`;
  const [row] = await db.execute<{ c: number; d: number }>(
    sql`with head as (
          select t.data ->> 'election_key' as election_key, min((t.data ->> 'closes_on')::date) as deadline
          from staging.bundle_rows t where t.bundle_id = ${b} and t.file = 'filing_tracks' group by 1),
        head_time as (
          select h.election_key, min((t.data ->> 'closes_time')::time) as deadline_time
          from head h join staging.bundle_rows t
            on t.bundle_id = ${b} and t.file = 'filing_tracks' and t.data ->> 'election_key' = h.election_key
           and (t.data ->> 'closes_on')::date = h.deadline
          group by 1),
        live as (select e.id, e.source_key, e.filing_deadline, e.filing_deadline_time
                 from elections e where e.retired_at is null and e.filing_deadline >= ${today}::date)   -- index: elections_deadline
        select (select count(*) from live)::int as d,
               (count(*) filter (where (l.filing_deadline, l.filing_deadline_time)
                                   is distinct from (h.deadline, ht.deadline_time)))::int as c
        from live l
        join staging.bundle_rows s on s.bundle_id = ${b} and s.file = 'elections' and s.source_key = l.source_key   -- index: bundle_rows_key
        left join head h on h.election_key = l.source_key
        left join head_time ht on ht.election_key = l.source_key`,
    'objects',
  );
  return { c: row?.c ?? 0, d: row?.d ?? 0 };
}

async function officesChanged(
  db: Db | Tx,
  bundleId: string,
): Promise<{ state: string; c: number; d: number }[]> {
  // index: offices_state_rank (state, live offices)
  return db.execute<{ state: string; c: number; d: number }>(
    sql`with m as (${materialChangeQuery(bundleId)})
        select o.state::text as state,
               (count(*) filter (where exists (select 1 from m where m.office_id = o.id)))::int as c,
               count(*)::int as d
        from offices o
        where o.retired_at is null
        group by o.state
        order by o.state`,
    'objects',
  );
}

/**
 * The holds the staged bundle crosses: `future_deadlines`, then `offices_changed:<ST>` in state
 * order; `detail` gives each crossed hold's `C of D`. `today` is the Pacific/Pago_Pago calendar
 * date of the load.
 */
export async function evaluateHolds(
  db: Db,
  bundleId: string,
  today: string,
): Promise<{ holds: string[]; detail: Record<string, string> }> {
  const holds: string[] = [];
  const detail: Record<string, string> = {};
  const deadlines = await futureDeadlines(db, bundleId, today);
  if (
    deadlines.c * 100 > deadlines.d * FUTURE_DEADLINES_PERCENT &&
    deadlines.c > FUTURE_DEADLINES_MIN
  ) {
    holds.push('future_deadlines');
    detail.future_deadlines = `${String(deadlines.c)} of ${String(deadlines.d)}`;
  }
  for (const { state, c, d } of await officesChanged(db, bundleId)) {
    // A state with no live offices is not counted: a first load of a state never holds.
    if (d > 0 && c * 100 > d * OFFICES_CHANGED_PERCENT) {
      const name = `offices_changed:${state}`;
      holds.push(name);
      detail[name] = `${String(c)} of ${String(d)}`;
    }
  }
  return { holds, detail };
}
