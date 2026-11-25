import { createEnqueue, waitForDatabase, withEmailCounters } from '@citizenrun/db';
import { EnvError, createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import { createBoss } from './boss.ts';
import type { WorkerRuntime } from './context.ts';
import { loadEnv, logMissingOwnerInputs } from './env.ts';
import type { WorkerEnv } from './env.ts';
import { processStartedAt, writeHeartbeat } from './jobs/ops/heartbeat.ts';
import { errorClassOf } from './jobs/types.ts';
import { createWorkerDb, createWorkerPool } from './lib/db.ts';
import { createMailer } from './lib/mailer.ts';
import { createOutboundFetch } from './lib/outbound-fetch.ts';
import { installProcessErrorHandlers } from './lib/process-errors.ts';
import { configureSharp } from './lib/sharp-setup.ts';
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
  const clock = { now: () => new Date() };
  // Every message handed to Resend or the capture mailer is counted (D-428).
  const mailer = withEmailCounters(createMailer(env, logger), db, clock, logger);
  const keys = loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS);
  const outbound = createOutboundFetch(env);
  const abort = new AbortController();
  // Boot step 3: the image library's process settings, before any job can run (D-250).
  configureSharp();

  const boss = createBoss({ connectionString: env.DATABASE_URL, logger });
  await boss.start();

  const runtime: WorkerRuntime = {
    env,
    logger,
    db,
    enqueue: createEnqueue(boss),
    storage,
    mailer,
    keys,
    outbound,
    clock,
    abort,
  };
  await registerQueues(boss, runtime);
  // One beat at once, so `/readyz` reports the worker ready as soon as it is up (D-145).
  await writeHeartbeat(db, {
    beatAt: runtime.clock.now(),
    startedAt: processStartedAt(),
    version: env.RAILWAY_GIT_COMMIT_SHA,
  });
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
installProcessErrorHandlers(logger, 'worker.crashed');
logMissingOwnerInputs(env, logger);
start(env, logger).catch((error: unknown) => {
  // The class only: a driver's message can name a host or a user.
  logger.error('worker.start_failed', { errorClass: errorClassOf(error) });
  process.exit(1);
});
