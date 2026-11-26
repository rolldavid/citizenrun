import { createDb, createEnqueue, createPool } from '@citizenrun/db';
import type { Db, Enqueue } from '@citizenrun/db';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDatabaseUrl,
  registerScanSource,
} from '@citizenrun/db/testing';
import type { CapturedLine } from '@citizenrun/db/testing';
import { createLogger } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll } from 'vitest';
import { createApp } from '../app.ts';
import type { Deps } from '../deps.ts';
import { createLifecycle } from '../lib/lifecycle.ts';
import type { Lifecycle } from '../lib/lifecycle.ts';
import { CaptureMailer } from './fakes/mailer.ts';
import { testApiEnv } from './env.ts';
import { createTestClient } from './request.ts';
import type { TestClient } from './request.ts';

export type TestAppOverrides = {
  env?: Record<string, string | undefined>;
  clock?: FakeClock;
  mailer?: CaptureMailer;
  db?: Db;
  queue?: { enqueue: Enqueue };
  lifecycle?: Lifecycle;
};

export type TestApp = {
  app: ReturnType<typeof createApp>;
  deps: Deps & { clock: FakeClock; mailer: CaptureMailer };
  request: TestClient;
  logs: CapturedLine[];
  statementCount(): number;
  resetStatementCount(): void;
};

// One counting pool and one boss for this test file's process, made on first use and closed after
// the file (a pool per test app would leak connections across hundreds of tests).
const COUNTING_POOL_MAX = 4;
type Pool = ReturnType<typeof createPool>;
let countingPool: Pool | null = null;
let countingDb: Db | null = null;
let statements = 0;
let boss: PgBoss | null = null;
// Each test app's mailer is a scan source of its own: a second registration under one name replaces
// the first.
let mailers = 0;

function testDb(): Db {
  if (countingDb === null) {
    // createPool ignores an idle client's error, so it never crashes the test process.
    const pool = createPool(getTestDatabaseUrl(), {
      max: COUNTING_POOL_MAX,
      applicationName: 'os-test-api',
    });
    // Every query a client of the pool runs is counted (TEST-harness-app).
    pool.on('connect', (client) => {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown; // pg overloads query; every form is forwarded unchanged
      const counted = (...args: unknown[]): unknown => {
        statements += 1;
        return original(...args);
      };
      client.query = counted as typeof client.query; // the same function, counted
    });
    countingPool = pool;
    countingDb = createDb(pool);
  }
  return countingDb;
}

async function testEnqueue(): Promise<Enqueue> {
  boss ??= await createTestBoss();
  return createEnqueue(boss);
}

afterAll(async () => {
  const stopping = boss;
  boss = null;
  await stopping?.stop({ graceful: false }).catch(() => undefined);
  const closing = countingPool;
  countingPool = null;
  countingDb = null;
  await closing?.end().catch(() => undefined);
});

/**
 * The API under test (TEST-harness-app): `createApp(deps)` on this worker's database, with a fake
 * clock, the API's capture mailer fake, the worker's media bucket, a send-only pg-boss and the log
 * capture. No port is opened; `request` calls the app in process. Every message the mailer holds is
 * read by the always-on privacy scan until the next test (D-855), so make the app inside the test.
 */
export async function createTestApp(overrides: TestAppOverrides = {}): Promise<TestApp> {
  const media = await getTestBucket('media');
  const env = testApiEnv({
    DATABASE_URL: getTestDatabaseUrl(),
    MEDIA_BUCKET: media.bucket,
    ...overrides.env,
  });
  const capture = captureLogs();
  const mailer = overrides.mailer ?? new CaptureMailer();
  mailers += 1;
  registerScanSource(`api capture mailer ${String(mailers)}`, () => mailer.mailTexts());
  const deps: Deps & { clock: FakeClock; mailer: CaptureMailer } = {
    env,
    db: overrides.db ?? testDb(),
    queue: overrides.queue ?? { enqueue: await testEnqueue() },
    storage: { media },
    mailer,
    clock: overrides.clock ?? new FakeClock(),
    logger: createLogger({ service: 'api', level: 'debug', sink: capture.sink }),
    lifecycle: overrides.lifecycle ?? createLifecycle(),
  };
  const app = createApp(deps);
  const resetStatementCount = (): void => {
    statements = 0;
  };
  return {
    app,
    deps,
    request: createTestClient(app, env, { beforeRequest: resetStatementCount }),
    logs: capture.lines,
    statementCount: () => statements,
    resetStatementCount,
  };
}
