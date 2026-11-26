import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Tx } from '../client.ts';
import { recomputeHeadlineDeadlines } from '../sql/headline-deadline.ts';
import { refreshOfficeSearch } from '../sql/office-search.ts';
import { ID_CHUNK, chunk } from './chunk.ts';
import {
  KEY_COLUMNS,
  LOADER_COLUMNS,
  beforeObject,
  keyMatch,
  loaderColumnNames,
  nameLiteral,
  rowKeyObject,
  stagedValue,
} from './columns.ts';
import type { LoaderTable } from './columns.ts';
import type { PhotoPlacement } from './copy-assets.ts';
import { materialChangeQuery } from './holds.ts';
import type { FullFileR0 } from './tables.ts';

// The upsert of PIPE-loader (P8-53), run in one transaction. Each table's statement
// captures the prior row, upserts and writes its bundle_changes rows in one data-modifying
// statement; a row whose values all equal the live ones is neither written nor recorded, so a
// second load of the same rows writes nothing. Every statement binds the load's `now`, and no
// bucket is touched here.

export type UpsertContext = {
  bundleId: string;
  now: Date;
  files: ReadonlySet<FullFileR0>;
  photos: ReadonlyMap<string, PhotoPlacement>;
};

/** The longest merged_into chain a staged person may follow (T-people). */
const MERGE_CHAIN_MAX = 10;

/** The six people columns an owner or admin override of photo_key keeps together (T-people). */
const PHOTO_COLUMNS = [
  'photo_key',
  'photo_width',
  'photo_height',
  'photo_credit',
  'photo_license',
  'photo_source_url',
] as const;

type Bound = { b: SQL; now: SQL };

const id = (name: string): SQL => sql`${sql.identifier(name)}`;

function list(items: readonly SQL[]): SQL {
  return sql.join([...items], sql`, `);
}

type UpsertSpec = {
  table: LoaderTable;
  /** A select yielding every column of `columns`, each under its own name. */
  source: SQL;
  /** Every inserted column: KEY_COLUMNS first. */
  columns: readonly string[];
  /** The override test (on `t`) that keeps a column's live value; null when the column is always written. */
  kept?: (name: string) => SQL | null;
  /** A SET expression replacing the resolved value of a column. */
  set?: Readonly<Record<string, SQL>>;
  /** Columns left out of the change test. */
  notCompared?: readonly string[];
  /** A further condition under which an unchanged row is still written. */
  orWhere?: SQL;
  /** The whole change test, replacing the default. */
  where?: SQL;
};

/** The upsert of one table with its bundle_changes rows: `insert` (before null) or `update` (the prior LOADER columns). */
function upsertWithChanges(bound: Bound, spec: UpsertSpec): SQL {
  const { table } = spec;
  const keys = KEY_COLUMNS[table];
  const nonKey = spec.columns.filter((name) => !keys.includes(name));
  const resolved = (name: string): SQL => {
    const keep = spec.kept?.(name) ?? null;
    const excluded = sql`excluded.${id(name)}`;
    return keep === null
      ? excluded
      : sql`case when ${keep} then t.${id(name)} else ${excluded} end`;
  };
  const setItems = nonKey.map((name) => sql`${id(name)} = ${spec.set?.[name] ?? resolved(name)}`);
  const compared = nonKey.filter((name) => !(spec.notCompared ?? []).includes(name));
  const changed = sql`(${list(compared.map((name) => sql`t.${id(name)}`))}) is distinct from (${list(compared.map(resolved))})`;
  const where =
    spec.where ?? (spec.orWhere === undefined ? changed : sql`${changed} or ${spec.orWhere}`);
  const columns = list(spec.columns.map(id));
  return sql`with src as (${spec.source}),
    prior as (select t.* from ${id(table)} t join src on ${keyMatch(table, 'src', 't')}),
    up as (
      insert into ${id(table)} as t (${columns})
      select ${columns} from src
      on conflict (${list(keys.map(id))}) do update set ${list(setItems)}
      where ${where}
      returning ${list(keys.map((key) => sql`t.${id(key)}`))}, (t.xmax = 0) as inserted)
    insert into bundle_changes (bundle_id, table_name, row_key, op, before)
    select ${bound.b}, ${nameLiteral(table)}, ${rowKeyObject(table, 'up')},
           case when up.inserted then 'insert' else 'update' end,
           case when up.inserted then null else ${beforeObject(table, 'prior')} end
    from up left join prior on ${keyMatch(table, 'prior', 'up')}`;
}

