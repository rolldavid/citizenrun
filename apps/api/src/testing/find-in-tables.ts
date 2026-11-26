import type { Db } from '@citizenrun/db';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

type ColumnRow = { table: string; column: string };

/**
 * Every `<table>.<column>` of schema `public` whose text-like value (text, varchar, char, jsonb or
 * citext, cast to text) holds `needle` in some row: an empty list means no row of any table holds
 * it (INV-04). The identifiers come from `information_schema.columns`; the needle is bound.
 */
export async function findTextInTables(db: Db, needle: string): Promise<string[]> {
  const columns = await db.execute<ColumnRow>(
    sql`select c.table_name as "table", c.column_name as "column"
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and (c.data_type in ('text', 'character varying', 'character', 'jsonb')
               or (c.data_type = 'USER-DEFINED' and c.udt_name = 'citext'))
        order by c.table_name, c.column_name`,
    'objects',
  );
  const byTable = new Map<string, string[]>();
  for (const { table, column } of columns) {
    const list = byTable.get(table) ?? [];
    list.push(column);
    byTable.set(table, list);
  }
  const found: string[] = [];
  for (const [table, names] of byTable) {
    // One statement per table: column i of the answer says whether column `names[i]` holds it.
    const checks: SQL[] = names.map(
      (name, index) =>
        sql`coalesce(bool_or(strpos(${sql.identifier(name)}::text, ${needle}) > 0), false) as ${sql.identifier(`c${String(index)}`)}`,
    );
    const rows = await db.execute<Record<string, boolean>>(
      sql`select ${sql.join(checks, sql`, `)} from ${sql.identifier('public')}.${sql.identifier(table)}`,
      'objects',
    );
    const row = rows[0] ?? {};
    names.forEach((name, index) => {
      if (row[`c${String(index)}`] === true) {
        found.push(`${table}.${name}`);
      }
    });
  }
  return found;
}
