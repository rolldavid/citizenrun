import type { EmailMessage, Logger, Mailer } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.ts';

/** The counter names the typed helpers take (T-usage_counters). */
export type UsageCounterName = 'email.day' | 'email.month' | 'email.signin.day';

/** The period of a daily counter: 'YYYY-MM-DD' of `now` in UTC. */
export function dayPeriod(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The period of a monthly counter: 'YYYY-MM-01' of `now` in UTC. */
export function monthPeriod(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

// The error's class name when it is a plain identifier, else 'Error'; never its message.
function errorClassOf(error: unknown): string {
  const name = error instanceof Error ? error.name : null;
  return name !== null && ERROR_CLASS_PATTERN.test(name) ? name : 'Error';
}

/** Adds `by` to one counter with the upsert of T-usage_counters and returns the new count. */
export async function addUsage(
  db: Db | Tx,
  name: UsageCounterName,
  period: string,
  by: number,
): Promise<number> {
  // `count` is a bigint, which the driver hands back as text.
  const rows = await db.execute<{ count: string | number }>(
    sql`insert into usage_counters (name, period, count) values (${name}, ${period}, ${by})
        on conflict (name, period) do update set count = usage_counters.count + excluded.count
        returning count`,
    'objects',
  );
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error('The counter upsert returned no row.');
  }
  return Number(count);
}

/** Adds 1 to email.day (today) and email.month (this month), in one statement. */
export async function countEmailSent(db: Db | Tx, now: Date): Promise<void> {
  await db.execute(
    sql`insert into usage_counters (name, period, count)
        values ('email.day', ${dayPeriod(now)}, 1), ('email.month', ${monthPeriod(now)}, 1)
        on conflict (name, period) do update set count = usage_counters.count + excluded.count`,
  );
}

/**
 * A Mailer whose sendEmail first delivers through `inner`, then counts (L-send-email, D-428). A
 * send that throws counts nothing; a counting failure is logged as `email.count_failed` (warn,
 * error class only) and never thrown, because the message is already handed over.
 */
export function withEmailCounters(
  inner: Mailer,
  db: Db,
  clock: { now(): Date },
  log: Logger,
): Mailer {
  return {
    sendEmail: async (message: EmailMessage) => {
      await inner.sendEmail(message);
      try {
        await countEmailSent(db, clock.now());
      } catch (error) {
        log.warn('email.count_failed', { errorClass: errorClassOf(error) });
      }
    },
  };
}