/** Retires the live rows of a full file that the staged file lacks, one `retire` change each (A4). */
function retireWithChanges(
  bound: Bound,
  table: 'jurisdictions' | 'districts' | 'offices' | 'elections' | 'people',
  extra: SQL = sql``,
): SQL {
  const alsoSet = table === 'offices' ? sql`, updated_at = ${bound.now}` : sql``;
  // index: bundle_rows_key
  return sql`with gone as (
      update ${id(table)} t set retired_at = ${bound.now}${alsoSet}
      where t.retired_at is null
        and not exists (select 1 from staging.bundle_rows s
                        where s.bundle_id = ${bound.b} and s.file = ${nameLiteral(table)}
                          and s.source_key = t.source_key)
        ${extra}
      returning t.id)
    insert into bundle_changes (bundle_id, table_name, row_key, op, before)
    select ${bound.b}, ${nameLiteral(table)}, jsonb_build_object('id', gone.id::text), 'retire',
           jsonb_build_object('retired_at', null)
    from gone`;
}

/** Deletes rows and records each as a `delete` change with its full LOADER columns; `ctes` are further CTEs the delete reads. */
function recordDeleted(
  bound: Bound,
  table: LoaderTable,
  alias: string,
  deleting: SQL,
  ctes: SQL = sql``,
): SQL {
  return sql`with ${ctes} gone as (${deleting} returning ${sql.identifier(alias)}.*)
    insert into bundle_changes (bundle_id, table_name, row_key, op, before)
    select ${bound.b}, ${nameLiteral(table)}, ${rowKeyObject(table, 'gone')}, 'delete',
           ${beforeObject(table, 'gone')}
    from gone`;
}

/** The select list of a staged file: each LOADER column from `refs` or the staged field of its name; retired_at null. */
function stagedColumns(
  table: LoaderTable,
  refs: Readonly<Record<string, SQL>>,
  extra: Readonly<Record<string, SQL>> = {},
): SQL {
  const items = LOADER_COLUMNS[table].map(({ name, type }) => {
    const value =
      refs[name] ?? (name === 'retired_at' ? sql`null::timestamptz` : stagedValue('s', name, type));
    return sql`${value} as ${id(name)}`;
  });
  for (const [name, value] of Object.entries(extra)) {
    items.push(sql`${value} as ${id(name)}`);
  }
  return list(items);
}

function overrideKept(name: string): SQL {
  return sql`t.overrides ? ${nameLiteral(name)}`;
}

async function run(tx: Tx, query: SQL): Promise<void> {
  await tx.execute(query);
}

async function ids(tx: Tx, query: SQL): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(query, 'objects');
  return rows.map((row) => row.id);
}

async function jurisdictionsStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  const columns = ['id', ...loaderColumnNames('jurisdictions'), 'label_point'];
  // index: bundle_rows_key
  const source = sql`select s.id, ${stagedColumns(
    'jurisdictions',
    { parent_id: sql`p.id` },
    {
      label_point: sql`case when s.data ->> 'label_lng' is null then null
        else st_setsrid(st_makepoint((s.data ->> 'label_lng')::float8, (s.data ->> 'label_lat')::float8), 4326) end`,
    },
  )}
    from staging.bundle_rows s
    left join staging.bundle_rows p on p.bundle_id = ${b} and p.file = 'jurisdictions'
                                   and p.source_key = s.data ->> 'parent_key'
    where s.bundle_id = ${b} and s.file = 'jurisdictions'`;
  await run(tx, upsertWithChanges(bound, { table: 'jurisdictions', source, columns }));
  await run(tx, retireWithChanges(bound, 'jurisdictions'));
}

