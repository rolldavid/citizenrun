import { LEGAL_VERSIONS, color } from '@citizenrun/shared';
import { avatarKeys } from '@citizenrun/shared/storage';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { authIdentities, userConsents, userIssues, users } from '../../schema/accounts.ts';
import { issues } from '../../schema/reference.ts';
import { uploads } from '../../schema/social.ts';
import {
  getTestBucket,
  getTestDb,
  getTestObject,
  insertUser,
  resetStorage,
} from '../../testing/index.ts';
import { SEED_AVATAR_UPLOAD_IDS, SEED_USER_IDS } from '../ids.ts';
import { SeedError } from '../step.ts';
import { seedUsersStep } from './010-users.ts';

// TEST-seed-users: seed step 010-users on a worker database and the worker's media bucket.

const ANCHOR = new Date('2027-03-05T12:00:00.000Z');
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SEED_IDS: readonly string[] = Object.values(SEED_USER_IDS);
// How far a decoded JPEG pixel may sit from the color it was drawn with.
const PIXEL_TOLERANCE = 8;

function memberKey(number: number): keyof typeof SEED_USER_IDS {
  return String(number).padStart(2, '0') as keyof typeof SEED_USER_IDS; // 01 to 49, all in the table
}

function memberId(number: number): string {
  return SEED_USER_IDS[memberKey(number)];
}

async function runStep(anchor: Date = ANCHOR): Promise<void> {
  const media = await getTestBucket('media');
  await getTestDb().transaction(async (tx) => {
    await seedUsersStep(tx, { anchor, media });
  });
}

async function seedUserRows() {
  return getTestDb()
    .select()
    .from(users)
    .where(inArray(users.id, [...SEED_IDS]));
}

async function userById(id: string) {
  const [row] = await getTestDb().select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('The seed user is missing.');
  }
  return row;
}

async function countOf(
  table: 'users' | 'auth_identities' | 'user_consents' | 'user_issues' | 'uploads',
) {
  const rows = await getTestDb().execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

async function issueIdsBySort(): Promise<string[]> {
  const rows = await getTestDb().select({ id: issues.id }).from(issues).orderBy(asc(issues.sort));
  return rows.map((row) => row.id);
}

/** A user's picks as 0-based `sort` positions, in position order of the formula's j, with the starred ones. */
async function picksOf(userId: string): Promise<{ positions: Set<number>; starred: Set<number> }> {
  const order = await issueIdsBySort();
  const rows = await getTestDb()
    .select({ issueId: userIssues.issueId, starred: userIssues.starred })
    .from(userIssues)
    .where(eq(userIssues.userId, userId));
  const positionOf = (id: string): number => order.indexOf(id);
  return {
    positions: new Set(rows.map((row) => positionOf(row.issueId))),
    starred: new Set(rows.filter((row) => row.starred).map((row) => positionOf(row.issueId))),
  };
}

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ]; // three channels of a #rrggbb color
}

async function pixelAt(image: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1];
}

function expectNear(actual: readonly number[], expected: readonly number[]): void {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs((actual[index] ?? -1) - value)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  }
}

beforeEach(async () => {
  await resetStorage();
});

