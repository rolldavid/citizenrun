import { insertLoadingBundle } from '@citizenrun/db/bundle';
import {
  BUNDLE_SCHEMA_VERSION,
  BundlePointerSchema,
  LOADER_SCHEMA_REVISION,
  LoaderInfoSchema,
} from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { ObjectTooLargeError, getObjectBytes, putObject } from '../../lib/bucket-ops.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';
import { isMissingObject } from './io.ts';

// J-bundle.poll: writes the loader's revision for the bundle writer, starts the load of a newer
// full bundle the pointer names, and raises the stale-bundle alarm (D-145, D-458).

export const LOADER_INFO_KEY = 'bundles/index/loader.json';
export const FULL_POINTER_KEY = 'bundles/index/full.json';
export const INDEX_FILE_MAX_BYTES = 65_536;
export const BUNDLE_STALE_HOURS = 48; // D-145 (c)

const HOUR_MS = 3_600_000;
const STALE_ALERT_WINDOW_SECONDS = 86_400; // J-ops.alert: bundle_stale

type Pointer = { kind: 'none' } | { kind: 'invalid' } | { kind: 'full'; version: string };

async function writeLoaderInfo(ctx: JobContext): Promise<void> {
  const info = LoaderInfoSchema.parse({
    schema_version: BUNDLE_SCHEMA_VERSION,
    schema_revision: LOADER_SCHEMA_REVISION,
    updated_at: ctx.now().toISOString(),
  });
  await putObject(
    ctx.storage.data,
    LOADER_INFO_KEY,
    new TextEncoder().encode(JSON.stringify(info)),
    { contentType: 'application/json' },
    ctx.signal,
  );
}

function invalidIndexFile(ctx: JobContext): Pointer {
  // The key only: the file's bytes are never logged.
  ctx.log.warn('index_file.invalid', { objectKey: FULL_POINTER_KEY });
  return { kind: 'invalid' };
}

async function readPointer(ctx: JobContext): Promise<Pointer> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(
      ctx.storage.data,
      FULL_POINTER_KEY,
      INDEX_FILE_MAX_BYTES,
      ctx.signal,
    );
  } catch (error) {
    if (isMissingObject(error)) {
      return { kind: 'none' };
    }
    if (error instanceof ObjectTooLargeError) {
      return invalidIndexFile(ctx);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalidIndexFile(ctx);
  }
  const pointer = BundlePointerSchema.safeParse(parsed);
  if (!pointer.success) {
    return invalidIndexFile(ctx);
  }
  if (pointer.data.kind !== 'full') {
    ctx.log.warn('bundle.pointer_invalid', { objectKey: FULL_POINTER_KEY });
    return { kind: 'invalid' };
  }
  return { kind: 'full', version: pointer.data.version };
}

/** Inserts the `loading` row and sends its load when `version` is newer than every real full bundle. */
async function startNewer(ctx: JobContext, version: string): Promise<boolean> {
  // index: data_bundles_version_key. A sample- version sorts above every real one (D-458).
  const [newest] = await ctx.db.execute<{ v: string | null }>(
    sql`select max(version) as v from data_bundles
        where kind = 'full' and version not like 'sample-%'`,
    'objects',
  );
  const latest = newest?.v ?? null;
  // String order is time order; a row of any status counts.
  if (latest !== null && version <= latest) {
    return false;
  }
  const bundleId = await ctx.db.transaction(async (tx) => {
    const id = await insertLoadingBundle(tx, { version, kind: 'full' });
    if (id !== null) {
      await ctx.enqueue(
        'bundle.load',
        { bundleId: id, mode: 'new' },
        { tx, singletonKey: `bundle:${version}` },
      );
    }
    return id;
  });
  return bundleId !== null;
}

/** The bundle alarm, armed once the environment has loaded its first real full bundle. */
async function checkStale(ctx: JobContext): Promise<void> {
  // index: data_bundles_loaded
  const [newest] = await ctx.db.execute<{ t_ms: number | null }>(
    sql`select (extract(epoch from max(loaded_at)) * 1000)::float8 as t_ms from data_bundles
        where kind = 'full' and status = 'loaded' and version not like 'sample-%'`,
    'objects',
  );
  const loadedMs = newest?.t_ms ?? null;
  if (loadedMs === null) {
    return;
  }
  const sinceMs = ctx.now().getTime() - loadedMs;
  if (sinceMs <= BUNDLE_STALE_HOURS * HOUR_MS) {
    return;
  }
  // A throttled send returns null; that is success.
  await ctx.enqueue(
    'ops.alert',
    { kind: 'bundle_stale', values: { hoursSince: Math.floor(sinceMs / HOUR_MS) } },
    { throttle: { seconds: STALE_ALERT_WINDOW_SECONDS, key: 'bundle_stale' } },
  );
}

export const bundlePoll: JobDefinition<'bundle.poll'> = {
  name: 'bundle.poll',
  queue: QUEUE_OPTIONS['bundle.poll'].queue,
  work: QUEUE_OPTIONS['bundle.poll'].work,
  async handle(_payload, ctx) {
    // Before anything else, on every run: without it the bundle writer publishes nothing.
    await writeLoaderInfo(ctx);
    const pointer = await readPointer(ctx);
    let outcome: 'none' | 'invalid' | 'current' | 'new' =
      pointer.kind === 'none' ? 'none' : 'invalid';
    if (pointer.kind === 'full') {
      outcome = (await startNewer(ctx, pointer.version)) ? 'new' : 'current';
    }
    await checkStale(ctx);
    if (outcome === 'new' && pointer.kind === 'full') {
      ctx.log.info('bundle.poll.done', { pointer: outcome, version: pointer.version });
    } else {
      ctx.log.info('bundle.poll.done', { pointer: outcome });
    }
  },
};
