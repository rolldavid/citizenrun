import { EnvError, createLogger } from '@citizenrun/shared';
import { loadDbEnv } from './env.ts';
import { MigrationConnectError, runMigrations } from './migrator.ts';

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

function errorClassOf(error: unknown): string {
  return error instanceof Error && ERROR_CLASS_PATTERN.test(error.name) ? error.name : 'Error';
}

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
    // The class and the SQLSTATE code only: a driver's message or stack can name the host or the
    // role (D-806).
    logger.error('migrate.failed', {
      errorClass: errorClassOf(error),
      ...(error instanceof MigrationConnectError ? { sqlState: error.sqlState } : {}),
    });
    return 1;
  }
}

process.exitCode = await main();
