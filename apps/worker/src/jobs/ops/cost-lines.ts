import type { JobContext } from '../../context.ts';
import { listAllObjects } from '../../lib/storage.ts';

/** Bytes in one gigabyte, as the storage provider bills it. */
export const BYTES_PER_GB = 1_000_000_000; // OPS-cost-thresholds
/** Object storage price: $0.015 per GB a month. */
export const STORAGE_CENTS_PER_GB_MONTH = 1.5; // J-cost.check
/** The storage line alerts above a projected $10 a month. */
export const STORAGE_THRESHOLD_CENTS = 1_000; // J-cost.check

/** One cost line's reading: its value, its projection and threshold, and whether it is over. */
export type CostLineResult = {
  line: 'storage';
  value: number;
  projected: number;
  threshold: number;
  over: boolean;
};

/** A line of the daily spend projection (D-405). */
export type CostLine = {
  line: CostLineResult['line'];
  compute(ctx: JobContext): Promise<CostLineResult>;
};

/**
 * The monthly storage cost of `totalBytes` in whole cents, rounded up: 1.5 cents per GB, in integer
 * arithmetic (3 / 2 cents per BYTES_PER_GB bytes). Zero bytes cost zero.
 */
export function storageProjectionCents(totalBytes: number): number {
  return Math.ceil((totalBytes * 3) / (2 * BYTES_PER_GB));
}

/**
 * The `storage` line: total bytes of every object in the `backups` bucket and their projected
 * monthly cost in cents, over above STORAGE_THRESHOLD_CENTS. The `legal` bucket is never listed
 * (INV-43). A listing error is thrown.
 */
export const storageLine: CostLine = {
  line: 'storage',
  async compute(ctx) {
    let totalBytes = 0;
    for await (const object of listAllObjects(ctx.storage.backups, '')) {
      totalBytes += object.size;
    }
    const projected = storageProjectionCents(totalBytes);
    return {
      line: 'storage',
      value: totalBytes,
      projected,
      threshold: STORAGE_THRESHOLD_CENTS,
      over: projected > STORAGE_THRESHOLD_CENTS,
    };
  },
};

/** Every cost line J-cost.check reads. */
export const COST_LINES: readonly CostLine[] = [storageLine];
