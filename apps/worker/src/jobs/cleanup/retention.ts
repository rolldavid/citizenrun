import { CLIENT_ERRORS_RETENTION_DAYS, markAccountDeleting } from '@citizenrun/db';
import {
  BundleManifestSchema,
  EXPORT_FILE_TTL_MS,
  SESSION_ABSOLUTE_MAX_MS,
  uuidFloor,
} from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import {
  DELETE_BATCH_MAX,
  deleteKeys,
  deletePrefix,
  getObjectBytes,
  listKeys,
  listPrefixes,
} from '../../lib/bucket-ops.ts';
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
/** Bundle changes are kept for the newest seven loaded bundles of each kind. */
export const BUNDLE_CHANGES_KEEP_LOADS = 7; // J-cleanup.retention N8
/** Bundle folders are kept thirty days after their version time. */
export const BUNDLE_FILES_KEEP_DAYS = 30; // J-cleanup.retention N9
/** The newest two loaded bundles of each kind keep their folders whatever their age. */
export const BUNDLE_FILES_KEEP_LOADED = 2; // J-cleanup.retention N9
/** Field-report export folders are kept ninety days after their date. */
export const FIELD_REPORT_EXPORTS_KEEP_DAYS = 90; // J-cleanup.retention N11
/** A field report is kept a year after its decision. */
export const FIELD_REPORT_KEEP_YEARS = 1; // J-cleanup.retention N12

// The largest manifest N9 reads.
const MANIFEST_MAX_BYTES = 10_000_000; // J-cleanup.retention N9
const BUNDLES_PREFIX = 'bundles/';
const FIELD_REPORTS_PREFIX = 'field-reports/';
// A bundle folder's name (B-manifest "Version"); `index`, a `sample-` version and anything else
// never match, so they are never deleted.
const BUNDLE_VERSION = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(full|filings|geometry)$/;
// A geometry file an earlier geometry version holds, as a geometry manifest names it (B-geometry).
const EARLIER_GEOMETRY_PATH = /^\.\.\/(\d{8}T\d{6}Z-geometry)\/geometry\/[A-Z]{2}\.ndjson\.gz$/;
const EXPORT_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The id of a retention rule (J-cleanup.retention). */
export type RetentionRuleId =
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H9'
  | 'N1'
  | 'N2'
  | 'N3'
  | 'N4'
  | 'N5'
  | 'N6'
  | 'N7'
  | 'N8'
  | 'N9'
  | 'N11'
  | 'N12';

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

const N8: RetentionRule = {
  id: 'N8',
  scope: 'nightly',
  tables: ['bundle_changes'],
  run: async (ctx) => {
    // index: data_bundles_loaded. Every bundle but the newest seven loaded of its kind; the rows of
    // a `loading` bundle stay, since its upsert may have committed them and a revert needs them.
    const purge = await ctx.db.execute<{ id: string }>(
      sql`select id::text as id from data_bundles
          where status <> 'loading'
            and id not in (
              select id from (
                select id, row_number() over (partition by kind order by loaded_at desc) as rn
                from data_bundles where status = 'loaded') k
              where rn <= ${BUNDLE_CHANGES_KEEP_LOADS})`,
      'objects',
    );
    if (purge.length === 0) {
      return 0;
    }
    const ids = sql.param(purge.map((row) => row.id));
    // index: bundle_changes_bundle
    return runBatches(
      () =>
        changed(
          ctx,
          sql`delete from bundle_changes where id in (
                select id from bundle_changes where bundle_id = any(${ids}::uuid[])
                limit ${RETENTION_BATCH_MAX})`,
        ),
      ctx,
    );
  },
};

// The instant a bundle version names: its first 16 characters, `YYYYMMDDTHHMMSSZ`.
function versionTime(version: string): number | null {
  const parts = BUNDLE_VERSION.exec(version);
  if (parts === null) {
    return null;
  }
  const [, y, mo, d, h, mi, sec] = parts.map(Number);
  const at = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 0, h ?? 0, mi ?? 0, sec ?? 0);
  return Number.isNaN(at) ? null : at;
}

// The bundle folders of the `data` bucket, by version: only names a bundle version can have.
async function bundleFolders(ctx: JobContext): Promise<Map<string, number>> {
  const folders = new Map<string, number>();
  for await (const prefix of listPrefixes(ctx.storage.data, BUNDLES_PREFIX, ctx.signal)) {
    const name = prefix.slice(BUNDLES_PREFIX.length, -1);
    const at = versionTime(name);
    if (at !== null) {
      folders.set(name, at);
    }
  }
  return folders;
}

// The versions N9 keeps whatever their age: the newest two loaded bundles of each kind that are
// not the sample, and every bundle an approval or a load may still read.
async function protectedVersions(ctx: JobContext): Promise<Set<string>> {
  // index: data_bundles_version_key, data_bundles_loaded
  const rows = await ctx.db.execute<{ version: string }>(
    sql`select version from (
          select version,
                 row_number() over (partition by kind order by version desc) as rn
          from data_bundles where status = 'loaded' and version not like 'sample-%') k
        where rn <= ${BUNDLE_FILES_KEEP_LOADED}
        union
        select version from data_bundles where status in ('loading', 'held')`,
    'objects',
  );
  return new Set(rows.map((row) => row.version));
}

type ManifestRead =
  | { kind: 'read'; geometryVersion: string | null; paths: string[] }
  | { kind: 'unreadable' }
  | { kind: 'empty' };

