import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

// The columns the loader writes and bundle_changes records (T-bundle_changes). Every SQL
// identifier and JSON key the loader writes comes from these constants (no value from a bundle is
// ever spliced into SQL text). Never listed: geometry, label_point, search, a score column,
// overrides, next_election_id, next_filing_deadline, completeness, updated_at, and the people
// columns claimed_by, donate_url, volunteer_url, pending_links, photo_pending_key.

export type ColumnType =
  | 'text'
  | 'int'
  | 'bigint'
  | 'numeric'
  | 'bool'
  | 'date'
  | 'time'
  | 'timestamptz'
  | 'jsonb'
  | 'text[]'
  | 'uuid';

export type LoaderTable =
  | 'jurisdictions'
  | 'districts'
  | 'offices'
  | 'office_powers'
  | 'elections'
  | 'filing_tracks'
  | 'people'
  | 'person_aliases'
  | 'given_name_aliases'
  | 'officeholders';

export type LoaderColumn = { readonly name: string; readonly type: ColumnType };

/** The tables whose rows a load retires and never deletes (A4). */
export const RETIRING_TABLES: readonly LoaderTable[] = [
  'jurisdictions',
  'districts',
  'offices',
  'elections',
  'people',
];

/** Each table's primary-key columns: the keys of bundle_changes.row_key (PC-70). */
export const KEY_COLUMNS: { readonly [T in LoaderTable]: readonly string[] } = {
  jurisdictions: ['id'],
  districts: ['id'],
  offices: ['id'],
  office_powers: ['office_id', 'power_id'],
  elections: ['id'],
  filing_tracks: ['id'],
  people: ['id'],
  person_aliases: ['person_id', 'alias'],
  given_name_aliases: ['canonical', 'alias'],
  officeholders: ['id'],
};

/** The type of every key column. */
export const KEY_COLUMN_TYPES: Readonly<Record<string, ColumnType>> = {
  id: 'uuid',
  office_id: 'uuid',
  power_id: 'text',
  person_id: 'uuid',
  alias: 'text',
  canonical: 'text',
};

function cols(...entries: [string, ColumnType][]): readonly LoaderColumn[] {
  return entries.map(([name, type]) => ({ name, type }));
}

