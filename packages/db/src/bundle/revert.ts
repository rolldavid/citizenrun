import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db, Tx } from '../client.ts';
import { recomputeHeadlineDeadlines } from '../sql/headline-deadline.ts';
import { refreshOfficeSearch } from '../sql/office-search.ts';
import { ID_CHUNK, chunk } from './chunk.ts';
import {
  KEY_COLUMNS,
  RETIRING_TABLES,
  isLoaderTable,
  loaderColumnNames,
  nameLiteral,
  rowKeyMatch,
} from './columns.ts';
import type { LoaderTable } from './columns.ts';
import { officesKept, peopleKept } from './upsert.ts';

// revertBundle of PIPE-loader-hold-revert and J-bundle.revert: one transaction that
// undoes a load from its bundle_changes, newest first. Geometry and district_fallbacks are not
// reverted (T-bundle_changes).

const PAGE_ROWS = 1000; // bundle_changes read per page

type Op = 'insert' | 'update' | 'retire' | 'delete';
type Change = { id: string; table_name: string; op: Op };
type Run = { table: LoaderTable; op: Op; ids: string[] };

const id = (name: string): SQL => sql`${sql.identifier(name)}`;

function changeIds(run: Run): SQL {
  return sql`${sql.param(run.ids)}::bigint[]`;
}

/** The condition under which the live row's `overrides` keeps a column (the loader's own rule); null: never. */
function overrideKeeps(table: LoaderTable, name: string): SQL | null {
  if (table === 'offices') {
    return officesKept(name);
  }
  if (table === 'people') {
    return peopleKept(name);
  }
  return null;
}

/**
 * Restores the columns `before` holds, and no others (`retire`: retired_at only). A column the
 * row's `overrides` now names keeps its live value, so an admin's or an owner's edit made after the
 * load survives the revert (T-bundle_changes, R-051).
 */
function undoUpdate(run: Run, now: SQL): SQL {
  const names = run.op === 'retire' ? ['retired_at'] : loaderColumnNames(run.table);
  const items = names.map((name) => {
    const keeps = overrideKeeps(run.table, name);
    const restore =
      keeps === null
        ? sql`c.before ? ${nameLiteral(name)}`
        : sql`c.before ? ${nameLiteral(name)} and not (${keeps})`;
    return sql`${id(name)} = case when ${restore} then r.${id(name)} else t.${id(name)} end`;
  });
  if (run.table === 'offices') {
    items.push(sql`updated_at = ${now}`);
  }
  // index: bundle_changes_pkey; <table>_pkey
  return sql`update ${id(run.table)} t set ${sql.join(items, sql`, `)}
    from bundle_changes c
    cross join lateral jsonb_populate_record(null::${id(run.table)}, c.before) r
    where c.id = any(${changeIds(run)}) and ${rowKeyMatch(run.table, 't', 'c')}`;
}

/** An inserted row: retired on the five retiring tables (A4), deleted on the others. */
function undoInsert(run: Run, now: SQL): SQL {
  if (RETIRING_TABLES.includes(run.table)) {
    const alsoSet = run.table === 'offices' ? sql`, updated_at = ${now}` : sql``;
    return sql`update ${id(run.table)} t set retired_at = ${now}${alsoSet}
      from bundle_changes c
      where c.id = any(${changeIds(run)}) and ${rowKeyMatch(run.table, 't', 'c')}`;
  }
  return sql`delete from ${id(run.table)} t using bundle_changes c
    where c.id = any(${changeIds(run)}) and ${rowKeyMatch(run.table, 't', 'c')}`;
}

/** A deleted row is inserted again from `before || row_key`. */
function undoDelete(run: Run): SQL {
  const keys = KEY_COLUMNS[run.table];
  const names = [...keys, ...loaderColumnNames(run.table).filter((name) => !keys.includes(name))];
  const columns = sql.join(
    names.map((name) => id(name)),
    sql`, `,
  );
  const values = sql.join(
    names.map((name) => sql`r.${id(name)}`),
    sql`, `,
  );
  return sql`insert into ${id(run.table)} (${columns})
    select ${values}
    from bundle_changes c
    cross join lateral jsonb_populate_record(null::${id(run.table)}, c.before || c.row_key) r
    where c.id = any(${changeIds(run)})
    on conflict do nothing`;
}

