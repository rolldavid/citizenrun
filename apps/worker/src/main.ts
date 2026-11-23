import { createEnqueue, waitForDatabase } from '@citizenrun/db';
import { EnvError, createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { createBoss } from './boss.ts';
import type { WorkerRuntime } from './context.ts';
import { loadEnv, logMissingOwnerInputs } from './env.ts';
import type { WorkerEnv } from './env.ts';
import { errorClassOf } from './jobs/types.ts';
import { createWorkerDb, createWorkerPool } from './lib/db.ts';
import { createMailer } from './lib/mailer.ts';
import { createShutdown, installShutdown } from './lib/shutdown.ts';
import { createWorkerBuckets } from './lib/storage.ts';
import { QUEUE_REGISTRY, registerQueues, registerSchedules } from './queues.ts';

function readEnv(): WorkerEnv {
  try {
    return loadEnv();
  } catch (error) {
    const bootLogger = createLogger({ service: 'worker', level: 'info' });
    // Names only: an EnvError never holds a value (INV-38).
    bootLogger.error('env.invalid', {
      variables: error instanceof EnvError ? error.variables : [],
    });
    process.exit(1);
  }
}

async function start(env: WorkerEnv, logger: Logger): Promise<void> {
  const pool = createWorkerPool(env);
  // D-140: the database may be restarting; wait for it before anything else connects.
  await waitForDatabase(pool);
  const db = createWorkerDb(pool);
  const storage = createWorkerBuckets(env);
  const mailer = createMailer(env, logger);
  const abort = new AbortController();

  const boss = createBoss({ connectionString: env.DATABASE_URL, logger });
  await boss.start();

  const runtime: WorkerRuntime = {
    env,
    logger,
    db,
    enqueue: createEnqueue(boss),
    storage,
    mailer,
    clock: { now: () => new Date() },
    abort,
  };
  await registerQueues(boss, runtime);
  await registerSchedules(boss, logger);

  installShutdown(
    createShutdown({
      boss,
      pool,
      abort,
      logger,
      exit: (code) => process.exit(code),
    }),
  );
  logger.info('worker.started', {
    commit: env.RAILWAY_GIT_COMMIT_SHA,
    queueCount: QUEUE_REGISTRY.length,
  });
}

const env = readEnv();
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL });
logMissingOwnerInputs(env, logger);
start(env, logger).catch((error: unknown) => {
  // The class only: a driver's message can name a host or a user.
  logger.error('worker.start_failed', { errorClass: errorClassOf(error) });
  process.exit(1);
});
