import pg from 'pg';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { ResetRefusedError, resetDatabase } from './reset.ts';
import type { ResetRefusedReason } from './reset.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  harnessSettings,
} from './testing/settings.ts';

// A refusal must come before any connection; the stub keeps a case that is not refused from
// reaching the URL's host.
async function expectRefused(databaseUrl: string, reason: ResetRefusedReason): Promise<void> {
  const connect = vi
    .spyOn(pg.Client.prototype, 'connect')
    .mockRejectedValue(new Error('This case opens no connection'));
  const attempt = resetDatabase(databaseUrl);
  await expect(attempt).rejects.toThrow(ResetRefusedError);
  await expect(attempt).rejects.toMatchObject({ reason });
  expect(connect).not.toHaveBeenCalled();
}

describe('resetDatabase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a host that is not local', async () => {
    await expectRefused('postgres://u:p@db.example.test/x', 'host_not_local');
  });

  it('refuses a query parameter that replaces the host', async () => {
    await expectRefused('postgres://u:p@localhost/x?host=db.example.test', 'host_override');
    await expectRefused('postgres://u:p@127.0.0.1/x?hostaddr=192.0.2.10', 'host_override');
  });

  it('refuses a query parameter that replaces the port', async () => {
    await expectRefused('postgres://u:p@localhost:5432/x?port=6543', 'host_override');
  });

  it('drops and recreates a local database', async () => {
    const { databaseUrl } = harnessSettings();
    const name = `os_reset_${inject('harness').runId}`;
    const admin = await connectHarnessClient(databaseUrl, 'os-test-reset');
    try {
      await admin.query(`create database ${admin.escapeIdentifier(name)}`);
      const target = await connectHarnessClient(databaseUrlFor(databaseUrl, name), 'os-test-reset');
      try {
        await target.query('create table reset_probe (id int primary key)');
        await target.query('insert into reset_probe (id) values (1)');
      } finally {
        await target.end();
      }

      await resetDatabase(databaseUrlFor(databaseUrl, name));

      const after = await connectHarnessClient(databaseUrlFor(databaseUrl, name), 'os-test-reset');
      try {
        const tables = await after.query<{ n: number }>(
          "select count(*)::int as n from pg_tables where schemaname = 'public'",
        );
        expect(tables.rows).toEqual([{ n: 0 }]);
      } finally {
        await after.end();
      }
    } finally {
      await dropDatabase(admin, name);
      await admin.end();
    }
  });
});
