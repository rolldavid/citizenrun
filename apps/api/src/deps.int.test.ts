import { DatabaseUnavailableError, createPool } from '@citizenrun/db';
import { getTestDatabaseUrl } from '@citizenrun/db/testing';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeps } from './deps.ts';
import { isCaptureMailer } from './lib/mailer.ts';
import { testApiEnv } from './testing/env.ts';

// The committed legal documents, which the factory renders before it connects.
const DOCUMENTS_DIR = fileURLToPath(new URL('../assets/documents/', import.meta.url));

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
    await expect(
      createDeps(env, logger, { documentsDir: DOCUMENTS_DIR, databaseWaitMs: 1500 }),
    ).rejects.toThrow(DatabaseUnavailableError);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(end).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).not.toContain(UNREACHABLE_DATABASE_URL);
  });

  it('the key ring comes from APP_SECRET', async () => {
    const logger = createLogger({ service: 'api', level: 'error', sink: () => undefined });
    const rt = await createDeps(
      testApiEnv({ DATABASE_URL: getTestDatabaseUrl(), APP_SECRET: '0'.repeat(64) }),
      logger,
      { documentsDir: DOCUMENTS_DIR },
    );
    try {
      // CTL-07's vector for the all-zero secret.
      expect(rt.keyRing.current['identity-hash'].kid).toBe('9880f43e');
      expect(rt.keyRing.previous).toBeNull();
    } finally {
      await rt.close();
    }
  });

  it("the factory keeps the capture mailer's mailbox", async () => {
    const logger = createLogger({ service: 'api', level: 'error', sink: () => undefined });
    const env = testApiEnv({ DATABASE_URL: getTestDatabaseUrl() });
    expect(env.RESEND_API_KEY).toBeNull();
    expect(env.captureMail).toBe(true);
    const rt = await createDeps(env, logger, { documentsDir: DOCUMENTS_DIR });
    try {
      expect(isCaptureMailer(rt.mailer)).toBe(true);
      expect(isCaptureMailer(rt.mailer) ? rt.mailer.captured() : null).toEqual([]);
      expect(typeof rt.outbound).toBe('function');
      expect(typeof rt.identityKeys.apple).toBe('function');
      expect(typeof rt.identityKeys.google).toBe('function');
    } finally {
      await rt.close();
    }
  });
});