// True when no object is left under the folder: a store may list a folder whose objects are gone.
async function isEmptyFolder(ctx: JobContext, version: string): Promise<boolean> {
  const keys = listKeys(ctx.storage.data, `${BUNDLES_PREFIX}${version}/`, ctx.signal);
  const iterator = keys[Symbol.asyncIterator]();
  const first = await iterator.next();
  await iterator.return?.();
  return first.done === true;
}

// A folder's manifest; `unreadable` when it cannot be read or does not parse, and `empty` when the
// folder holds no object at all, so there is nothing in it to keep. Never throws.
async function readManifest(ctx: JobContext, version: string): Promise<ManifestRead> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(
      ctx.storage.data,
      `${BUNDLES_PREFIX}${version}/manifest.json`,
      MANIFEST_MAX_BYTES,
      ctx.signal,
    );
  } catch {
    try {
      return (await isEmptyFolder(ctx, version)) ? { kind: 'empty' } : { kind: 'unreadable' };
    } catch {
      return { kind: 'unreadable' };
    }
  }
  try {
    const parsed = BundleManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success
      ? {
          kind: 'read',
          geometryVersion: parsed.data.geometry_version,
          paths: parsed.data.files.map((file) => file.path),
        }
      : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

const N9: RetentionRule = {
  id: 'N9',
  scope: 'nightly',
  tables: [],
  run: async (ctx, now) => {
    const folders = await bundleFolders(ctx);
    const cutoff = now.getTime() - BUNDLE_FILES_KEEP_DAYS * DAY_MS;
    const isOld = (version: string): boolean => (folders.get(version) ?? cutoff) < cutoff;
    const kindOf = (version: string): string => version.slice(version.lastIndexOf('-') + 1);
    const guarded = await protectedVersions(ctx);
    const kept = new Set([...folders.keys()].filter((v) => !isOld(v) || guarded.has(v)));
    await ctx.touch();

    // A kept manifest that cannot be read keeps every geometry folder for this run.
    const unreadableManifests: string[] = [];
    const unreadable = (version: string): void => {
      unreadableManifests.push(version);
      ctx.log.warn('retention.manifest_unreadable', { version });
    };
    // A kept full bundle keeps the geometry version its manifest names.
    for (const version of [...kept].filter((v) => kindOf(v) === 'full')) {
      const manifest = await readManifest(ctx, version);
      if (manifest.kind === 'unreadable') {
        unreadable(version);
      } else if (manifest.kind === 'read' && manifest.geometryVersion !== null) {
        kept.add(manifest.geometryVersion);
      }
    }
    // A kept geometry version keeps every earlier version whose files its manifest names.
    const geometryKept = [...kept].filter((v) => kindOf(v) === 'geometry' && folders.has(v));
    for (const version of geometryKept) {
      const manifest = await readManifest(ctx, version);
      if (manifest.kind === 'unreadable') {
        unreadable(version);
      }
      if (manifest.kind !== 'read') {
        continue;
      }
      for (const path of manifest.paths) {
        const earlier = EARLIER_GEOMETRY_PATH.exec(path)?.[1];
        if (earlier !== undefined) {
          kept.add(earlier);
        }
      }
    }
    await ctx.touch();

    let deleted = 0;
    for (const version of folders.keys()) {
      if (!isOld(version) || kept.has(version)) {
        continue;
      }
      if (unreadableManifests.length > 0 && kindOf(version) === 'geometry') {
        continue;
      }
      // Nothing under assets/ is ever listed or deleted here (D-497).
      deleted += await deletePrefix(ctx.storage.data, `${BUNDLES_PREFIX}${version}/`, {
        signal: ctx.signal,
        afterBatch: () => ctx.touch(),
      });
    }
    return deleted;
  },
};

// Days from the UTC date `YYYY-MM-DD` to the UTC date of `now`, or null for a name that is no date.
function daysBefore(date: string, now: Date): number | null {
  const parts = EXPORT_DATE.exec(date);
  if (parts === null) {
    return null;
  }
  const [, y, mo, d] = parts.map(Number);
  const at = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 0);
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== date) {
    return null;
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - at) / DAY_MS);
}

const N11: RetentionRule = {
  id: 'N11',
  scope: 'nightly',
  tables: [],
  run: async (ctx, now) => {
    const old: string[] = [];
    for await (const prefix of listPrefixes(ctx.storage.data, FIELD_REPORTS_PREFIX, ctx.signal)) {
      const days = daysBefore(prefix.slice(FIELD_REPORTS_PREFIX.length, -1), now);
      if (days !== null && days > FIELD_REPORT_EXPORTS_KEEP_DAYS) {
        old.push(prefix);
      }
    }
    let deleted = 0;
    for (const prefix of old) {
      deleted += await deletePrefix(ctx.storage.data, prefix, {
        signal: ctx.signal,
        afterBatch: () => ctx.touch(),
      });
    }
    return deleted;
  },
};

const N12: RetentionRule = {
  id: 'N12',
  scope: 'nightly',
  tables: ['field_reports'],
  run: (ctx, now) =>
    runBatches(
      () =>
        // index: field_reports_decided
        changed(
          ctx,
          sql`delete from field_reports where id in (
                select id from field_reports
                where decided_at < ${instant(now)} - make_interval(years => ${FIELD_REPORT_KEEP_YEARS}::int)
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
  N8,
  N9,
  N11,
  N12,
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
