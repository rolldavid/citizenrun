import type { Db } from '@citizenrun/db';
import { sql } from 'drizzle-orm';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

/** Client connections at which the daily check alerts. */
export const CONNECTIONS_ALERT_AT = 80; // D-138
/** The database's connection limit, named in the alert. */
export const CONNECTIONS_MAX = 100; // D-136

// One connections_high email a day.
const CONNECTIONS_HIGH_THROTTLE_SECONDS = 86_400;

/** Counts the database's client connections. */
export type ConnectionCounter = (db: Db) => Promise<number>;

/** The client backends in pg_stat_activity: every connection but the server's own processes. */
export const countClientConnections: ConnectionCounter = async (db) => {
  const rows = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from pg_stat_activity where backend_type = 'client backend'`,
    'objects',
  );
  const count = rows[0]?.count;
  if (typeof count !== 'number') {
    throw new TypeError('pg_stat_activity gave no count');
  }
  return count;
};

/**
 * J-db.connections-check over `count` (default countClientConnections): at 80 or more client
 * connections it raises `connections_high` with the count and the limit of 100 (D-138, D-136).
 */
export function createConnectionsCheckJob(
  count: ConnectionCounter = countClientConnections,
): JobDefinition<'db.connections-check'> {
  return {
    name: 'db.connections-check',
    queue: QUEUE_OPTIONS['db.connections-check'].queue,
    work: QUEUE_OPTIONS['db.connections-check'].work,
    async handle(_payload, ctx) {
      const current = await count(ctx.db);
      if (current >= CONNECTIONS_ALERT_AT) {
        await ctx.enqueue(
          'ops.alert',
          { kind: 'connections_high', values: { count: current, max: CONNECTIONS_MAX } },
          { throttle: { seconds: CONNECTIONS_HIGH_THROTTLE_SECONDS, key: 'connections_high' } },
        );
      }
      ctx.log.info('connections.check.done', { count: current });
    },
  };
}

/** J-db.connections-check with the real counter. */
export const connectionsCheckJob: JobDefinition<'db.connections-check'> =
  createConnectionsCheckJob();