describe('seed step 010-users', () => {
  it('writes fifty users with the fixed ids and seed handles', async () => {
    await runStep();
    const rows = await seedUserRows();
    expect(rows).toHaveLength(50);
    expect(await countOf('users')).toBe(50);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(SEED_USER_IDS.admin)?.handle).toBe('seed_admin');
    expect(byId.get(SEED_USER_IDS.admin)?.name).toBe('Seed Admin');
    for (let number = 1; number <= 49; number += 1) {
      const nn = String(number).padStart(2, '0');
      const row = byId.get(memberId(number));
      expect(row?.handle).toBe(`seed_user_${nn}`);
      expect(row?.name).toBe(`Seed User ${nn}`);
      expect(row?.email).toBe(`seed_user_${nn}@example.test`);
      expect(row?.role).toBe('user');
      expect(row?.status).toBe('active');
      expect(row?.emailStatus).toBe('ok');
      expect(row?.locale).toBe('en');
      expect(row?.handleChangedAt).toBeNull();
    }
  });

  it('the admin uses the local admin address and the admin role', async () => {
    await runStep();
    const admin = await userById(SEED_USER_IDS.admin);
    expect(admin.email).toBe('admin@example.test');
    expect(admin.role).toBe('admin');
    const admins = await getTestDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    expect(admins).toEqual([{ id: SEED_USER_IDS.admin }]);
  });

  it('accounts are dated from the anchor', async () => {
    await runStep();
    const expected: [string, Date][] = [
      [memberId(1), new Date(ANCHOR.getTime() - 30 * DAY_MS - 1 * MINUTE_MS)],
      [memberId(44), new Date(ANCHOR.getTime() - 30 * DAY_MS - 44 * MINUTE_MS)],
      [memberId(45), new Date(ANCHOR.getTime() - 2 * DAY_MS)],
      [memberId(49), new Date(ANCHOR.getTime() - 2 * DAY_MS)],
      [SEED_USER_IDS.admin, new Date(ANCHOR.getTime() - 60 * DAY_MS)],
    ];
    for (const [id, createdAt] of expected) {
      const row = await userById(id);
      expect(row.createdAt).toEqual(createdAt);
    }
    expect((await userById(memberId(1))).createdAt.toISOString()).toBe('2027-02-03T11:59:00.000Z');
    for (const row of await seedUserRows()) {
      expect(row.onboardingStep).toBe('done');
      expect(row.onboardedAt?.getTime()).toBe(row.createdAt.getTime() + 45 * SECOND_MS);
    }
  });

  it('every user has one verified email identity and an age record that claims no result', async () => {
    await runStep();
    const identities = await getTestDb().select().from(authIdentities);
    expect(identities).toHaveLength(50);
    for (const row of await seedUserRows()) {
      const own = identities.filter((identity) => identity.userId === row.id);
      expect(own).toHaveLength(1);
      expect(own[0]?.provider).toBe('email');
      expect(own[0]?.subject).toBe(row.email);
      expect(own[0]?.email).toBe(row.email);
      expect(own[0]?.emailVerified).toBe(true);
      expect(row.ageMethod).toBe('none');
      expect(row.ageResult).toBeNull();
      expect(row.ageSourceTier).toBeNull();
      expect(row.ageCheckedAt).toEqual(row.createdAt);
    }
  });

  it('consents carry the current versions and are rewritten on every run', async () => {
    await runStep();
    const consents = await getTestDb().select().from(userConsents);
    expect(consents).toHaveLength(200);
    const created = new Map((await seedUserRows()).map((row) => [row.id, row.createdAt]));
    for (const consent of consents) {
      const kind = consent.kind as keyof typeof LEGAL_VERSIONS; // the kind check admits these four only
      expect(consent.version).toBe(LEGAL_VERSIONS[kind]);
      expect(consent.granted).toBe(true);
      expect(consent.platform).toBe('web');
      expect(consent.createdAt.getTime()).toBe(
        (created.get(consent.userId)?.getTime() ?? 0) + 30 * SECOND_MS,
      );
    }
    for (const userId of SEED_IDS) {
      const kinds = consents.filter((consent) => consent.userId === userId).map((c) => c.kind);
      expect(kinds.sort()).toEqual(['ai_screening', 'content_policy', 'privacy_policy', 'terms']);
    }

    const [first] = consents;
    if (first === undefined) {
      throw new Error('No consent was written.');
    }
    await getTestDb()
      .update(userConsents)
      .set({ version: '2000-01-01' })
      .where(eq(userConsents.id, first.id));
    await runStep();
    const [rewritten] = await getTestDb()
      .select()
      .from(userConsents)
      .where(eq(userConsents.id, first.id));
    expect(rewritten?.version).toBe(first.version);
    expect(await countOf('user_consents')).toBe(200);
  });

  it('issue picks follow the formula', async () => {
    await runStep();
    const cases: [string, number[], number[]][] = [
      [memberId(1), [7, 12, 17, 3], [7]],
      [memberId(7), [11, 16, 2, 7, 12, 17, 3, 8, 13, 18], [11, 16, 2]],
      [memberId(49), [1, 6, 11, 16], [1]],
      [SEED_USER_IDS.admin, [8, 13, 18, 4, 9], [8, 13]],
    ];
    for (const [userId, positions, starred] of cases) {
      const picks = await picksOf(userId);
      expect([...picks.positions].sort((a, b) => a - b)).toEqual(
        [...positions].sort((a, b) => a - b),
      );
      expect([...picks.starred].sort((a, b) => a - b)).toEqual([...starred].sort((a, b) => a - b));
    }
    expect(await countOf('user_issues')).toBe(321);
  });

  it('users 01 to 30 have a placeholder avatar with both objects', async () => {
    await runStep();
    const order = await issueIdsBySort();
    const issueRows = await getTestDb()
      .select({ id: issues.id, colorLight: issues.colorLight })
      .from(issues);
    const colorOf = new Map(issueRows.map((row) => [row.id, row.colorLight]));
    for (let number = 1; number <= 30; number += 1) {
      const key = memberKey(number);
      const userId = memberId(number);
      const uploadId = SEED_AVATAR_UPLOAD_IDS[key as keyof typeof SEED_AVATAR_UPLOAD_IDS]; // 01 to 30
      const keys = avatarKeys(userId, uploadId);
      const row = await userById(userId);
      expect(row.avatarKey).toBe(keys.small);
      expect(row.avatarKey?.endsWith('/320.jpg')).toBe(true);

      for (const [objectKey, side] of [
        [keys.small, 320],
        [keys.large, 1080],
      ] as const) {
        const object = await getTestObject('media', objectKey);
        expect(object, objectKey).not.toBeNull();
        const metadata = await sharp(object ?? new Uint8Array()).metadata();
        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(side);
        expect(metadata.height).toBe(side);
        expect(metadata.exif).toBeUndefined();
      }

      const [upload] = await getTestDb().select().from(uploads).where(eq(uploads.id, uploadId));
      expect(upload?.userId).toBe(userId);
      expect(upload?.key).toBe(`incoming/${userId}/${uploadId}.jpg`);
      expect(upload?.kind).toBe('photo');
      expect(upload?.purpose).toBe('avatar');
      expect(upload?.platform).toBe('web');
      expect(upload?.contentType).toBe('image/jpeg');
      expect(upload?.maxBytes).toBe(8_388_608);
      expect(upload?.bytes).toBe(upload?.declaredBytes);
      expect(upload?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(upload?.createdAt.getTime()).toBe(row.createdAt.getTime() + 20 * SECOND_MS);
      expect(upload?.consumedAt?.getTime()).toBe(row.createdAt.getTime() + 30 * SECOND_MS);
      expect(upload?.objectDeletedAt?.getTime()).toBe(row.createdAt.getTime() + 40 * SECOND_MS);
      // The original is never written.
      expect(await getTestObject('media', upload?.key ?? '')).toBeNull();
    }

    // The drawing: a field of the issue at sort index NN mod 19 with a bg-colored circle in the middle.
    const small = await getTestObject(
      'media',
      avatarKeys(memberId(1), SEED_AVATAR_UPLOAD_IDS['01']).small,
    );
    const fieldColor = colorOf.get(order[1] ?? '') ?? '';
    expectNear(await pixelAt(small ?? new Uint8Array(), 4, 4), rgbOf(fieldColor));
    expectNear(await pixelAt(small ?? new Uint8Array(), 160, 160), rgbOf(color.light.bg));

    const others = [...Array.from({ length: 19 }, (_, i) => memberId(31 + i)), SEED_USER_IDS.admin];
    for (const userId of others) {
      expect((await userById(userId)).avatarKey).toBeNull();
    }
    const otherUploads = await getTestDb()
      .select({ id: uploads.id })
      .from(uploads)
      .where(inArray(uploads.userId, others));
    expect(otherUploads).toEqual([]);
    expect(await countOf('uploads')).toBe(30);
  });

  it('bios and links follow the templates', async () => {
    await runStep();
    for (let number = 1; number <= 49; number += 1) {
      const nn = String(number).padStart(2, '0');
      const row = await userById(memberId(number));
      expect(row.bio).toBe(number <= 20 ? `Seed account ${nn} for local testing.` : null);
      expect(row.link).toBe(number <= 5 ? `https://example.test/seed_user_${nn}` : null);
    }
    const admin = await userById(SEED_USER_IDS.admin);
    expect(admin.bio).toBeNull();
    expect(admin.link).toBeNull();
  });

  it('running twice with two anchors leaves one copy of everything', async () => {
    await runStep();
    const tables = ['users', 'auth_identities', 'user_consents', 'user_issues', 'uploads'] as const;
    const first = await Promise.all(tables.map(countOf));
    expect(first).toEqual([50, 50, 200, 321, 30]);

    const later = new Date(ANCHOR.getTime() + 3 * DAY_MS);
    await runStep(later);
    expect(await Promise.all(tables.map(countOf))).toEqual(first);
    expect((await userById(memberId(1))).createdAt).toEqual(
      new Date(later.getTime() - 30 * DAY_MS - 1 * MINUTE_MS),
    );
    expect((await userById(SEED_USER_IDS.admin)).createdAt).toEqual(
      new Date(later.getTime() - 60 * DAY_MS),
    );
  });

  it('refuses when a non-seed user holds a seed email', async () => {
    const other = await insertUser(getTestDb(), { email: 'seed_user_07@example.test' });
    let caught: unknown = null;
    try {
      await runStep();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SeedError);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toBe('A non-seed user holds a seed email address; run pnpm db:reset');
    expect(message).not.toContain('@');
    const remaining = await getTestDb().select({ id: users.id }).from(users);
    expect(remaining).toEqual([{ id: other.id }]);
  });
});
