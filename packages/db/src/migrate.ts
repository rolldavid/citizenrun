import { EnvError, createLogger } from '@citizenrun/shared';
import { loadDbEnv } from './env.ts';
import { runMigrations } from './migrator.ts';

// The command-line entry of the migration runner, and the pre-deploy command of both services
// once bundled (D-141). It is part of both deploys; its lines are told apart by their migrate.*
// events. Exit codes: 0 done (also when nothing was applied), 1 failed, 2 bad environment.
async function main(): Promise<number> {
  let env;
  try {
    env = loadDbEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      createLogger({ service: 'api', level: 'info' }).error('migrate.env_invalid', {
        variables: error.variables,
      });
      return 2;
    }
    throw error;
  }
  const logger = createLogger({ service: 'api', level: env.logLevel });
  try {
    await runMigrations(env.databaseUrl, { logger });
    return 0;
  } catch (error) {
    logger.error('migrate.failed', { error });
    return 1;
  }
}

process.exitCode = await main();
