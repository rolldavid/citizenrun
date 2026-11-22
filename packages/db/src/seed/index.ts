import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvError, assertNever, createLogger } from '@citizenrun/shared';
import { createDb, createPool } from '../client.ts';
import type { Db } from '../client.ts';
import { loadDbEnv } from '../env.ts';
import type { AppEnv } from '../env.ts';
import type { SeedStep } from './step.ts';
import { step as sanity } from './steps/000-sanity.ts';

export { SeedError } from './step.ts';
export type { SeedStep } from './step.ts';

/** The seed refused to run in this environment. Holds no connection detail. */
export class SeedRefusedError extends Error {
  override readonly name = 'SeedRefusedError';
}

const byName = (a: SeedStep, b: SeedStep): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Every step of `src/seed/steps/`, in file-name order. */
export const SEED_STEPS: readonly SeedStep[] = [sanity].sort(byName);

const MINUTE_MS = 60_000;

/**
 * Runs `steps` (default SEED_STEPS) on `db` in name order, each in its own transaction, with one
 * anchor: `now` truncated to the minute in UTC (TC-08). Refuses with SeedRefusedError unless
 * `appEnv` is `local`, `ci` or `staging`, and on `staging` only with `allowStaging`. Resolves
 * with the names of the steps run.
 */
export async function runSeed(
  db: Db,
  options: { appEnv: AppEnv; allowStaging: boolean; now: Date; steps?: readonly SeedStep[] },
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
      await step.run(tx, { anchor });
    });
    ran.push(step.name);
  }
  return { ran };
}

// The `seed` script (`pnpm db:seed`). Exit codes: 0 done, 1 failed, 2 refused or bad environment.
async function main(): Promise<number> {
  let env;
  try {
    env = loadDbEnv();
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
  try {
    const { ran } = await runSeed(createDb(pool), {
      appEnv: env.appEnv,
      allowStaging: process.argv.includes('--allow-staging'),
      now: new Date(),
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
