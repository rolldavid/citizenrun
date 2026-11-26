import { fileURLToPath } from 'node:url';
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
import { BRAND, brandVariant, createI18n, createLogger } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import type { PgBoss } from 'pg-boss';
import { afterAll } from 'vitest';
import { createApp } from '../app.ts';
import { countedMailer } from '../deps.ts';
import type { Deps } from '../deps.ts';
import { createLifecycle } from '../lib/lifecycle.ts';
import type { Lifecycle } from '../lib/lifecycle.ts';
import { isCaptureMailer } from '../lib/mailer.ts';
import { devMailboxEnabled } from '../routes/dev/index.ts';
import { loadLegalDocuments } from '../web/documents/load.ts';
import type { LegalDocumentPages } from '../web/documents/load.ts';
import type { CapturedMailbox } from '../lib/mailer.ts';
import { FakeIdentityProviders } from './fakes/identity.ts';
import { CaptureMailer } from './fakes/mailer.ts';
import { createFakeOutbound } from './fakes/outbound.ts';
import type { FakeOutbound } from './fakes/outbound.ts';
import { testApiEnv } from './env.ts';
import { createTestClient } from './request.ts';
import type { TestClient } from './request.ts';

export type TestAppOverrides = {
  /** Merged over the test environment before parsing; a key set to `undefined` removes it. */
  env?: Readonly<Record<string, string | undefined>>;
  clock?: FakeClock;
  mailer?: CaptureMailer;
  identity?: FakeIdentityProviders;
  db?: Db;
  queue?: { enqueue: Enqueue };
  lifecycle?: Lifecycle;
  /** Replaces the legal pages rendered from the committed documents with every contact as brand.json has it. */
  documents?: LegalDocumentPages;
};

/** The fakes behind a test app's dependencies, for a test to read and drive. */
export type TestAppFakes = {
  clock: FakeClock;
  /** The CaptureMailer inside `deps.mailer`, which is the counted wrapper over it. */
  mailer: CaptureMailer;
  outbound: FakeOutbound;
  identity: FakeIdentityProviders;
};

export type TestApp = {
  app: ReturnType<typeof createApp>;
  deps: Deps & { clock: FakeClock; mailer: Deps['mailer'] & CapturedMailbox };
  request: TestClient;
  fakes: TestAppFakes;
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

// The committed documents, and the origin of the test environment (TEST-harness-app).
const DOCUMENTS_DIR = fileURLToPath(new URL('../../assets/documents/', import.meta.url));
const TEST_DOCUMENTS_PUBLIC_URL = 'https://app.example.test';
let defaultDocuments: LegalDocumentPages | null = null;

/** The legal pages a test app serves by default: the `development` variant's name, rendered once per test file. */
export function testDocuments(): LegalDocumentPages {
  defaultDocuments ??= loadLegalDocuments({
    dir: DOCUMENTS_DIR,
    appName: brandVariant('development').displayName,
    publicUrl: TEST_DOCUMENTS_PUBLIC_URL,
    contacts: BRAND.contacts,
    t: createI18n({ lng: 'en' }).getFixedT('en'),
  });
  return defaultDocuments;
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
 * The API under test (TEST-harness-app): `createApp(deps)` on this worker's database, with the
 * development mailbox when the environment allows it, a fake
 * clock, the API's capture mailer fake behind the email counters, the worker's media bucket, a
 * send-only pg-boss, a fake outbound fetch with no routes, the fake sign-in key sets and the log
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
  const logger = createLogger({ service: 'api', level: 'debug', sink: capture.sink });
  const clock = overrides.clock ?? new FakeClock();
  const db = overrides.db ?? testDb();
  const mailer = overrides.mailer ?? new CaptureMailer();
  mailers += 1;
  // The inner fake is scanned, never the counted wrapper (D-855).
  registerScanSource(`api capture mailer ${String(mailers)}`, () => mailer.mailTexts());
  const outbound = createFakeOutbound();
  const identity = overrides.identity ?? new FakeIdentityProviders(clock);
  const counted = countedMailer(mailer, db, clock, logger);
  if (!isCaptureMailer(counted)) {
    throw new Error('The counted test mailer lost its mailbox.');
  }
  const deps: TestApp['deps'] = {
    env,
    db,
    queue: overrides.queue ?? { enqueue: await testEnqueue() },
    storage: { media },
    mailer: counted,
    clock,
    logger,
    lifecycle: overrides.lifecycle ?? createLifecycle(),
    keyRing: loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS ?? null),
    outbound: outbound.fetch,
    identityKeys: identity.keys,
    documents: overrides.documents ?? testDocuments(),
  };
  const app = createApp(deps, { devMailbox: devMailboxEnabled(env) });
  const resetStatementCount = (): void => {
    statements = 0;
  };
  return {
    app,
    deps,
    request: createTestClient(app, env, { beforeRequest: resetStatementCount }),
    fakes: { clock, mailer, outbound, identity },
    logs: capture.lines,
    statementCount: () => statements,
    resetStatementCount,
  };
}