/** The columns the loader writes on each table and records in bundle_changes.before. */
export const LOADER_COLUMNS: { readonly [T in LoaderTable]: readonly LoaderColumn[] } = {
  jurisdictions: cols(
    ['source_key', 'text'],
    ['kind', 'text'],
    ['name', 'text'],
    ['state', 'text'],
    ['census_id', 'text'],
    ['parent_id', 'uuid'],
    ['population', 'int'],
    ['website', 'text'],
    ['timezone', 'text'],
    ['budget_cents', 'bigint'],
    ['budget_year', 'int'],
    ['census_active', 'bool'],
    ['field_meta', 'jsonb'],
    ['retired_at', 'timestamptz'],
  ),
  districts: cols(
    ['source_key', 'text'],
    ['jurisdiction_id', 'uuid'],
    ['name', 'text'],
    ['level', 'text'],
    ['geometry_quality', 'text'],
    ['population', 'int'],
    ['population_18', 'int'],
    ['lean', 'numeric'],
    ['lean_basis', 'text'],
    ['field_meta', 'jsonb'],
    ['retired_at', 'timestamptz'],
  ),
  offices: cols(
    ['source_key', 'text'],
    ['slug', 'text'],
    ['jurisdiction_id', 'uuid'],
    ['district_id', 'uuid'],
    ['office_type_id', 'text'],
    ['state', 'text'],
    ['title', 'text'],
    ['placeholder', 'bool'],
    ['seats', 'int'],
    ['body_size', 'int'],
    ['seats_up_next', 'int'],
    ['vacant_seats_up_next', 'int'],
    ['term_years', 'numeric'],
    ['term_limit_terms', 'int'],
    ['partisan', 'bool'],
    ['party_selection', 'text'],
    ['electorate', 'int'],
    ['pay_annual_cents', 'bigint'],
    ['pay_kind', 'text'],
    ['pay_amount_cents', 'bigint'],
    ['pay_period', 'text'],
    ['pay_change_note', 'text'],
    ['benefits', 'text[]'],
    ['hours_per_week', 'numeric'],
    ['full_time', 'bool'],
    ['meeting_times', 'text[]'],
    ['fits_day_job', 'text'],
    ['filing_fee_cents', 'bigint'],
    ['signatures_required', 'int'],
    ['where_to_file', 'text'],
    ['eligibility', 'jsonb'],
    ['field_meta', 'jsonb'],
    ['changed_at', 'timestamptz'],
    ['retired_at', 'timestamptz'],
  ),
  office_powers: cols(
    ['office_id', 'uuid'],
    ['power_id', 'text'],
    ['relevance', 'int'],
    ['quote', 'text'],
    ['source_url', 'text'],
    ['confidence', 'text'],
    ['checked_at', 'timestamptz'],
  ),
  elections: cols(
    ['source_key', 'text'],
    ['office_id', 'uuid'],
    ['election_date', 'date'],
    ['kind', 'text'],
    ['party', 'text'],
    ['turnout_class', 'text'],
    ['deadline_conflict', 'jsonb'],
    ['field_meta', 'jsonb'],
    ['retired_at', 'timestamptz'],
  ),
  filing_tracks: cols(
    ['source_key', 'text'],
    ['election_id', 'uuid'],
    ['track', 'text'],
    ['opens_on', 'date'],
    ['closes_on', 'date'],
    ['closes_time', 'time'],
    ['petition_opens', 'date'],
    ['petition_due', 'date'],
    ['fee_cents', 'bigint'],
    ['signatures', 'int'],
    ['where_to_file', 'text'],
    ['basis', 'text'],
    ['source_url', 'text'],
    ['quote', 'text'],
    ['rule_citation', 'text'],
    ['confidence', 'text'],
    ['checked_at', 'timestamptz'],
    ['field_meta', 'jsonb'],
  ),
  people: cols(
    ['source_key', 'text'],
    ['slug', 'text'],
    ['name', 'text'],
    ['first_name', 'text'],
    ['middle_name', 'text'],
    ['last_name', 'text'],
    ['suffix', 'text'],
    ['party', 'text'],
    ['photo_key', 'text'],
    ['photo_credit', 'text'],
    ['photo_license', 'text'],
    ['photo_source_url', 'text'],
    ['photo_width', 'int'],
    ['photo_height', 'int'],
    ['website', 'text'],
    ['roster_only', 'bool'],
    ['origin', 'jsonb'],
    ['retired_at', 'timestamptz'],
  ),
  // Insert-only (T-person_aliases): `before` is always null.
  person_aliases: [],
  given_name_aliases: cols(['source', 'text']),
  officeholders: cols(
    ['source_key', 'text'],
    ['office_id', 'uuid'],
    ['person_id', 'uuid'],
    ['seat_label', 'text'],
    ['since', 'date'],
    ['until', 'date'],
    ['seat_up_next', 'bool'],
    ['term_limited', 'bool'],
    ['not_running', 'bool'],
    ['cash_on_hand_cents', 'bigint'],
    ['cash_as_of', 'date'],
    ['cash_source_url', 'text'],
  ),
};

const NAME = /^[a-z][a-z0-9_]*$/;

/** A lower snake_case name from the constants above, bound as a text parameter. */
export function nameLiteral(name: string): SQL {
  if (!NAME.test(name)) {
    throw new RangeError('A loader name is lower snake_case.');
  }
  return sql`${name}::text`;
}

/** True when `table` is one of the loader's tables. */
export function isLoaderTable(table: string): table is LoaderTable {
  return Object.hasOwn(LOADER_COLUMNS, table);
}

