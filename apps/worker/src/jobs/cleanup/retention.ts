import { CLIENT_ERRORS_RETENTION_DAYS, markAccountDeleting } from '@citizenrun/db';
import { EXPORT_FILE_TTL_MS, SESSION_ABSOLUTE_MAX_MS, uuidFloor } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { DELETE_BATCH_MAX, deleteKeys } from '../../lib/bucket-ops.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';
import { RETENTION_BATCH_MAX, runBatches } from './retention-loop.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Rate-limit windows are kept a day after they end. */
export const RATE_LIMIT_KEEP_MS = DAY_MS; // J-cleanup.retention H1
/** Sign-in challenges are kept a day after they expire. */
export const CHALLENGE_KEEP_MS = DAY_MS; // J-cleanup.retention H2
/** Email sign-in codes are kept a day. */
export const EMAIL_CODE_KEEP_MS = DAY_MS; // J-cleanup.retention H3
/** An upload nobody consumed loses its object after 24 hours. */
export const UNCONSUMED_UPLOAD_KEEP_MS = 24 * HOUR_MS; // J-cleanup.retention H4
/** A sign-up with no age record and no session is deleted after 24 hours. */
export const UNFINISHED_SIGNUP_KEEP_MS = 24 * HOUR_MS; // J-cleanup.retention H9
/** An upload row is kept a week after it was made, once its object is gone. */
export const UPLOAD_ROW_KEEP_MS = 7 * DAY_MS; // J-cleanup.retention N3
/** An export row is kept thirty days after it was made. */
export const EXPORT_ROW_KEEP_MS = 30 * DAY_MS; // J-cleanup.retention N4
/** A client error report is kept fourteen days. */
export const CLIENT_ERROR_KEEP_MS = CLIENT_ERRORS_RETENTION_DAYS * DAY_MS; // J-cleanup.retention N5
/** App event partitions are kept 180 days after their month ends. */
export const APP_EVENT_KEEP_DAYS = 180; // J-cleanup.retention N6
/** Usage counters are kept 24 months. */
export const USAGE_COUNTER_KEEP_MONTHS = 24; // J-cleanup.retention N7

/** The id of a retention rule (J-cleanup.retention). */
export type RetentionRuleId =
  'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H9' | 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6' | 'N7';

/** One retention rule: the tables whose rows it ages, and its run, which returns the rows it changed. */
export type RetentionRule = {
  id: RetentionRuleId;
  scope: 'hourly' | 'nightly';
  tables: readonly string[];
  run(ctx: JobContext, now: Date): Promise<number>;
};

// `now` minus `ms`, as a bound timestamptz: every statement compares with the job's one instant.
function before(now: Date, ms: number): SQL {
  return sql`${new Date(now.getTime() - ms).toISOString()}::timestamptz`;
}

// The uuid floor of `now` minus `ms`, as a bound uuid: a primary-key range (D-239).
function floorBefore(now: Date, ms: number): SQL {
  return sql`${uuidFloor(new Date(now.getTime() - ms))}::uuid`;
}

function instant(now: Date): SQL {
  return sql`${now.toISOString()}::timestamptz`;
}

// The rows a delete or update statement changed.
async function changed(ctx: JobContext, statement: SQL): Promise<number> {
  const result = await ctx.db.execute<never>(statement);
  return result.rowCount ?? 0;
}

