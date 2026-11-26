import { dayPeriod, monthPeriod, usageCounters } from '@citizenrun/db';
import type { UsageCounterName } from '@citizenrun/db';
import { SIGNIN_EMAIL_ALERT_AT, uuidFloor } from '@citizenrun/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { listAllObjects } from '../../lib/storage.ts';
import type { Bucket } from '../../lib/storage.ts';

/** Bytes in one gigabyte, as the storage provider bills it. */
export const BYTES_PER_GB = 1_000_000_000; // OPS-cost-thresholds
/** Object storage price: $0.015 per GB a month. */
export const STORAGE_CENTS_PER_GB_MONTH = 1.5; // J-cost.check
/** The storage line alerts above a projected $10 a month. */
export const STORAGE_THRESHOLD_CENTS = 1_000; // J-cost.check
/** The upload line alerts above a projected 100 GB of new uploads a month. */
export const UPLOAD_GROWTH_MONTHLY_MAX_BYTES = 100 * BYTES_PER_GB; // J-cost.check upload_growth
/** The email lines alert at 80 per cent of their quota. */
export const EMAIL_QUOTA_ALERT_SHARE = 0.8; // J-cost.check email_month, email_day
/** The upload line multiplies a day's bytes by this many days. */
const UPLOAD_GROWTH_DAYS_A_MONTH = 30; // J-cost.check upload_growth

const DAY_MS = 24 * 60 * 60 * 1000;

/** One cost line's reading: its value, its projection and threshold, and whether it is over. */
export type CostLineResult = {
  line: 'storage' | 'upload_growth' | 'email_month' | 'email_day' | 'signin_ceiling';
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

/** Total bytes of every object in `buckets`; a listing error is thrown. */
export async function sumBucketBytes(buckets: readonly Bucket[]): Promise<number> {
  let totalBytes = 0;
  for (const bucket of buckets) {
    for await (const object of listAllObjects(bucket, '')) {
      totalBytes += object.size;
    }
  }
  return totalBytes;
}

/**
 * The `storage` line: total bytes of every object in the `backups` and `media` buckets and their
 * projected monthly cost in cents, over above STORAGE_THRESHOLD_CENTS. The `legal` bucket is never
 * listed (INV-43). A listing error is thrown.
 */
export const storageLine: CostLine = {
  line: 'storage',
  async compute(ctx) {
    const totalBytes = await sumBucketBytes([ctx.storage.backups, ctx.storage.media]);
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

/** Month-to-date projection: value × days in the UTC month ÷ the UTC day of the month. */
export function projectMonth(value: number, now: Date): number {
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return (value * daysInMonth) / now.getUTCDate();
}

/** The `upload_growth` line: a day's upload bytes × 30, over above UPLOAD_GROWTH_MONTHLY_MAX_BYTES. */
export function uploadGrowthLine(bytesLast24Hours: number): CostLineResult {
  const projected = bytesLast24Hours * UPLOAD_GROWTH_DAYS_A_MONTH;
  return {
    line: 'upload_growth',
    value: bytesLast24Hours,
    projected: Math.round(projected),
    threshold: Math.ceil(UPLOAD_GROWTH_MONTHLY_MAX_BYTES),
    over: projected > UPLOAD_GROWTH_MONTHLY_MAX_BYTES,
  };
}

/** The `email_month` line: this month's emails projected to the month's end, over at 80% of the quota. */
export function emailMonthLine(monthCount: number, quota: number, now: Date): CostLineResult {
  const projected = projectMonth(monthCount, now);
  const threshold = EMAIL_QUOTA_ALERT_SHARE * quota;
  return {
    line: 'email_month',
    value: monthCount,
    projected: Math.round(projected),
    threshold: Math.ceil(threshold),
    over: projected >= threshold,
  };
}

/** The `email_day` line: yesterday's emails, over at 80% of the daily quota; off at quota 0. */
export function emailDayLine(yesterdayCount: number, quota: number): CostLineResult {
  if (quota === 0) {
    // No daily quota (a paid plan): the line is off.
    return {
      line: 'email_day',
      value: yesterdayCount,
      projected: yesterdayCount,
      threshold: 0,
      over: false,
    };
  }
  const threshold = EMAIL_QUOTA_ALERT_SHARE * quota;
  return {
    line: 'email_day',
    value: yesterdayCount,
    projected: Math.round(yesterdayCount),
    threshold: Math.ceil(threshold),
    over: yesterdayCount >= threshold,
  };
}

/** The `signin_ceiling` line: yesterday's sign-in code emails, over at SIGNIN_EMAIL_ALERT_AT. */
export function signinCeilingLine(yesterdayCount: number): CostLineResult {
  return {
    line: 'signin_ceiling',
    value: yesterdayCount,
    projected: Math.round(yesterdayCount),
    threshold: Math.ceil(SIGNIN_EMAIL_ALERT_AT),
    over: yesterdayCount >= SIGNIN_EMAIL_ALERT_AT,
  };
}

// One usage counter's count for one period; a missing row is 0.
async function readCounter(
  ctx: JobContext,
  name: UsageCounterName,
  period: string,
): Promise<number> {
  // index: usage_counters_pkey
  const [row] = await ctx.db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(and(eq(usageCounters.name, name), eq(usageCounters.period, period)));
  return row?.count ?? 0;
}

/** The `upload_growth` line over the uploads created in the 24 hours before the job's `now`. */
export const uploadGrowthCostLine: CostLine = {
  line: 'upload_growth',
  async compute(ctx) {
    const floor = uuidFloor(new Date(ctx.now().getTime() - DAY_MS));
    // index: uploads_pkey. `bytes` is null until the upload is processed, which counts nothing.
    const rows = await ctx.db.execute<{ total: string | number }>(
      sql`select coalesce(sum(bytes), 0)::bigint as total from uploads where id >= ${floor}::uuid`,
      'objects',
    );
    return uploadGrowthLine(Number(rows[0]?.total ?? 0));
  },
};

/** The `email_month` line over this UTC month's `email.month` counter. */
export const emailMonthCostLine: CostLine = {
  line: 'email_month',
  async compute(ctx) {
    const now = ctx.now();
    const count = await readCounter(ctx, 'email.month', monthPeriod(now));
    return emailMonthLine(count, ctx.env.EMAIL_MONTHLY_QUOTA, now);
  },
};

/** The `email_day` line over yesterday's (UTC) `email.day` counter. */
export const emailDayCostLine: CostLine = {
  line: 'email_day',
  async compute(ctx) {
    const yesterday = new Date(ctx.now().getTime() - DAY_MS);
    const count = await readCounter(ctx, 'email.day', dayPeriod(yesterday));
    return emailDayLine(count, ctx.env.EMAIL_DAILY_QUOTA);
  },
};

/** The `signin_ceiling` line over yesterday's (UTC) `email.signin.day` counter. */
export const signinCeilingCostLine: CostLine = {
  line: 'signin_ceiling',
  async compute(ctx) {
    const yesterday = new Date(ctx.now().getTime() - DAY_MS);
    const count = await readCounter(ctx, 'email.signin.day', dayPeriod(yesterday));
    return signinCeilingLine(count);
  },
};

/** Every cost line J-cost.check reads. */
export const COST_LINES: readonly CostLine[] = [
  storageLine,
  uploadGrowthCostLine,
  emailMonthCostLine,
  emailDayCostLine,
  signinCeilingCostLine,
];
