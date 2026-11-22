import pg from 'pg';
import { describe, expect, inject, it, vi } from 'vitest';
import { ResetRefusedError, resetDatabase } from './reset.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  harnessSettings,
} from './testing/settings.ts';

describe('resetDatabase', () => {
  it('refuses a host that is not local', async () => {
    const connect = vi.spyOn(pg.Client.prototype, 'connect');
    await expect(resetDatabase('postgres://u:p@db.example.test/x')).rejects.toThrow(
      ResetRefusedError,
    );
    expect(connect).not.toHaveBeenCalled();
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