async function districtsStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // Never geom, geom_hash, outline_svg, outline_bbox or label_point: those are the geometry step's.
  // index: bundle_rows_key; jurisdictions_source_key_key
  const source = sql`select s.id, ${stagedColumns('districts', { jurisdiction_id: sql`j.id` })}
    from staging.bundle_rows s
    join jurisdictions j on j.source_key = s.data ->> 'jurisdiction_key'
    where s.bundle_id = ${b} and s.file = 'districts'`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'districts',
      source,
      columns: ['id', ...loaderColumnNames('districts')],
    }),
  );
  await run(tx, retireWithChanges(bound, 'districts'));
}

async function districtFallbacksStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // No bundle_changes: fallbacks are replaced with the geometry (T-bundle_changes).
  // index: bundle_rows_key; districts_source_key_key; district_fallbacks_pkey
  const staged = sql`select d.id as district_id, v.id as via_district_id
    from staging.bundle_rows f
    join districts d on d.source_key = f.data ->> 'district_key'
    join districts v on v.source_key = f.data ->> 'via_district_key'
    where f.bundle_id = ${b} and f.file = 'district_fallbacks'`;
  await run(
    tx,
    sql`with staged as (${staged}),
      par as (
        select s.id from staging.bundle_rows s where s.bundle_id = ${b} and s.file = 'districts'
        union select district_id from staged)
      delete from district_fallbacks x using par
      where x.district_id = par.id
        and not exists (select 1 from staged
                        where staged.district_id = x.district_id and staged.via_district_id = x.via_district_id)`,
  );
  await run(
    tx,
    sql`insert into district_fallbacks (district_id, via_district_id)
        select distinct district_id, via_district_id from (${staged}) f
        on conflict (district_id, via_district_id) do nothing`,
  );
}

async function officesStep(tx: Tx, bound: Bound): Promise<void> {
  const { b, now } = bound;
  const columns = ['id', ...loaderColumnNames('offices'), 'updated_at'];
  // index: bundle_rows_key; jurisdictions_source_key_key; districts_source_key_key
  const source = sql`select s.id, ${stagedColumns(
    'offices',
    {
      jurisdiction_id: sql`j.id`,
      district_id: sql`d.id`,
      state: sql`j.state`,
      changed_at: now,
    },
    { updated_at: now },
  )}
    from staging.bundle_rows s
    join jurisdictions j on j.source_key = s.data ->> 'jurisdiction_key'
    join districts d on d.source_key = s.data ->> 'district_key'
    where s.bundle_id = ${b} and s.file = 'offices'`;
  // index: load_changed_offices_pkey
  const material = sql`exists (select 1 from load_changed_offices c where c.office_id = t.id)`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'offices',
      source,
      columns,
      kept: officesKept,
      set: {
        changed_at: sql`case when ${material} then ${now} else t.changed_at end`,
        updated_at: now,
      },
      notCompared: ['changed_at', 'updated_at'],
      orWhere: material,
    }),
  );
  await run(tx, retireWithChanges(bound, 'offices'));
}

/** The offices whose children a full child file replaces: staged, retired by this load, or named by a staged child row. */
function officeParents(bound: Bound, child: 'office_powers' | 'officeholders'): SQL {
  const { b } = bound;
  // index: bundle_rows_key; bundle_changes_bundle; offices_source_key_key
  return sql`select s.id from staging.bundle_rows s where s.bundle_id = ${b} and s.file = 'offices'
    union select (c.row_key ->> 'id')::uuid from bundle_changes c
          where c.bundle_id = ${b} and c.table_name = 'offices' and c.op = 'retire'
    union select o.id from staging.bundle_rows s join offices o on o.source_key = s.data ->> 'office_key'
          where s.bundle_id = ${b} and s.file = ${nameLiteral(child)}`;
}

