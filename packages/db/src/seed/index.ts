import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvError, assertNever, createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { createDb, createPool } from '../client.ts';
import type { Db, Tx } from '../client.ts';
import { loadDbEnv, loadSeedMediaEnv } from '../env.ts';
import type { AppEnv } from '../env.ts';
import { createEnqueue } from '../queue/enqueue.ts';
import type { Enqueue } from '../queue/enqueue.ts';
import type { SeedMedia } from './step.ts';
import { step as sanity } from './steps/000-sanity.ts';
import { step as users } from './steps/010-users.ts';
import { step as sampleBundle } from './steps/020-sample-bundle.ts';
import { step as locations } from './steps/030-locations.ts';

export { SeedError } from './step.ts';
export type { SeedMedia } from './step.ts';

/** What every step receives: the run's anchor minute, the media bucket, the enqueue helper and the run's logger. */
export type SeedContext = {
  readonly anchor: Date;
  readonly media: SeedMedia;
  readonly enqueue: Enqueue;
  readonly log: Logger;
};

/**
 * One seed step, idempotent at the run's anchor. It runs inside its own transaction, unless it
 * declares `ownTransactions: true`: then it gets the runner's `db` and opens its own, as step 020
 * does, whose loader commits in several transactions.
 */
export type SeedStep =
  | {
      readonly name: string;
      readonly ownTransactions?: false;
      run(tx: Tx, ctx: SeedContext): Promise<void>;
    }
  | {
      readonly name: string;
      readonly ownTransactions: true;
      run(db: Db, ctx: SeedContext): Promise<void>;
    };

/** The queues the seed's steps send to, created when missing (the seed runs before the worker). */
export const SEED_QUEUES = ['score.issues'] as const;

/** Creates each queue of SEED_QUEUES that pg-boss does not find, with pg-boss's default options. */
export async function ensureSeedQueues(boss: PgBoss): Promise<void> {
  for (const name of SEED_QUEUES) {
    if ((await boss.getQueue(name)) === null) {
      await boss.createQueue(name);
    }
  }
}

/** The seed refused to run in this environment. Holds no connection detail. */
export class SeedRefusedError extends Error {
  override readonly name = 'SeedRefusedError';
}

const byName = (a: SeedStep, b: SeedStep): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Every step of `src/seed/steps/`, in file-name order. */
export const SEED_STEPS: readonly SeedStep[] = [sanity, users, sampleBundle, locations].sort(
  byName,
);

const MINUTE_MS = 60_000;

/**
 * Runs `steps` (default SEED_STEPS) on `db` in name order, each in its own transaction unless it
 * declares `ownTransactions: true`, with one anchor: `now` truncated to the minute in UTC (TC-08),
 * the media bucket the steps write their images to and the enqueue helper they send with.
 * Refuses with SeedRefusedError unless `appEnv` is `local`, `ci` or `staging`, and on `staging`
 * only with `allowStaging` and while no `data_bundles` row exists (TC-11). Resolves with the names
 * of the steps run.
 */
export async function runSeed(
  db: Db,
  options: {
    appEnv: AppEnv;
    allowStaging: boolean;
    now: Date;
    media: SeedMedia;
    enqueue: Enqueue;
    log?: Logger;
    steps?: readonly SeedStep[];
  },
): Promise<{ ran: string[] }> {
  switch (options.appEnv) {
    case 'local':
    case 'ci':
      break;
    case 'staging':
      if (!options.allowStaging) {
        throw new SeedRefusedError('The seed runs on staging only with --allow-staging.');
      }
      if (await holdsBundles(db)) {
        throw new SeedRefusedError('staging already holds bundles');
      }
      break;
    case 'production':
      throw new SeedRefusedError('The seed never runs in production.');
    default:
      return assertNever(options.appEnv);
  }
  const anchor = new Date(Math.floor(options.now.getTime() / MINUTE_MS) * MINUTE_MS);
  const ordered = [...(options.steps ?? SEED_STEPS)].sort(byName);
  const ran: string[] = [];
  const ctx: SeedContext = {
    anchor,
    media: options.media,
    enqueue: options.enqueue,
    log: options.log ?? createLogger({ service: 'api', level: 'info' }),
  };
  for (const step of ordered) {
    if (step.ownTransactions === true) {
      await step.run(db, ctx);
    } else {
      await db.transaction(async (tx) => {
        await step.run(tx, ctx);
      });
    }
    ran.push(step.name);
  }
  return { ran };
}

async function holdsBundles(db: Db): Promise<boolean> {
  const [row] = await db.execute<{ present: boolean }>(
    sql`select exists (select 1 from data_bundles) as present`,
    'objects',
  );
  return row?.present === true;
}

// The `seed` script (`pnpm db:seed`). Exit codes: 0 done, 1 failed, 2 refused or bad environment.
async function main(): Promise<number> {
  let env;
  let mediaEnv;
  try {
    env = loadDbEnv();
    mediaEnv = loadSeedMediaEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      createLogger({ service: 'api', level: 'info' }).error('seed.env_invalid', {
        variables: error.variables,
      });
      return 2;
    }
    throw error;
  }
  const logger = createLogger({ service: 'api', level: env.logLevel });
  const pool = createPool(env.databaseUrl, { max: 1, applicationName: 'os-seed' });
  const client = createS3Client(mediaEnv);
  // A send-only boss: the seed runs before the worker, so it creates the queues it sends to.
  const boss = new PgBoss({
    connectionString: env.databaseUrl,
    application_name: 'os-seed-boss',
    max: 1,
    supervise: false,
    schedule: false,
    migrate: false,
  });
  boss.on('error', () => undefined);
  try {
    await boss.start();
    await ensureSeedQueues(boss);
    const { ran } = await runSeed(createDb(pool), {
      appEnv: env.appEnv,
      allowStaging: process.argv.includes('--allow-staging'),
      now: new Date(),
      media: { client, bucket: mediaEnv.bucket },
      enqueue: createEnqueue(boss),
      log: logger,
    });
    logger.info('seed.done', { ran });
    return 0;
  } catch (error) {
    if (error instanceof SeedRefusedError) {
      logger.error('seed.refused', { appEnv: env.appEnv });
      return 2;
    }
    logger.error('seed.failed', { error });
    return 1;
  } finally {
    await boss.stop({ graceful: false }).catch(() => undefined);
    client.destroy();
    await pool.end().catch(() => undefined);
  }
}

function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  process.exitCode = await main();
}
