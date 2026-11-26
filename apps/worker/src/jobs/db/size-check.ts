import type { Db } from '@citizenrun/db';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

/** The database volume in bytes: 50,000 MB read as decimal megabytes, so percentages err early. */
export const DB_VOLUME_BYTES = 50_000_000_000; // D-137
/** The size at which the hourly check alerts: 15 GB. */
export const DB_SIZE_ALERT_BYTES = 15_000_000_000; // D-137

// One db_size_high email a day.
const DB_SIZE_HIGH_THROTTLE_SECONDS = 86_400;

/** Reads the two parts of the database's size, in bytes. */
export type DbSizeReader = {
  /** Every database of the server. */
  databases(db: Db): Promise<number>;
  /** The write-ahead log. */
  wal(db: Db): Promise<number>;
};

/**
 * One size read in a transaction that first drops to the login role, a member of `pg_monitor`,
 * which `pg_ls_waldir()` needs (D-808). `set local` ends with the transaction, so the pooled session
 * never keeps the change. The sum is a bigint, read as text and converted with Number: sizes stay
 * far below 2^53.
 */
async function readBytes(db: Db, query: SQL): Promise<number> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`set local role none`);
    return tx.execute<{ bytes: string | null }>(query, 'objects');
  });
  const bytes = Number(rows[0]?.bytes ?? Number.NaN);
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new TypeError('the size read gave no byte count');
  }
  return bytes;
}

/** The size of every database plus the write-ahead log (PC9-21), as the server reports them. */
export const pgSizeReader: DbSizeReader = {
  databases: (db) =>
    readBytes(db, sql`select sum(pg_database_size(datname))::text as bytes from pg_database`),
  wal: (db) => readBytes(db, sql`select coalesce(sum(size), 0)::text as bytes from pg_ls_waldir()`),
};

/** The alert's values: gigabytes to one decimal, and the share of the volume as a whole percent. */
export function sizeAlertValues(size: number): { gb: number; pct: string } {
  return {
    gb: Math.round(size / 1e8) / 10,
    pct: new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }).format(
      size / DB_VOLUME_BYTES,
    ),
  };
}

/**
 * J-db.size-check over `reader` (default pgSizeReader): the size is every database plus the
 * write-ahead log; at DB_SIZE_ALERT_BYTES or more it raises `db_size_high`, at most once a day.
 */
export function createDbSizeCheckJob(
  reader: DbSizeReader = pgSizeReader,
): JobDefinition<'db.size-check'> {
  return {
    name: 'db.size-check',
    queue: QUEUE_OPTIONS['db.size-check'].queue,
    work: QUEUE_OPTIONS['db.size-check'].work,
    async handle(_payload, ctx) {
      const size = (await reader.databases(ctx.db)) + (await reader.wal(ctx.db));
      if (size >= DB_SIZE_ALERT_BYTES) {
        await ctx.enqueue(
          'ops.alert',
          { kind: 'db_size_high', values: sizeAlertValues(size) },
          { throttle: { seconds: DB_SIZE_HIGH_THROTTLE_SECONDS, key: 'db_size_high' } },
        );
      }
      ctx.log.info('db.size.checked', { bytes: size, pct: size / DB_VOLUME_BYTES });
    },
  };
}

/** J-db.size-check with the real reader. */
export const dbSizeCheck: JobDefinition<'db.size-check'> = createDbSizeCheckJob(pgSizeReader);