const SQL_TYPES: { readonly [T in ColumnType]: SQL } = {
  text: sql`text`,
  int: sql`int`,
  bigint: sql`bigint`,
  numeric: sql`numeric`,
  bool: sql`boolean`,
  date: sql`date`,
  time: sql`time`,
  timestamptz: sql`timestamptz`,
  jsonb: sql`jsonb`,
  'text[]': sql`text[]`,
  uuid: sql`uuid`,
};

/** The SQL type a ColumnType casts to. */
export function sqlType(type: ColumnType): SQL {
  return SQL_TYPES[type];
}

/** The column names of LOADER_COLUMNS[table]. */
export function loaderColumnNames(table: LoaderTable): string[] {
  return LOADER_COLUMNS[table].map((column) => column.name);
}

/** The type of a loader or key column of `table`. */
export function columnType(table: LoaderTable, name: string): ColumnType {
  const found = LOADER_COLUMNS[table].find((column) => column.name === name);
  const type = found?.type ?? KEY_COLUMN_TYPES[name];
  if (type === undefined) {
    throw new RangeError('No such loader column.');
  }
  return type;
}

/** Typed value of a staged field: (s.data ->> 'x')::<type>; jsonb as nullif(s.data -> 'x', 'null'::jsonb); text[] as
 *  case when jsonb_typeof(s.data -> 'x') = 'array' then array(select jsonb_array_elements_text(s.data -> 'x')) end. */
export function stagedValue(alias: string, field: string, type: ColumnType): SQL {
  const data = sql`${sql.identifier(alias)}.data`;
  const key = nameLiteral(field);
  if (type === 'jsonb') {
    return sql`nullif(${data} -> ${key}, 'null'::jsonb)`;
  }
  if (type === 'text[]') {
    return sql`case when jsonb_typeof(${data} -> ${key}) = 'array'
      then array(select jsonb_array_elements_text(${data} -> ${key})) end`;
  }
  return sql`(${data} ->> ${key})::${sqlType(type)}`;
}

function buildObject(alias: string, names: readonly string[], asText: boolean): SQL {
  const pairs = names.map((name) => {
    const value = sql`${sql.identifier(alias)}.${sql.identifier(name)}`;
    return sql`${nameLiteral(name)}, ${asText ? sql`${value}::text` : value}`;
  });
  return sql`jsonb_build_object(${sql.join(pairs, sql`, `)})`;
}

/** jsonb_build_object('<col>', <alias>.<col>, ...) over LOADER_COLUMNS; null::jsonb for a table with none. */
export function beforeObject(table: LoaderTable, alias: string): SQL {
  const names = loaderColumnNames(table);
  return names.length === 0 ? sql`null::jsonb` : buildObject(alias, names, false);
}

/** jsonb_build_object over KEY_COLUMNS, values cast to text. */
export function rowKeyObject(table: LoaderTable, alias: string): SQL {
  return buildObject(alias, KEY_COLUMNS[table], true);
}

/** `<left>.<key> = <right>.<key> and ...` over KEY_COLUMNS. */
export function keyMatch(table: LoaderTable, left: string, right: string): SQL {
  return sql.join(
    KEY_COLUMNS[table].map(
      (key) =>
        sql`${sql.identifier(left)}.${sql.identifier(key)} = ${sql.identifier(right)}.${sql.identifier(key)}`,
    ),
    sql` and `,
  );
}

/** `<alias>.<key> = (<change>.row_key ->> '<key>')::<type> and ...` over KEY_COLUMNS. */
export function rowKeyMatch(table: LoaderTable, alias: string, change: string): SQL {
  return sql.join(
    KEY_COLUMNS[table].map(
      (key) =>
        sql`${sql.identifier(alias)}.${sql.identifier(key)} = (${sql.identifier(change)}.row_key ->> ${nameLiteral(key)})::${sqlType(columnType(table, key))}`,
    ),
    sql` and `,
  );
}
