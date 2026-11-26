import { describe, expect, it } from 'vitest';
import { workerDatabaseName } from './names.ts';
import { connectHarnessClient, databaseUrlFor, harnessSettings } from './settings.ts';
import { KEPT_ROWS_SCHEMA, harnessContext, prepareWorkerDatabase, workerSlot } from './worker.ts';

// TEST-harness-db: a worker's clone always holds the kept reference rows.

async function count(databaseUrl: string, table: string): Promise<number> {
  const client = await connectHarnessClient(databaseUrl, 'os-test');
  try {
    const result = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return result.rows[0]?.n ?? 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe('prepareWorkerDatabase', () => {
  it('gives a clone made without its kept rows the rows when it is reused', async () => {
    const { stamp, runId, templateName } = harnessContext();
    const name = `${workerDatabaseName(stamp, runId, workerSlot())}_kept`;
    const settings = harnessSettings();
    const admin = await connectHarnessClient(settings.databaseUrl, 'os-test');
    const quoted = admin.escapeIdentifier(name);
    try {
      await admin.query(`drop database if exists ${quoted}`);
      // A clone whose kept copy failed as it was made: the template's tables and nothing kept.
      await admin.query(
        `create database ${quoted} template ${admin.escapeIdentifier(templateName)}`,
      );

      await prepareWorkerDatabase(name, templateName);

      const url = databaseUrlFor(settings.databaseUrl, name);
      const live = await count(url, 'public.state_rules');
      expect(live).toBeGreaterThan(0);
      expect(await count(url, `${KEPT_ROWS_SCHEMA}.state_rules`)).toBe(live);

      // A second use keeps the copy as it is.
      await prepareWorkerDatabase(name, templateName);
      expect(await count(url, `${KEPT_ROWS_SCHEMA}.state_rules`)).toBe(live);
    } finally {
      await admin.query(`drop database if exists ${quoted} with (force)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });
});