async function officePowersStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // index: bundle_rows_key; offices_source_key_key
  const source = sql`select ${stagedColumns('office_powers', { office_id: sql`o.id` })}
    from staging.bundle_rows s
    join offices o on o.source_key = s.data ->> 'office_key'
    where s.bundle_id = ${b} and s.file = 'office_powers'`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'office_powers',
      source,
      columns: loaderColumnNames('office_powers'),
    }),
  );
  // index: office_powers_pkey
  await run(
    tx,
    recordDeleted(
      bound,
      'office_powers',
      'p',
      sql`delete from office_powers p using par
          where p.office_id = par.id
            and not exists (select 1 from staged
                            where staged.office_id = p.office_id and staged.power_id = p.power_id)`,
      sql`par as (${officeParents(bound, 'office_powers')}),
        staged as (select s.data ->> 'power_id' as power_id, o.id as office_id
                   from staging.bundle_rows s join offices o on o.source_key = s.data ->> 'office_key'
                   where s.bundle_id = ${b} and s.file = 'office_powers'),`,
    ),
  );
}

async function electionsStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // The five headline columns are derived from the tracks (L-headline-deadline), never taken from the bundle.
  // index: bundle_rows_key; offices_source_key_key
  const source = sql`select s.id, ${stagedColumns('elections', { office_id: sql`o.id` })}
    from staging.bundle_rows s
    join offices o on o.source_key = s.data ->> 'office_key'
    where s.bundle_id = ${b} and s.file = 'elections'`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'elections',
      source,
      columns: ['id', ...loaderColumnNames('elections')],
    }),
  );
  await run(tx, retireWithChanges(bound, 'elections'));
}

async function filingTracksStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // index: bundle_rows_key; elections_source_key_key
  const source = sql`select s.id, ${stagedColumns('filing_tracks', { election_id: sql`e.id` })}
    from staging.bundle_rows s
    join elections e on e.source_key = s.data ->> 'election_key'
    where s.bundle_id = ${b} and s.file = 'filing_tracks'`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'filing_tracks',
      source,
      columns: ['id', ...loaderColumnNames('filing_tracks')],
    }),
  );
  // Per parent election: staged, retired by this load, or named by a staged track.
  // index: bundle_rows_key; bundle_changes_bundle; elections_source_key_key; filing_tracks_track_key
  await run(
    tx,
    recordDeleted(
      bound,
      'filing_tracks',
      't',
      sql`delete from filing_tracks t using par
          where t.election_id = par.id
            and not exists (select 1 from staging.bundle_rows s
                            where s.bundle_id = ${b} and s.file = 'filing_tracks' and s.source_key = t.source_key)`,
      sql`par as (
        select s.id from staging.bundle_rows s where s.bundle_id = ${b} and s.file = 'elections'
        union select (c.row_key ->> 'id')::uuid from bundle_changes c
              where c.bundle_id = ${b} and c.table_name = 'elections' and c.op = 'retire'
        union select e.id from staging.bundle_rows s join elections e on e.source_key = s.data ->> 'election_key'
              where s.bundle_id = ${b} and s.file = 'filing_tracks'),`,
    ),
  );
}

async function headlineStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // index: bundle_changes_bundle; filing_tracks_pkey
  const electionIds = await ids(
    tx,
    sql`select (c.row_key ->> 'id')::uuid as id from bundle_changes c
        where c.bundle_id = ${b} and c.table_name = 'elections' and c.op in ('insert', 'update')
        union
        select (c.before ->> 'election_id')::uuid from bundle_changes c
        where c.bundle_id = ${b} and c.table_name = 'filing_tracks' and c.before ->> 'election_id' is not null
        union
        select t.election_id from bundle_changes c join filing_tracks t on t.id = (c.row_key ->> 'id')::uuid
        where c.bundle_id = ${b} and c.table_name = 'filing_tracks' and c.op in ('insert', 'update')
        order by 1`,
  );
  for (const piece of chunk(electionIds, ID_CHUNK)) {
    await recomputeHeadlineDeadlines(tx, piece);
  }
}

