import {
  bookmarks,
  districts,
  fieldReports,
  issues,
  offices,
  userDistricts,
  users,
} from '@citizenrun/db';
import { getTestBucket, getTestDb, insertUser, resetStorage } from '@citizenrun/db/testing';
import { ExportFileSchema } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { mediaUrl } from '@citizenrun/shared/storage';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { testWorkerEnv } from '../../testing/env.ts';
import { insertEveryKind } from '../../testing/every-kind.ts';
import { buildExportFile } from './export-file.ts';

function testKeys(): KeyRing {
  const env = testWorkerEnv();
  return loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS);
}

async function userRow(userId: string): Promise<typeof users.$inferSelect> {
  const [row] = await getTestDb().select().from(users).where(eq(users.id, userId));
  if (row === undefined) {
    throw new Error('The fixture user is missing.');
  }
  return row;
}

beforeEach(async () => {
  await resetStorage();
});

describe('the export file', () => {
  it('maps the account from its columns', async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);
    const user = await userRow(kind.user.id);
    expect(user.avatarKey).not.toBeNull();

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.formatVersion).toBe(1);
    expect(file.generatedAt).toBe(now.toISOString());
    expect(file.account).toEqual({
      id: user.id,
      handle: user.handle,
      name: user.name,
      bio: user.bio,
      link: user.link,
      avatarUrl: await mediaUrl(media.client, media.bucket, user.avatarKey ?? '', now),
      email: user.email,
      locale: user.locale,
      status: user.status,
      dmPolicy: user.dmPolicy,
      tagPolicy: user.tagPolicy,
      personalize: user.personalize,
      acceptsHelp: user.acceptsHelp,
      locationPrecision: user.locationPrecision,
      createdAt: user.createdAt.toISOString(),
      onboardedAt: user.onboardedAt?.toISOString() ?? null,
      age: {
        method: 'none',
        result: null,
        sourceTier: null,
        checkedAt: user.ageCheckedAt?.toISOString(),
      },
    });
    expect(file.account.avatarUrl).toContain(`/${user.avatarKey ?? ''}?`);
    expect(file.account.avatarUrl).toContain('X-Amz-Signature=');
    expect(ExportFileSchema.safeParse(file).success).toBe(true);
  });

  it('writes the result and the tier of a store signal age record', async () => {
    const now = new FakeClock().now();
    const user = await insertUser(
      getTestDb(),
      { ageMethod: 'store_signal', ageResult: 'adult', ageSourceTier: 'confirmed' },
      { now },
    );

    const file = await buildExportFile(getTestDb(), await getTestBucket('media'), user.id, now);

    expect(file.account.age).toEqual({
      method: 'store_signal',
      result: 'adult',
      sourceTier: 'confirmed',
      checkedAt: user.ageCheckedAt?.toISOString(),
    });
    expect(ExportFileSchema.safeParse(file).success).toBe(true);
  });

  it('writes null for an avatar and an age record that do not exist', async () => {
    const now = new FakeClock().now();
    const user = await insertUser(
      getTestDb(),
      { ageMethod: null, ageResult: null, ageSourceTier: null, ageCheckedAt: null },
      { now },
    );

    const file = await buildExportFile(getTestDb(), await getTestBucket('media'), user.id, now);

    expect(file.account.avatarUrl).toBeNull();
    expect(file.account.age).toBeNull();
    expect(file.account.bio).toBeNull();
    expect(file.signInMethods).toEqual([
      { provider: 'email', email: user.email, createdAt: user.createdAt.toISOString() },
    ]);
    expect(file.consents).toEqual([]);
    expect(file.issues).toEqual([]);
    expect(file.districts).toEqual([]);
    expect(file.follows).toEqual([]);
    expect(file.bookmarks).toEqual([]);
    expect(file.fieldReportsFiled).toEqual([]);
  });

  it('lists sign-in methods without their secrets', async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);
    const user = await userRow(kind.user.id);

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.signInMethods).toEqual([
      { provider: 'email', email: kind.user.email, createdAt: user.createdAt.toISOString() },
      { provider: 'apple', email: kind.user.email, createdAt: now.toISOString() },
      { provider: 'google', email: kind.user.email, createdAt: now.toISOString() },
    ]);
    const text = JSON.stringify(file.signInMethods);
    for (const value of [kind.apple.subject, kind.apple.clientId, kind.apple.refreshToken]) {
      expect(text).not.toContain(value);
    }
  });

  it('lists every consent and issue', async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);
    const firstThree = await getTestDb()
      .select({ id: issues.id })
      .from(issues)
      .orderBy(asc(issues.sort))
      .limit(3);

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.consents.map((consent) => consent.kind)).toEqual([
      'terms',
      'content_policy',
      'privacy_policy',
      'ai_screening',
    ]);
    for (const consent of file.consents) {
      expect(consent.granted).toBe(true);
      expect(consent.platform).toBe('ios');
      expect(consent.version.length).toBeGreaterThan(0);
    }
    expect(file.issues).toEqual(
      firstThree.map((issue, index) => ({ issueId: issue.id, starred: index === 1 })),
    );
  });

  it("lists the user's districts with their names", async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.districts).toEqual([
      { id: kind.civic.districtIds[0], name: 'Fixture District One' },
      { id: kind.civic.districtIds[1], name: 'Fixture District Two' },
    ]);
  });

  it('lists follows', async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.follows).toEqual([
      { targetType: 'office', targetId: kind.civic.officeId, createdAt: now.toISOString() },
    ]);
  });

  it('lists bookmarks with the office slug', async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);
    const [office] = await getTestDb()
      .select({ slug: offices.slug })
      .from(offices)
      .where(eq(offices.id, kind.civic.officeId));

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.bookmarks).toEqual([
      { officeId: kind.civic.officeId, slug: office?.slug, createdAt: now.toISOString() },
    ]);
  });

  it('lists the field reports the user filed', async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    expect(file.fieldReportsFiled).toEqual([
      {
        officeId: kind.civic.officeId,
        field: null,
        message: `Fixture note ${marker()}`,
        sourceUrl: 'https://example.test/fixture-report',
        status: 'open',
        createdAt: now.toISOString(),
      },
    ]);
  });

  it("holds nothing of the second user's civic rows", async () => {
    const now = new FakeClock().now();
    const media = await getTestBucket('media');
    const kind = await insertEveryKind(getTestDb(), media, testKeys(), now);
    const theirDistricts = await getTestDb()
      .select({ id: districts.id, name: districts.name })
      .from(userDistricts)
      .innerJoin(districts, eq(districts.id, userDistricts.districtId))
      .where(eq(userDistricts.userId, kind.other.id));
    const theirBookmarks = await getTestDb()
      .select({ officeId: bookmarks.officeId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, kind.other.id));
    const theirReports = await getTestDb()
      .select({ officeId: fieldReports.officeId })
      .from(fieldReports)
      .where(eq(fieldReports.userId, kind.other.id));
    expect(theirDistricts).toHaveLength(1);
    expect(theirBookmarks).toHaveLength(1);
    expect(theirReports).toHaveLength(1);

    const file = await buildExportFile(getTestDb(), media, kind.user.id, now);

    const text = JSON.stringify(file);
    for (const value of [
      kind.other.id,
      ...theirDistricts.flatMap((row) => [row.id, row.name]),
      ...theirBookmarks.map((row) => row.officeId),
      ...theirReports.map((row) => row.officeId),
    ]) {
      expect(text).not.toContain(value);
    }
    expect(file.fieldReportsFiled).toHaveLength(1);
    expect(file.follows).toHaveLength(1);
  });
});