const H1: RetentionRule = {
  id: 'H1',
  scope: 'hourly',
  tables: ['rate_limits'],
  run: (ctx, now) => {
    const cutoff = before(now, RATE_LIMIT_KEEP_MS);
    // index: rate_limits_window. The window is the key's last segment (T-rate_limits).
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from rate_limits where (key, window_start) in (
                select key, window_start from rate_limits
                where window_start < ${cutoff}
                  and window_start + (case
                        when key like '%:1m' then interval '1 minute'
                        when key like '%:1h' then interval '1 hour'
                        else interval '1 day' end) < ${cutoff}
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

const H2: RetentionRule = {
  id: 'H2',
  scope: 'hourly',
  tables: ['auth_challenges'],
  run: (ctx, now) => {
    const cutoff = before(now, CHALLENGE_KEEP_MS);
    // index: auth_challenges_expires
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from auth_challenges where id in (
                select id from auth_challenges where expires_at < ${cutoff}
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

const H3: RetentionRule = {
  id: 'H3',
  scope: 'hourly',
  tables: ['email_codes'],
  run: (ctx, now) => {
    const floor = floorBefore(now, EMAIL_CODE_KEEP_MS);
    // index: email_codes_pkey
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from email_codes where id in (
                select id from email_codes where id < ${floor}
                order by id limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

const H4: RetentionRule = {
  id: 'H4',
  scope: 'hourly',
  tables: ['uploads'],
  run: (ctx, now) => {
    const cutoff = before(now, UNCONSUMED_UPLOAD_KEEP_MS);
    // A batch is the most keys one DeleteObjects call takes.
    return runBatches(async () => {
      // index: uploads_unconsumed
      const rows = await ctx.db.execute<{ id: string; key: string }>(
        sql`select id::text as id, key from uploads
            where consumed_at is null and object_deleted_at is null and created_at < ${cutoff}
            order by created_at limit ${DELETE_BATCH_MAX}`,
        'objects',
      );
      if (rows.length === 0) {
        return 0;
      }
      await deleteKeys(
        ctx.storage.media,
        rows.map((row) => row.key),
        { signal: ctx.signal, afterBatch: () => ctx.touch() },
      );
      // Re-checked, so an upload consumed since the select keeps its row as it is.
      return changed(
        ctx,
        sql`update uploads set object_deleted_at = ${instant(now)}
            where id in ${rows.map((row) => row.id)}
              and consumed_at is null and object_deleted_at is null`,
      );
    }, ctx);
  },
};

const H5: RetentionRule = {
  id: 'H5',
  scope: 'hourly',
  tables: ['data_exports'],
  run: (ctx, now) => {
    const cutoff = before(now, EXPORT_FILE_TTL_MS);
    return runBatches(async () => {
      // index: data_exports_ready
      const rows = await ctx.db.execute<{ id: string; object_key: string | null }>(
        sql`select id::text as id, object_key from data_exports
            where status = 'ready' and ready_at < ${cutoff}
            limit ${DELETE_BATCH_MAX}`,
        'objects',
      );
      if (rows.length === 0) {
        return 0;
      }
      const keys = rows.flatMap((row) => (row.object_key === null ? [] : [row.object_key]));
      if (keys.length > 0) {
        await deleteKeys(ctx.storage.media, keys, {
          signal: ctx.signal,
          afterBatch: () => ctx.touch(),
        });
      }
      return changed(
        ctx,
        sql`update data_exports set status = 'expired'
            where id in ${rows.map((row) => row.id)} and status = 'ready'`,
      );
    }, ctx);
  },
};

// Marks one unfinished sign-up deleting and enqueues its deletion in the same transaction, so a
// rollback cancels the job. True when this call marked it.
async function finishUnfinishedSignup(ctx: JobContext, userId: string): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const { marked } = await markAccountDeleting(tx, userId);
    if (marked) {
      await ctx.enqueue('account.delete', { userId, skipDeferral: false }, { tx });
    }
    return marked;
  });
}

const H9: RetentionRule = {
  id: 'H9',
  scope: 'hourly',
  tables: ['users'],
  run: (ctx, now) => {
    const cutoff = before(now, UNFINISHED_SIGNUP_KEEP_MS);
    return runBatches(async () => {
      // index: users_age_unset
      const rows = await ctx.db.execute<{ id: string }>(
        sql`select id::text as id from users
            where age_method is null and created_at < ${cutoff} and status <> 'deleting'
              and not exists (select 1 from sessions s where s.user_id = users.id)
            limit ${RETENTION_BATCH_MAX}`,
        'objects',
      );
      // One transaction per account: a failure on one id leaves the others marked.
      let marked = 0;
      for (const row of rows) {
        if (await finishUnfinishedSignup(ctx, row.id)) {
          marked += 1;
        }
      }
      return marked;
    }, ctx);
  },
};

const N1: RetentionRule = {
  id: 'N1',
  scope: 'nightly',
  tables: ['sessions'],
  run: async (ctx, now) => {
    const expired = await runBatches(
      () =>
        // index: sessions_expires
        changed(
          ctx,
          sql`delete from sessions where id in (
                select id from sessions where expires_at < ${instant(now)}
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
    const floor = floorBefore(now, SESSION_ABSOLUTE_MAX_MS);
    const pastMax = await runBatches(
      () =>
        // index: sessions_pkey
        changed(
          ctx,
          sql`delete from sessions where id in (
                select id from sessions where id < ${floor}
                order by id limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
    return expired + pastMax;
  },
};

const N2: RetentionRule = {
  id: 'N2',
  scope: 'nightly',
  tables: ['reserved_handles'],
  run: (ctx, now) =>
    runBatches(
      () =>
        // index: reserved_handles_until
        changed(
          ctx,
          sql`delete from reserved_handles where handle_hash in (
                select handle_hash from reserved_handles where reserved_until < ${instant(now)}
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    ),
};

const N3: RetentionRule = {
  id: 'N3',
  scope: 'nightly',
  tables: ['uploads'],
  run: (ctx, now) => {
    const floor = floorBefore(now, UPLOAD_ROW_KEEP_MS);
    // index: uploads_pkey
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from uploads where id in (
                select id from uploads where id < ${floor} and object_deleted_at is not null
                order by id limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

const N4: RetentionRule = {
  id: 'N4',
  scope: 'nightly',
  tables: ['data_exports'],
  run: (ctx, now) => {
    const floor = floorBefore(now, EXPORT_ROW_KEEP_MS);
    // index: data_exports_pkey. The objects went with H5.
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from data_exports where id in (
                select id from data_exports where id < ${floor}
                order by id limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

const N5: RetentionRule = {
  id: 'N5',
  scope: 'nightly',
  tables: ['client_errors'],
  run: (ctx, now) => {
    const cutoff = before(now, CLIENT_ERROR_KEEP_MS);
    // index: client_errors_created
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from client_errors where id in (
                select id from client_errors where created_at < ${cutoff}
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

const N6: RetentionRule = {
  id: 'N6',
  scope: 'nightly',
  tables: ['app_events'],
  run: async (ctx) => {
    // index: the catalog. The function compares with the database clock (L-partitions).
    const rows = await ctx.db.execute<{ dropped: number }>(
      sql`select os_drop_month_partitions('app_events', ${APP_EVENT_KEEP_DAYS}::int) as dropped`,
      'objects',
    );
    await ctx.touch();
    return rows[0]?.dropped ?? 0;
  },
};

const N7: RetentionRule = {
  id: 'N7',
  scope: 'nightly',
  tables: ['usage_counters'],
  run: (ctx, now) =>
    runBatches(
      () =>
        // index: usage_counters_pkey, the whole table. The month is the UTC month of `now`.
        changed(
          ctx,
          sql`delete from usage_counters where (name, period) in (
                select name, period from usage_counters
                where period < (date_trunc('month', ${instant(now)} at time zone 'UTC')
                                - make_interval(months => ${USAGE_COUNTER_KEEP_MONTHS}::int))::date
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    ),
};

/** Every retention rule, in the order a run applies them. */
export const RETENTION_RULES: readonly RetentionRule[] = [
  H1,
  H2,
  H3,
  H4,
  H5,
  H9,
  N1,
  N2,
  N3,
  N4,
  N5,
  N6,
  N7,
];

/**
 * J-cleanup.retention: runs every rule of the payload's scope against one instant, each a loop of
 * bounded statements, and logs the rows each changed. A rule that throws makes the job retry; every
 * rule is empty on a second run.
 */
export const cleanupRetention: JobDefinition<'cleanup.retention'> = {
  name: 'cleanup.retention',
  queue: QUEUE_OPTIONS['cleanup.retention'].queue,
  work: QUEUE_OPTIONS['cleanup.retention'].work,
  async handle(payload, ctx) {
    // Read once: every statement of the run binds this instant.
    const now = ctx.now.call(ctx);
    for (const rule of RETENTION_RULES) {
      if (rule.scope !== payload.scope) {
        continue;
      }
      const rows = await rule.run(ctx, now);
      ctx.log.info('retention.rule_done', { rule: rule.id, rows });
    }
  },
};