/** Resolves every person key the bundle names to its target: its own row, or the end of its merged_into chain. */
async function personTargetsStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // index: bundle_rows_key; people_source_key_key; people_pkey
  await run(
    tx,
    sql`insert into load_person_targets (person_key, target_id, depth)
      with recursive keys(person_key, start_id) as (
        select s.source_key, s.id from staging.bundle_rows s where s.bundle_id = ${b} and s.file = 'people'
        union
        select p.source_key, p.id
        from staging.bundle_rows s join people p on p.source_key = s.data ->> 'person_key'
        where s.bundle_id = ${b} and s.file in ('person_aliases', 'officeholders')
          and not exists (select 1 from staging.bundle_rows sp
                          where sp.bundle_id = ${b} and sp.file = 'people' and sp.source_key = p.source_key)),
      chain(person_key, cur_id, depth) as (
        select person_key, start_id, 0 from keys
        union all
        select c.person_key, p.merged_into, c.depth + 1
        from chain c join people p on p.id = c.cur_id
        where p.merged_into is not null and c.depth <= ${MERGE_CHAIN_MAX}::int)
      select distinct on (person_key) person_key, cur_id, depth
      from chain order by person_key, depth desc`,
  );
  const [longest] = await tx.execute<{ depth: number | null }>(
    sql`select max(depth)::int as depth from load_person_targets`,
    'objects',
  );
  if ((longest?.depth ?? 0) > MERGE_CHAIN_MAX) {
    throw new Error('A merged_into chain of the bundle is longer than 10 steps.');
  }
}

/** The offices column an `overrides` entry keeps from a load and from a revert; null: never kept. */
export function officesKept(name: string): SQL | null {
  return name === 'source_key' || name === 'changed_at' || name === 'retired_at'
    ? null
    : overrideKept(name);
}

/** The people column an `overrides` entry keeps from a load and from a revert; null: never kept. */
export function peopleKept(name: string): SQL | null {
  if (name === 'source_key' || name === 'retired_at') {
    return null;
  }
  if ((PHOTO_COLUMNS as readonly string[]).includes(name)) {
    // An owner's or an admin's photo keeps its size, credit, licence and source with it.
    return sql`(t.overrides ? ${nameLiteral(name)}
                or t.overrides -> 'photo_key' ->> 'role' in ('owner', 'admin'))`;
  }
  return overrideKept(name);
}

async function peopleStep(tx: Tx, bound: Bound, ctx: UpsertContext): Promise<void> {
  const { b } = bound;
  const shas: string[] = [];
  const keys: string[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  for (const [sha, placement] of ctx.photos) {
    shas.push(sha);
    keys.push(placement.key);
    widths.push(placement.width);
    heights.push(placement.height);
  }
  const merged = sql`(tg.target_id <> s.id)`;
  const photo = (field: string): SQL =>
    sql`case when jsonb_typeof(s.data -> 'photo') = 'object' then s.data -> 'photo' ->> ${nameLiteral(field)} end`;
  // A merged-away person writes to its survivor, keeping the survivor's own identity columns; one
  // staged row per target, the survivor's own row first (T-people).
  // index: bundle_rows_key; load_person_targets_pkey; people_pkey
  const source = sql`select distinct on (tg.target_id) tg.target_id as id, ${stagedColumns(
    'people',
    {
      source_key: sql`case when ${merged} then sv.source_key else s.source_key end`,
      slug: sql`case when ${merged} then sv.slug else s.data ->> 'slug' end`,
      origin: sql`case when ${merged} then sv.origin else nullif(s.data -> 'origin', 'null'::jsonb) end`,
      retired_at: sql`case when ${merged} then sv.retired_at end`,
      photo_key: sql`ph.key`,
      photo_width: sql`ph.width`,
      photo_height: sql`ph.height`,
      photo_credit: photo('credit_text'),
      photo_license: photo('license'),
      photo_source_url: photo('source_url'),
    },
  )}
    from staging.bundle_rows s
    join load_person_targets tg on tg.person_key = s.source_key
    left join people sv on sv.id = tg.target_id and tg.target_id <> s.id
    left join unnest(${sql.param(shas)}::text[], ${sql.param(keys)}::text[],
                     ${sql.param(widths)}::int[], ${sql.param(heights)}::int[]) as ph(sha, key, width, height)
      on jsonb_typeof(s.data -> 'photo') = 'object'
     and ph.sha = substring(s.data -> 'photo' ->> 'asset' from '([0-9a-f]{64})[.]jpg$')
    where s.bundle_id = ${b} and s.file = 'people'
    order by tg.target_id, (tg.target_id = s.id) desc, s.source_key`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'people',
      source,
      columns: ['id', ...loaderColumnNames('people')],
      kept: peopleKept,
    }),
  );
  // Only people the bundle created are retired by absence, never a merged row or a survivor a
  // staged person writes to (PIPE-loader).
  await run(
    tx,
    retireWithChanges(
      bound,
      'people',
      sql`and t.origin ->> 'created_by' = 'bundle' and t.merged_into is null
          and not exists (select 1 from load_person_targets g where g.target_id = t.id)`,
    ),
  );
}

