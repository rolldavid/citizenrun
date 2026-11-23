import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { EnvError, createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { createApp } from './app.ts';
import { createDeps } from './deps.ts';
import { loadEnv, logMissingOwnerInputs } from './env.ts';
import type { ApiEnv } from './env.ts';
import { API_HARD_STOP_MS, drainServer } from './lib/lifecycle.ts';

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

function errorClassOf(error: unknown): string {
  return error instanceof Error && ERROR_CLASS_PATTERN.test(error.name) ? error.name : 'Error';
}

// This file sits two folders below the repository's apps folder, in src/ and in dist/ alike.
const here = dirname(fileURLToPath(import.meta.url));
const defaultWebDistDir = resolve(here, '../../mobile/dist');

function readEnv(): ApiEnv {
  try {
    return loadEnv({ defaultWebDistDir });
  } catch (error) {
    const bootLogger = createLogger({ service: 'api', level: 'info' });
    // Names only: an EnvError never holds a value (INV-38).
    bootLogger.error('env.invalid', {
      variables: error instanceof EnvError ? error.variables : [],
    });
    process.exit(1);
  }
}

async function start(env: ApiEnv, logger: Logger): Promise<void> {
  const runtime = await createDeps(env, logger);
  // No option: a running service strips undeclared response keys.
  const app = createApp(runtime);
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' });
  logger.info('api.started', { port: env.PORT });

  let stopping = false;
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info('api.stopping', { signal });
    runtime.lifecycle.beginDrain();
    await drainServer(server, { hardStopMs: API_HARD_STOP_MS, logger });
    await runtime.close();
    logger.info('api.stopped');
    process.exit(0);
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    stop(signal).catch((error: unknown) => {
      logger.error('api.stop_failed', { errorClass: errorClassOf(error) });
      process.exit(1);
    });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

const env = readEnv();
const logger = createLogger({ service: 'api', level: env.LOG_LEVEL });
logMissingOwnerInputs(env, logger);
start(env, logger).catch((error: unknown) => {
  // The class only: a driver's message can name a host or a user.
  logger.error('api.start_failed', { errorClass: errorClassOf(error) });
  process.exit(1);
});