/** Records the elections and offices a run touches, read before it is undone. */
async function noteTouched(tx: Tx, run: Run): Promise<void> {
  const ids = changeIds(run);
  if (run.table === 'elections') {
    await tx.execute(
      sql`insert into revert_elections (id)
          select (c.row_key ->> 'id')::uuid from bundle_changes c where c.id = any(${ids})
          on conflict do nothing`,
    );
  } else if (run.table === 'filing_tracks') {
    // The election a track had before (from `before`) and has now (the live row).
    await tx.execute(
      sql`insert into revert_elections (id)
          select (c.before ->> 'election_id')::uuid from bundle_changes c
          where c.id = any(${ids}) and c.before ->> 'election_id' is not null
          union
          select t.election_id from bundle_changes c join filing_tracks t on t.id = (c.row_key ->> 'id')::uuid
          where c.id = any(${ids})
          on conflict do nothing`,
    );
  } else if (run.table === 'offices') {
    await tx.execute(
      sql`insert into revert_offices (id)
          select (c.row_key ->> 'id')::uuid from bundle_changes c where c.id = any(${ids})
          on conflict do nothing`,
    );
  } else if (run.table === 'jurisdictions' || run.table === 'districts') {
    // Their names feed the offices' search vectors (L-office-search).
    const column = run.table === 'jurisdictions' ? id('jurisdiction_id') : id('district_id');
    // index: offices_jurisdiction; offices_district
    await tx.execute(
      sql`insert into revert_offices (id)
          select o.id from bundle_changes c join offices o on o.${column} = (c.row_key ->> 'id')::uuid
          where c.id = any(${ids})
          on conflict do nothing`,
    );
  }
}

async function undo(tx: Tx, run: Run, now: SQL): Promise<void> {
  await noteTouched(tx, run);
  if (run.op === 'update' || run.op === 'retire') {
    await tx.execute(undoUpdate(run, now));
  } else if (run.op === 'insert') {
    await tx.execute(undoInsert(run, now));
  } else {
    await tx.execute(undoDelete(run));
  }
}

/** Consecutive changes of one (table, op), in the order given. A table not in LOADER_COLUMNS is refused. */
function runsOf(changes: readonly Change[]): Run[] {
  const runs: Run[] = [];
  for (const change of changes) {
    if (!isLoaderTable(change.table_name)) {
      throw new Error('A bundle change names a table the loader does not write.');
    }
    const last = runs.at(-1);
    if (last !== undefined && last.table === change.table_name && last.op === change.op) {
      last.ids.push(change.id);
    } else {
      runs.push({ table: change.table_name, op: change.op, ids: [change.id] });
    }
  }
  return runs;
}

async function readIds(tx: Tx, table: 'revert_elections' | 'revert_offices'): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(
    sql`select id from ${id(table)} order by id`,
    'objects',
  );
  return rows.map((row) => row.id);
}

/**
 * Restores a bundle's load from its bundle_changes in one transaction, newest first, so children
 * are undone before parents; then recomputes the headline deadline and the search vector of what
 * it touched, and marks the bundle `reverted`. A bundle already `reverted` is left as it is.
 */
export async function revertBundle(db: Db, bundleId: string, now: Date): Promise<void> {
  const b = sql`${bundleId}::uuid`;
  const at = sql`${now.toISOString()}::timestamptz`;
  await db.transaction(async (tx) => {
    const [bundle] = await tx.execute<{ status: string }>(
      sql`select status from data_bundles where id = ${b} for update`,
      'objects',
    );
    if (bundle === undefined) {
      throw new Error('No such bundle.');
    }
    if (bundle.status === 'reverted') {
      return;
    }
    await tx.execute(sql`create temp table revert_elections (id uuid primary key) on commit drop`);
    await tx.execute(sql`create temp table revert_offices (id uuid primary key) on commit drop`);
    let below: string | null = null;
    for (;;) {
      const before: SQL = below === null ? sql`` : sql`and c.id < ${below}::bigint`;
      // index: bundle_changes_bundle
      const page: Change[] = await tx.execute<Change>(
        sql`select c.id::text as id, c.table_name, c.op from bundle_changes c
            where c.bundle_id = ${b} ${before}
            order by c.id desc
            limit ${PAGE_ROWS}`,
        'objects',
      );
      if (page.length === 0) {
        break;
      }
      for (const run of runsOf(page)) {
        await undo(tx, run, at);
      }
      below = page.at(-1)?.id ?? null;
    }
    for (const piece of chunk(await readIds(tx, 'revert_elections'), ID_CHUNK)) {
      await recomputeHeadlineDeadlines(tx, piece);
    }
    for (const piece of chunk(await readIds(tx, 'revert_offices'), ID_CHUNK)) {
      await refreshOfficeSearch(tx, piece);
      await tx.execute(
        sql`update offices set updated_at = ${at} where id = any(${sql.param(piece)}::uuid[])`,
      );
    }
    await tx.execute(sql`update data_bundles set status = 'reverted' where id = ${b}`);
  });
}
