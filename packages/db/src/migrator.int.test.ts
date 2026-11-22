import { readdirSync } from 'node:fs';
import { createLogger } from '@citizenrun/shared';
import { describe, expect, inject, it, vi } from 'vitest';
import { MigrationConnectError, runMigrations } from './migrator.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  harnessSettings,
} from './testing/settings.ts';

const MIGRATIONS_DIR = new URL('../migrations', import.meta.url);
const EXTENSIONS = 'citext,pg_trgm,postgis,unaccent';

let scratchCount = 0;

// Each case works on a scratch database of its own on the harness server, never on the clone.
async function withScratchDatabase(
  body: (url: string, name: string) => Promise<void>,
  options: { owner?: string } = {},
): Promise<void> {
  scratchCount += 1;
  const name = `os_mig_${inject('harness').runId}_${String(scratchCount)}`;
  const { databaseUrl } = harnessSettings();
  const admin = await connectHarnessClient(databaseUrl, 'os-test-migrator');
  try {
    const owner =
      options.owner === undefined ? '' : ` owner ${admin.escapeIdentifier(options.owner)}`;
    await admin.query(`create database ${admin.escapeIdentifier(name)}${owner}`);
    await body(databaseUrlFor(databaseUrl, name), name);
  } finally {
    await dropDatabase(admin, name);
    await admin.end();
  }
}

async function queryOne<T extends Record<string, unknown>>(url: string, text: string): Promise<T> {
  const client = await connectHarnessClient(url, 'os-test-migrator');
  try {
    const result = await client.query<T>(text);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('The query returned no row');
    }
    return row;
  } finally {
    await client.end();
  }
}

function migrationCount(): number {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .length;
}

describe('runMigrations', () => {
  it('applies every migration from empty', async () => {
    await withScratchDatabase(async (url) => {
      await expect(runMigrations(url)).resolves.toEqual({ applied: migrationCount() });
      const extensions = await queryOne<{ names: string }>(
        url,
        `select string_agg(extname, ',' order by extname) as names from pg_extension
         where extname in ('citext', 'pg_trgm', 'postgis', 'unaccent')`,
      );
      expect(extensions.names).toBe(EXTENSIONS);
      const schema = await queryOne<{ present: boolean }>(
        url,
        "select exists (select 1 from pg_namespace where nspname = 'pgboss') as present",
      );
      expect(schema.present).toBe(true);
      await expect(runMigrations(url)).resolves.toEqual({ applied: 0 });
    });
  });

  it('holds the session settings', async () => {
    await withScratchDatabase(async (url) => {
      const lines: string[] = [];
      const logger = createLogger({
        service: 'api',
        level: 'debug',
        sink: (line) => {
          lines.push(line);
        },
      });
      await runMigrations(url, { logger });
      const events = lines.map((line): unknown => JSON.parse(line));
      const start = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          'event' in event &&
          event.event === 'migrate.start',
      );
      expect(start).toMatchObject({ statementTimeout: '0', lockTimeout: '5s' });
      expect(lines.join('\n')).not.toContain(url);
      expect(lines.join('\n')).not.toContain(':citizenrun@');
    });
  });

  it('a second runner waits on the lock', async () => {
    await withScratchDatabase(async (url) => {
      const holder = await connectHarnessClient(url, 'os-test-lock-holder');
      let running: Promise<{ applied: number }> | null = null;
      try {
        await holder.query("select pg_advisory_lock(hashtext('os_migrate'))");
        let settled = false;
        running = runMigrations(url).finally(() => {
          settled = true;
        });
        // Only this scratch database's sessions: other runs on the server have runners of their own.
        await vi.waitFor(
          async () => {
            const waiting = await holder.query<{ n: number }>(
              `select count(*)::int as n from pg_locks l
               join pg_stat_activity a on a.pid = l.pid
               where a.datname = current_database() and a.application_name = 'os-migrate'
                 and l.locktype = 'advisory' and not l.granted`,
            );
            expect(waiting.rows[0]?.n).toBe(1);
          },
          { timeout: 10_000, interval: 100 },
        );
        expect(settled).toBe(false);
        await holder.query("select pg_advisory_unlock(hashtext('os_migrate'))");
        const result = await running;
        expect(result.applied).toBeGreaterThanOrEqual(0);
      } finally {
        // Ending the holder's session releases the lock, so a runner left waiting finishes too.
        await holder.end();
        await running?.catch(() => undefined);
      }
    });
  });

  it('gives up connecting after its window', async () => {
    const startedAt = Date.now();
    await expect(
      runMigrations('postgres://citizenrun:citizenrun@localhost:1/x', { connectTimeoutMs: 2000 }),
    ).rejects.toThrow(MigrationConnectError);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('applies the extensions migration as a non-superuser when the extensions exist', async () => {
    const { databaseUrl } = harnessSettings();
    const role = `os_ext_${inject('harness').runId}`;
    // A visibly fake password for a role that lives only for this case.
    const password = 'os-ext-fixture';
    const admin = await connectHarnessClient(databaseUrl, 'os-test-migrator');
    try {
      await admin.query(
        `create role ${admin.escapeIdentifier(role)} login nosuperuser nocreatedb nocreaterole password ${admin.escapeLiteral(password)}`,
      );
      await withScratchDatabase(
        async (url) => {
          const superuser = await connectHarnessClient(url, 'os-test-migrator');
          try {
            for (const extension of ['postgis', 'pg_trgm', 'citext', 'unaccent']) {
              await superuser.query(`create extension ${superuser.escapeIdentifier(extension)}`);
            }
          } finally {
            await superuser.end();
          }
          const asRole = new URL(url);
          asRole.username = role;
          asRole.password = password;
          await expect(runMigrations(asRole.href)).resolves.toEqual({
            applied: migrationCount(),
          });
          const owner = await queryOne<{ owner: string }>(
            url,
            "select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'pgboss'",
          );
          expect(owner.owner).toBe(role);
        },
        { owner: role },
      );
    } finally {
      await admin.query(`drop role if exists ${admin.escapeIdentifier(role)}`);
      await admin.end();
    }
  });
});