async function personAliasesStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // A load never deletes an alias (T-person_aliases).
  // index: bundle_rows_key; load_person_targets_pkey; person_aliases_pkey
  await run(
    tx,
    sql`with ins as (
        insert into person_aliases (person_id, alias)
        select distinct tg.target_id, s.data ->> 'alias'
        from staging.bundle_rows s
        join load_person_targets tg on tg.person_key = s.data ->> 'person_key'
        where s.bundle_id = ${b} and s.file = 'person_aliases'
        on conflict (person_id, alias) do nothing
        returning person_id, alias)
      insert into bundle_changes (bundle_id, table_name, row_key, op, before)
      select ${b}, 'person_aliases', ${rowKeyObject('person_aliases', 'ins')}, 'insert', null from ins`,
  );
}

async function givenNameAliasesStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // index: bundle_rows_key
  const source = sql`select s.data ->> 'canonical' as canonical, s.data ->> 'alias' as alias,
      s.data ->> 'source' as source
    from staging.bundle_rows s
    where s.bundle_id = ${b} and s.file = 'given_name_aliases'`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'given_name_aliases',
      source,
      columns: ['canonical', 'alias', 'source'],
      // An admin pair is never touched.
      where: sql`t.source <> 'admin' and t.source is distinct from excluded.source`,
    }),
  );
  await run(
    tx,
    recordDeleted(
      bound,
      'given_name_aliases',
      'g',
      sql`delete from given_name_aliases g
          where g.source in ('nicknames', 'supplement')
            and not exists (select 1 from staging.bundle_rows s
                            where s.bundle_id = ${b} and s.file = 'given_name_aliases'
                              and s.data ->> 'canonical' = g.canonical and s.data ->> 'alias' = g.alias)`,
    ),
  );
}

async function officeholdersStep(tx: Tx, bound: Bound): Promise<void> {
  const { b } = bound;
  // index: bundle_rows_key; offices_source_key_key; load_person_targets_pkey
  const source = sql`select s.id, ${stagedColumns('officeholders', {
    office_id: sql`o.id`,
    person_id: sql`tg.target_id`,
  })}
    from staging.bundle_rows s
    join offices o on o.source_key = s.data ->> 'office_key'
    join load_person_targets tg on tg.person_key = s.data ->> 'person_key'
    where s.bundle_id = ${b} and s.file = 'officeholders'`;
  await run(
    tx,
    upsertWithChanges(bound, {
      table: 'officeholders',
      source,
      columns: ['id', ...loaderColumnNames('officeholders')],
    }),
  );
  // index: officeholders_office; bundle_rows_key
  await run(
    tx,
    recordDeleted(
      bound,
      'officeholders',
      'h',
      sql`delete from officeholders h using par
          where h.office_id = par.id
            and not exists (select 1 from staging.bundle_rows s
                            where s.bundle_id = ${b} and s.file = 'officeholders' and s.source_key = h.source_key)`,
      sql`par as (${officeParents(bound, 'officeholders')}),`,
    ),
  );
}

