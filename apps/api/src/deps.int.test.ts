import { DatabaseUnavailableError, createPool } from '@citizenrun/db';
import { createLogger } from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeps } from './deps.ts';
import { testApiEnv } from './testing/env.ts';

// Nothing listens on port 1, so every connection attempt is refused.
const UNREACHABLE_DATABASE_URL = 'postgres://citizenrun:citizenrun@127.0.0.1:1/fixture';

type PoolPrototype = { end(): Promise<void> };

// The prototype of every pool `@citizenrun/db` makes, which carries `end`. The pool made to reach it
// opens no connection and is ended before any spy.
async function poolPrototype(): Promise<PoolPrototype> {
  const probe = createPool(UNREACHABLE_DATABASE_URL);
  await probe.end();
  return Object.getPrototypeOf(probe) as PoolPrototype; // the pg Pool class's prototype
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDeps', () => {
  it('gives up when the database is not there', async () => {
    const end = vi.spyOn(await poolPrototype(), 'end');
    const lines: string[] = [];
    const logger = createLogger({
      service: 'api',
      level: 'debug',
      sink: (line) => {
        lines.push(line);
      },
    });
    const env = testApiEnv({ DATABASE_URL: UNREACHABLE_DATABASE_URL });
    const startedAt = Date.now();
    await expect(createDeps(env, logger, { databaseWaitMs: 1500 })).rejects.toThrow(
      DatabaseUnavailableError,
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(end).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).not.toContain(UNREACHABLE_DATABASE_URL);
  });
});
