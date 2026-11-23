import type { CapturedLine } from '@citizenrun/db/testing';
import { createLogger } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import type { Deps } from '../deps.ts';
import { createLifecycle } from '../lib/lifecycle.ts';
import { CaptureMailer } from './fakes/mailer.ts';
import { testApiEnv } from './env.ts';

// A unit test has no database, queue or bucket: any read of one fails the test at once.
function noService(): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error('unit deps have no database');
      },
    },
  ) as never; // the proxy satisfies no member by design: any read throws
}

function parseLine(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/**
 * The dependencies of a middleware unit test: the test environment, a fake clock, a capture
 * mailer, a logger whose lines land in `logs`, a fresh drain state, and no database, queue or
 * bucket. It imports nothing that starts the database harness, so unit projects can use it.
 */
export function createUnitDeps(
  overrides: { env?: Record<string, string | undefined>; clock?: FakeClock } = {},
): Deps & { clock: FakeClock; mailer: CaptureMailer; logs: CapturedLine[] } {
  const logs: CapturedLine[] = [];
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    sink: (raw) => {
      logs.push({ raw, parsed: parseLine(raw) });
    },
  });
  return {
    env: testApiEnv(overrides.env),
    db: noService(),
    queue: noService(),
    storage: noService(),
    mailer: new CaptureMailer(),
    clock: overrides.clock ?? new FakeClock(),
    logger,
    lifecycle: createLifecycle(),
    logs,
  };
}