async function officeSearchStep(tx: Tx, bound: Bound): Promise<void> {
  const { b, now } = bound;
  // index: bundle_changes_bundle; offices_jurisdiction; offices_district
  const officeIds = await ids(
    tx,
    sql`select (c.row_key ->> 'id')::uuid as id from bundle_changes c
        where c.bundle_id = ${b} and c.table_name = 'offices' and c.op in ('insert', 'update')
        union
        select o.id from bundle_changes c join offices o on o.jurisdiction_id = (c.row_key ->> 'id')::uuid
        where c.bundle_id = ${b} and c.table_name = 'jurisdictions' and c.op = 'update'
        union
        select o.id from bundle_changes c join offices o on o.district_id = (c.row_key ->> 'id')::uuid
        where c.bundle_id = ${b} and c.table_name = 'districts' and c.op = 'update'
        order by 1`,
  );
  for (const piece of chunk(officeIds, ID_CHUNK)) {
    await refreshOfficeSearch(tx, piece);
    // The search write is a write of the load: updated_at is the load's time (T-offices).
    await run(
      tx,
      sql`update offices set updated_at = ${now} where id = any(${sql.param(piece)}::uuid[])`,
    );
  }
}

async function staleDistrictsStep(tx: Tx, bound: Bound): Promise<void> {
  const { b, now } = bound;
  // jurisdictions where a district was added or retired, or whose staged geom_hash differs
  // from the live one (geometry is written after this transaction, so the live value is the old one).
  // No user id leaves this statement.
  // index: bundle_changes_bundle; bundle_rows_key; districts_pkey; user_districts_pkey; districts_jurisdiction
  await run(
    tx,
    sql`with j as (
        select d.jurisdiction_id from bundle_changes c join districts d on d.id = (c.row_key ->> 'id')::uuid
        where c.bundle_id = ${b} and c.table_name = 'districts' and c.op in ('insert', 'retire')
        union
        select d.jurisdiction_id from staging.bundle_rows s join districts d on d.id = s.id
        where s.bundle_id = ${b} and s.file = 'districts' and d.geom_hash is distinct from s.data ->> 'geom_hash')
      update users u set districts_stale_at = ${now}
      where exists (select 1 from user_districts ud join districts d on d.id = ud.district_id
                    where ud.user_id = u.id and d.jurisdiction_id in (select jurisdiction_id from j))`,
  );
}

/**
 * Writes the staged bundle to the live tables in PIPE-loader's order, inside the caller's
 * transaction. A table whose file is absent is left untouched. Throws on any failure,
 * so the caller's transaction rolls everything back (P8-53).
 */
export async function applyUpsert(tx: Tx, ctx: UpsertContext): Promise<void> {
  const bound: Bound = {
    b: sql`${ctx.bundleId}::uuid`,
    now: sql`${ctx.now.toISOString()}::timestamptz`,
  };
  const has = (file: FullFileR0): boolean => ctx.files.has(file);
  // A utility statement takes no parameters: create first, then fill with an insert that does.
  await run(
    tx,
    sql`create temp table load_changed_offices (office_id uuid primary key, state char(2) not null) on commit drop`,
  );
  await run(
    tx,
    sql`insert into load_changed_offices (office_id, state) ${materialChangeQuery(ctx.bundleId)}`,
  );
  await run(
    tx,
    sql`create temp table load_person_targets (person_key text primary key, target_id uuid not null, depth int not null) on commit drop`,
  );
  if (has('jurisdictions')) {
    await jurisdictionsStep(tx, bound);
  }
  if (has('districts')) {
    await districtsStep(tx, bound);
  }
  if (has('district_fallbacks')) {
    await districtFallbacksStep(tx, bound);
  }
  if (has('offices')) {
    await officesStep(tx, bound);
  }
  if (has('office_powers')) {
    await officePowersStep(tx, bound);
  }
  if (has('elections')) {
    await electionsStep(tx, bound);
  }
  if (has('filing_tracks')) {
    await filingTracksStep(tx, bound);
  }
  await headlineStep(tx, bound);
  if (has('people') || has('person_aliases') || has('officeholders')) {
    await personTargetsStep(tx, bound);
  }
  if (has('people')) {
    await peopleStep(tx, bound, ctx);
  }
  if (has('person_aliases')) {
    await personAliasesStep(tx, bound);
  }
  if (has('given_name_aliases')) {
    await givenNameAliasesStep(tx, bound);
  }
  if (has('officeholders')) {
    await officeholdersStep(tx, bound);
  }
  await officeSearchStep(tx, bound);
  await staleDistrictsStep(tx, bound);
}
