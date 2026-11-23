import { listAllObjects } from '../../lib/storage.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

/** Where the backup service writes its dumps in the `backups` bucket. */
export const DUMP_PREFIX = 'pg/'; // OPS-backup-job
/** A newest dump older than this alerts; exactly this old does not. */
export const DUMP_MAX_AGE_HOURS = 36; // D-028

// One dump_stale email a day.
const DUMP_STALE_THROTTLE_SECONDS = 86_400;
const MS_PER_HOUR = 3_600_000;

/**
 * J-backup.check: finds the newest object under DUMP_PREFIX and raises `dump_stale` when there is
 * none or it is more than 36 hours old at the job clock's time (D-028, D-145). A listing error is
 * thrown, so pg-boss retries it.
 */
export const backupCheckJob: JobDefinition<'backup.check'> = {
  name: 'backup.check',
  queue: QUEUE_OPTIONS['backup.check'].queue,
  work: QUEUE_OPTIONS['backup.check'].work,
  async handle(_payload, ctx) {
    let newest: number | null = null;
    for await (const object of listAllObjects(ctx.storage.backups, DUMP_PREFIX)) {
      const modified = object.lastModified.getTime();
      if (newest === null || modified > newest) {
        newest = modified;
      }
    }
    const ageMs = newest === null ? null : ctx.now().getTime() - newest;
    const ageHours = ageMs === null ? null : Math.floor(ageMs / MS_PER_HOUR);
    const alerted = ageMs === null || ageMs > DUMP_MAX_AGE_HOURS * MS_PER_HOUR;
    if (alerted) {
      await ctx.enqueue(
        'ops.alert',
        { kind: 'dump_stale', values: { hoursSinceNewest: ageHours } },
        { throttle: { seconds: DUMP_STALE_THROTTLE_SECONDS, key: 'dump_stale' } },
      );
    }
    ctx.log.info('backup.check.done', { ageHours, alerted });
  },
};
