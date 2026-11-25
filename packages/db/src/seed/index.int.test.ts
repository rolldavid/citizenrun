import { readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { KEEP_TABLES, getTestDb } from '../testing/index.ts';
import { SEED_STEPS, SeedError, SeedRefusedError, runSeed } from './index.ts';
import type { SeedStep } from './index.ts';
import { step as sanity } from './steps/000-sanity.ts';

const STEPS_DIR = new URL('./steps/', import.meta.url);
const NOW = new Date('2027-03-05T22:17:42.123Z');

// Row counts of every application table of schema `public` (extension tables left out).
async function rowCounts(db: Db): Promise<Record<string, number>> {
  const tables = await db.execute<{ name: string }>(
    sql`select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
          and not exists (
            select 1 from pg_depend d
            where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
          )
        order by c.relname`,
    'objects',
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier('public')}.${sql.identifier(name)}`,
      'objects',
    );
    counts[name] = rows[0]?.n ?? 0;
  }
  return counts;
}

describe('runSeed', () => {
  it('runs every step in order', async () => {
    const files = readdirSync(STEPS_DIR)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => file.slice(0, -'.ts'.length))
      .sort();
    expect(SEED_STEPS.map((step) => step.name)).toEqual(files);

    const seen: { name: string; txid: string; anchor: Date }[] = [];
    const recording = (name: string): SeedStep => ({
      name,
      async run(tx, ctx) {
        const rows = await tx.execute<{ txid: string }>(
          sql`select txid_current()::text as txid`,
          'objects',
        );
        seen.push({ name, txid: rows[0]?.txid ?? '', anchor: ctx.anchor });
      },
    });
    const result = await runSeed(getTestDb(), {
      appEnv: 'local',
      allowStaging: false,
      now: NOW,
      steps: [recording('003-c'), recording('001-a'), recording('002-b')],
    });

    expect(result.ran).toEqual(['001-a', '002-b', '003-c']);
    expect(seen.map((entry) => entry.name)).toEqual(['001-a', '002-b', '003-c']);
    expect(new Set(seen.map((entry) => entry.txid)).size).toBe(3);
    for (const entry of seen) {
      expect(entry.anchor).toEqual(new Date('2027-03-05T22:17:00.000Z'));
    }
  });

  it('is idempotent', async () => {
    const db = getTestDb();
    const before = await rowCounts(db);
    await runSeed(db, { appEnv: 'local', allowStaging: false, now: NOW });
    const first = await rowCounts(db);
    await runSeed(db, {
      appEnv: 'local',
      allowStaging: false,
      now: new Date(NOW.getTime() + 60 * 60_000),
    });
    expect(await rowCounts(db)).toEqual(first);

    // The reference tables a migration fills keep their rows across resets: the seed leaves
    // them as it found them. Every other table stays empty.
    const keep = new Set(KEEP_TABLES);
    for (const name of KEEP_TABLES) {
      expect(first[name]).toBeGreaterThan(0);
      expect(first[name]).toBe(before[name]);
    }
    const others = Object.entries(first).filter(([name]) => !keep.has(name));
    expect(others.length).toBeGreaterThan(0);
    expect(others.filter(([, count]) => count !== 0)).toEqual([]);
  });

  it('refuses where it must', async () => {
    const db = getTestDb();
    await expect(
      runSeed(db, { appEnv: 'production', allowStaging: true, now: NOW }),
    ).rejects.toThrow(SeedRefusedError);
    await expect(runSeed(db, { appEnv: 'staging', allowStaging: false, now: NOW })).rejects.toThrow(
      SeedRefusedError,
    );
    await expect(runSeed(db, { appEnv: 'staging', allowStaging: true, now: NOW })).resolves.toEqual(
      { ran: SEED_STEPS.map((step) => step.name) },
    );
  });

  it('000-sanity fails when an extension is missing', async () => {
    const db = getTestDb();
    await db.execute(sql`drop extension unaccent`);
    try {
      const error: unknown = await db
        .transaction(async (tx) => {
          await sanity.run(tx, { anchor: NOW });
        })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SeedError);
      expect(String(error)).toContain('unaccent');
      expect(String(error)).not.toContain('postgis');
    } finally {
      await db.execute(sql`create extension if not exists unaccent`);
    }
  });
});
