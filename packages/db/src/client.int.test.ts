import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DatabaseUnavailableError, createPool, waitForDatabase } from './client.ts';
import { getTestDatabaseUrl, getTestDb } from './testing/index.ts';
import { HARNESS_STATEMENT_TIMEOUT_MS } from './testing/settings.ts';

const UNREACHABLE_URL = 'postgres://citizenrun:citizenrun@localhost:1/x';

describe('client', () => {
  it('waits for the database and then answers', async () => {
    const pool = createPool(getTestDatabaseUrl(), {
      max: 1,
      statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
    });
    try {
      await expect(waitForDatabase(pool, { timeoutMs: 5_000 })).resolves.toBeUndefined();
      const result = await pool.query<{ one: number }>('select 1 as one');
      expect(result.rows).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
    }
  });

  it('gives up after its window', async () => {
    const pool = createPool(UNREACHABLE_URL, { max: 1 });
    const startedAt = Date.now();
    try {
      await expect(waitForDatabase(pool, { timeoutMs: 1_500, intervalMs: 250 })).rejects.toThrow(
        DatabaseUnavailableError,
      );
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await pool.end();
    }
  });

  it('gives up after its window when the server accepts and never answers', async () => {
    // A listener that takes the connection and stays silent: no startup reply, no error.
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const pool = createPool(`postgres://citizenrun:citizenrun@127.0.0.1:${String(port)}/x`, {
      max: 1,
    });
    const startedAt = Date.now();
    try {
      await expect(waitForDatabase(pool, { timeoutMs: 1_500, intervalMs: 250 })).rejects.toThrow(
        DatabaseUnavailableError,
      );
      expect(Date.now() - startedAt).toBeLessThan(3_000);
    } finally {
      // Closing the silent sockets fails the abandoned attempt, so the pool can end.
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await pool.end();
    }
  });

  it("an idle client's error does not crash the pool", async () => {
    let reportError: (error: Error) => void = () => undefined;
    const reported = new Promise<Error>((resolve) => {
      reportError = resolve;
    });
    const pool = createPool(getTestDatabaseUrl(), {
      max: 1,
      statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
      onError: (error) => {
        reportError(error);
      },
    });
    try {
      const backend = await pool.query<{ pid: number }>('select pg_backend_pid() as pid');
      const pid = backend.rows[0]?.pid;
      expect(typeof pid).toBe('number');
      // The pool's one client is idle now; ending its backend makes it emit `error`.
      await getTestDb().execute(sql`select pg_terminate_backend(${pid})`);
      const error = await reported;
      expect(error).toBeInstanceOf(Error);

      const after = await pool.query<{ one: number }>('select 1 as one');
      expect(after.rows).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
    }
  });
});
