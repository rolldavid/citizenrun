import { readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import {
  KEEP_TABLES,
  getTestBucket,
  getTestDb,
  getTestObject,
  listTestKeys,
  resetStorage,
} from '../testing/index.ts';
import { SEED_STEPS, SeedError, SeedRefusedError, runSeed } from './index.ts';
import type { SeedMedia, SeedStep } from './index.ts';
import { step as sanity } from './steps/000-sanity.ts';

const STEPS_DIR = new URL('./steps/', import.meta.url);
const NOW = new Date('2027-03-05T22:17:42.123Z');
// The tables the seed writes so far; every other application table stays empty.
const SEEDED_TABLES = ['auth_identities', 'uploads', 'user_consents', 'user_issues', 'users'];
// Every bio a seed user may carry.
const BIO_TEMPLATE = /^Seed account \d{2} for local testing\.$/;

async function media(): Promise<SeedMedia> {
  return getTestBucket('media');
}

/** Every media key a seed row names: the avatar keys and their 1080 siblings. */
async function seedMediaKeys(db: Db): Promise<string[]> {
  const rows = await db.execute<{ key: string }>(
    sql`select avatar_key as key from users where avatar_key is not null
        union all
        select regexp_replace(avatar_key, '/320[.]jpg$', '/1080.jpg') from users
        where avatar_key is not null`,
    'objects',
  );
  return rows.map((row) => row.key).sort();
}

async function texts(db: Db, query: ReturnType<typeof sql>): Promise<string[]> {
  const rows = await db.execute<{ value: string }>(query, 'objects');
  return rows.map((row) => row.value);
}

beforeEach(async () => {
  await resetStorage();
});

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
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => file.slice(0, -'.ts'.length))
      .sort();
    expect(SEED_STEPS.map((step) => step.name)).toEqual(files);
    expect(SEED_STEPS.map((step) => step.name)).toEqual(['000-sanity', '010-users']);

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
      media: await media(),
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
    await runSeed(db, { appEnv: 'local', allowStaging: false, now: NOW, media: await media() });
    const first = await rowCounts(db);
    await runSeed(db, {
      appEnv: 'local',
      allowStaging: false,
      now: new Date(NOW.getTime() + 60 * 60_000),
      media: await media(),
    });
    expect(await rowCounts(db)).toEqual(first);

    // The reference tables a migration fills keep their rows across resets: the seed leaves
    // them as it found them. The seeded tables hold rows; every other table stays empty.
    const keep = new Set(KEEP_TABLES);
    for (const name of KEEP_TABLES) {
      expect(first[name]).toBeGreaterThan(0);
      expect(first[name]).toBe(before[name]);
    }
    for (const name of SEEDED_TABLES) {
      expect(first[name], name).toBeGreaterThan(0);
    }
    const seeded = new Set(SEEDED_TABLES);
    const others = Object.entries(first).filter(([name]) => !keep.has(name) && !seeded.has(name));
    expect(others.length).toBeGreaterThan(0);
    expect(others.filter(([, count]) => count !== 0)).toEqual([]);

    // Every media key in a seed row has its object, and no avatar object is left without a row.
    const named = await seedMediaKeys(db);
    expect(named).toHaveLength(60);
    for (const key of named) {
      expect(await getTestObject('media', key), key).not.toBeNull();
    }
    expect((await listTestKeys('media', 'avatars/')).sort()).toEqual(named);
  });

  it('marks every person and account as fake', async () => {
    const db = getTestDb();
    await runSeed(db, { appEnv: 'local', allowStaging: false, now: NOW, media: await media() });
    const handles = await texts(db, sql`select handle::text as value from users`);
    expect(handles).toHaveLength(50);
    for (const handle of handles) {
      expect(handle.startsWith('seed_')).toBe(true);
    }
    const emails = await texts(
      db,
      sql`select email::text as value from users
          union all select email::text from auth_identities`,
    );
    expect(emails).toHaveLength(100);
    for (const email of emails) {
      expect(email.endsWith('@example.test')).toBe(true);
    }
    const bios = await texts(db, sql`select bio as value from users where bio is not null`);
    expect(bios).toHaveLength(20);
    for (const bio of bios) {
      expect(bio).toMatch(BIO_TEMPLATE);
    }
  });

  it('matches the seed counts', async () => {
    const db = getTestDb();
    await runSeed(db, { appEnv: 'local', allowStaging: false, now: NOW, media: await media() });
    const counts = await rowCounts(db);
    expect(counts['users']).toBe(50);
    expect(counts['auth_identities']).toBe(50);
    expect(counts['user_consents']).toBe(150);
    expect(counts['uploads']).toBe(30);
    expect(counts['user_issues']).toBe(321);
    const [bios] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from users where bio is not null`,
      'objects',
    );
    const [links] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from users where link is not null`,
      'objects',
    );
    expect(bios?.n).toBe(20);
    expect(links?.n).toBe(5);
  });

  it('refuses where it must', async () => {
    const db = getTestDb();
    const bucket = await media();
    await expect(
      runSeed(db, { appEnv: 'production', allowStaging: true, now: NOW, media: bucket }),
    ).rejects.toThrow(SeedRefusedError);
    await expect(
      runSeed(db, { appEnv: 'staging', allowStaging: false, now: NOW, media: bucket }),
    ).rejects.toThrow(SeedRefusedError);
    await expect(
      runSeed(db, { appEnv: 'staging', allowStaging: true, now: NOW, media: bucket }),
    ).resolves.toEqual({ ran: SEED_STEPS.map((step) => step.name) });
  });

  it('000-sanity fails when an extension is missing', async () => {
    const db = getTestDb();
    const bucket = await media();
    // The drop runs inside the transaction and cascades to the objects built on the
    // extension (the name-key functions and columns); every path ends the transaction
    // with an error, so PostgreSQL undoes the drop and its cascade.
    const error: unknown = await db
      .transaction(async (tx) => {
        await tx.execute(sql`drop extension unaccent cascade`);
        await sanity.run(tx, { anchor: NOW, media: bucket });
        throw new Error('000-sanity passed without unaccent');
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SeedError);
    expect(String(error)).toContain('unaccent');
    expect(String(error)).not.toContain('postgis');

    const restored = await texts(
      db,
      sql`select table_name as value from information_schema.columns
          where table_schema = 'public' and column_name = 'name_key'
            and table_name in ('people', 'candidacies')
          order by table_name`,
    );
    expect(restored).toEqual(['candidacies', 'people']);
    expect(
      await texts(db, sql`select extname as value from pg_extension where extname = 'unaccent'`),
    ).toEqual(['unaccent']);
  });
});
