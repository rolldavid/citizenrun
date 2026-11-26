import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvError, assertNever, createLogger } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { createDb, createPool } from '../client.ts';
import type { Db } from '../client.ts';
import { loadDbEnv, loadSeedMediaEnv } from '../env.ts';
import type { AppEnv } from '../env.ts';
import type { SeedMedia, SeedStep } from './step.ts';
import { step as sanity } from './steps/000-sanity.ts';
import { step as users } from './steps/010-users.ts';

export { SeedError } from './step.ts';
export type { SeedContext, SeedMedia, SeedStep } from './step.ts';

/** The seed refused to run in this environment. Holds no connection detail. */
export class SeedRefusedError extends Error {
  override readonly name = 'SeedRefusedError';
}

const byName = (a: SeedStep, b: SeedStep): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Every step of `src/seed/steps/`, in file-name order. */
export const SEED_STEPS: readonly SeedStep[] = [sanity, users].sort(byName);

const MINUTE_MS = 60_000;

/**
 * Runs `steps` (default SEED_STEPS) on `db` in name order, each in its own transaction, with one
 * anchor: `now` truncated to the minute in UTC (TC-08), and the media bucket the steps write their
 * images to. Refuses with SeedRefusedError unless `appEnv` is `local`, `ci` or `staging`, and on
 * `staging` only with `allowStaging`. Resolves with the names of the steps run.
 */
export async function runSeed(
  db: Db,
  options: {
    appEnv: AppEnv;
    allowStaging: boolean;
    now: Date;
    media: SeedMedia;
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
      break;
    case 'production':
      throw new SeedRefusedError('The seed never runs in production.');
    default:
      return assertNever(options.appEnv);
  }
  const anchor = new Date(Math.floor(options.now.getTime() / MINUTE_MS) * MINUTE_MS);
  const ordered = [...(options.steps ?? SEED_STEPS)].sort(byName);
  const ran: string[] = [];
  for (const step of ordered) {
    await db.transaction(async (tx) => {
      await step.run(tx, { anchor, media: options.media });
    });
    ran.push(step.name);
  }
  return { ran };
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
  try {
    const { ran } = await runSeed(createDb(pool), {
      appEnv: env.appEnv,
      allowStaging: process.argv.includes('--allow-staging'),
      now: new Date(),
      media: { client, bucket: mediaEnv.bucket },
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
