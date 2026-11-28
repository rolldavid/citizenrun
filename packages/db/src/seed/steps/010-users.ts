import { createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { LEGAL_VERSIONS, color } from '@citizenrun/shared';
import { avatarKeys, incomingUploadKey } from '@citizenrun/shared/storage';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../client.ts';
import { authIdentities, userConsents, userIssues, users } from '../../schema/accounts.ts';
import type { NewUserConsentRow, NewUserRow } from '../../schema/accounts.ts';
import { issues } from '../../schema/reference.ts';
import { uploads } from '../../schema/social.ts';
import type { NewUploadRow } from '../../schema/social.ts';
import { seedAvatarImages } from '../avatar-image.ts';
import { SEED_AVATAR_UPLOAD_IDS, SEED_CONSENT_IDS, SEED_USER_IDS } from '../ids.ts';
import type { SeedUserKey } from '../ids.ts';
import { SeedError } from '../step.ts';
import type { SeedContext, SeedStep } from '../step.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

// The admin counts as user 50 where a formula needs a number.
const ADMIN_NUMBER = 50;
// Users 01 to 44 are established accounts; 45 to 49 are new accounts.
const LAST_ESTABLISHED = 44;
const LAST_WITH_BIO = 20;
const LAST_WITH_LINK = 5;
const LAST_WITH_AVATAR = 30;
// The photo limit an avatar upload ticket carries (8 MB).
const AVATAR_MAX_BYTES = 8_388_608;
const AVATAR_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONSENT_KINDS = ['terms', 'content_policy', 'privacy_policy', 'ai_screening'] as const;
// The reference list's length, which the pick and color formulas count around (T-issues).
const ISSUE_COUNT = 19;

type SeedUser = {
  key: SeedUserKey;
  number: number;
  id: string;
  handle: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
};

type IssueRow = { id: string; colorLight: string };

type AvatarImages = Awaited<ReturnType<typeof seedAvatarImages>>;

// The same two colors always give the same bytes, so each pair is drawn once per process.
const drawn = new Map<string, Promise<AvatarImages>>();

function avatarImages(issueColorLight: string, bgLight: string): Promise<AvatarImages> {
  const key = `${issueColorLight} ${bgLight}`;
  let images = drawn.get(key);
  if (images === undefined) {
    images = seedAvatarImages({ issueColorLight, bgLight });
    drawn.set(key, images);
    // A failed drawing is not kept, so a later run draws it again.
    images.catch(() => drawn.delete(key));
  }
  return images;
}

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

function twoDigits(number: number): string {
  return String(number).padStart(2, '0');
}

function userKey(number: number): SeedUserKey {
  const key = twoDigits(number);
  if (!Object.hasOwn(SEED_USER_IDS, key)) {
    throw new RangeError(`No seed user ${key}`);
  }
  return key as SeedUserKey; // checked against the table above
}

/** The 50 seed users, dated from the anchor: the admin first, then 01 to 49. */
function seedUsers(anchor: Date): SeedUser[] {
  const admin: SeedUser = {
    key: 'admin',
    number: ADMIN_NUMBER,
    id: SEED_USER_IDS.admin,
    handle: 'seed_admin',
    name: 'Seed Admin',
    email: 'admin@example.test',
    role: 'admin',
    createdAt: shift(anchor, -60 * DAY_MS),
  };
  const others = Array.from({ length: 49 }, (_, index): SeedUser => {
    const number = index + 1;
    const key = userKey(number);
    const nn = twoDigits(number);
    return {
      key,
      number,
      id: SEED_USER_IDS[key],
      handle: `seed_user_${nn}`,
      name: `Seed User ${nn}`,
      email: `seed_user_${nn}@example.test`,
      role: 'user',
      createdAt:
        number <= LAST_ESTABLISHED
          ? shift(anchor, -30 * DAY_MS - number * MINUTE_MS)
          : shift(anchor, -2 * DAY_MS),
    };
  });
  return [admin, ...others];
}

function avatarUploadId(user: SeedUser): string | null {
  if (user.key === 'admin' || user.number > LAST_WITH_AVATAR) {
    return null;
  }
  return SEED_AVATAR_UPLOAD_IDS[user.key as keyof typeof SEED_AVATAR_UPLOAD_IDS]; // users 01 to 30
}

function userRow(user: SeedUser): NewUserRow {
  const isMember = user.key !== 'admin';
  const nn = twoDigits(user.number);
  const uploadId = avatarUploadId(user);
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    ageMethod: 'none',
    ageResult: null,
    ageSourceTier: null,
    ageCheckedAt: user.createdAt,
    onboardingStep: 'done',
    onboardedAt: shift(user.createdAt, 45 * SECOND_MS),
    bio: isMember && user.number <= LAST_WITH_BIO ? `Seed account ${nn} for local testing.` : null,
    link: isMember && user.number <= LAST_WITH_LINK ? `https://example.test/seed_user_${nn}` : null,
    avatarKey: uploadId === null ? null : avatarKeys(user.id, uploadId).small,
    status: 'active',
    emailStatus: 'ok',
    locale: 'en',
    handleChangedAt: null,
  };
}

/** The 0-based `sort` positions of a user's picks, and how many of the first are starred. */
function seedIssuePicks(number: number): { positions: number[]; starred: number } {
  const count = 3 + (number % 8);
  const positions = Array.from({ length: count }, (_, j) => (7 * number + 5 * j) % ISSUE_COUNT);
  return { positions, starred: Math.min(number % 4, count) };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function refuseTakenEmails(tx: Tx, all: readonly SeedUser[]): Promise<void> {
  const emails = all.map((user) => user.email);
  const ids = all.map((user) => user.id);
  const taken = await tx.execute<{ one: number }>(
    sql`select 1 as one from users
        where email = any(${sql.param(emails)}::citext[]) and id <> all(${sql.param(ids)}::uuid[])
        limit 1`,
    'objects',
  );
  if (taken.length > 0) {
    // Names no address: an email is never logged.
    throw new SeedError('A non-seed user holds a seed email address; run pnpm db:reset');
  }
}

/** Writes the placeholder avatar objects of users 01 to 30 and returns each original's size and hash. */
async function putAvatars(
  ctx: SeedContext,
  all: readonly SeedUser[],
  issueRows: readonly IssueRow[],
): Promise<Map<string, { bytes: number; sha256: string }>> {
  const originals = new Map<string, { bytes: number; sha256: string }>();
  for (const user of all) {
    const uploadId = avatarUploadId(user);
    if (uploadId === null) {
      continue;
    }
    const issue = issueRows[user.number % ISSUE_COUNT];
    if (issue === undefined) {
      throw new SeedError('The issues table has fewer than 19 rows');
    }
    const images = await avatarImages(issue.colorLight, color.light.bg);
    const keys = avatarKeys(user.id, uploadId);
    for (const [key, body] of [
      [keys.large, images.w1080],
      [keys.small, images.w320],
    ] as const) {
      await ctx.media.client.send(
        new PutObjectCommand({
          Bucket: ctx.media.bucket,
          Key: key,
          Body: body,
          ContentType: 'image/jpeg',
          CacheControl: AVATAR_CACHE_CONTROL,
        }),
      );
    }
    originals.set(user.id, { bytes: images.original.length, sha256: sha256Hex(images.original) });
  }
  return originals;
}

/**
 * Seed step `010-users`: the 50 seed users with their email identities, current consents, issue
 * picks and, for users 01 to 30, placeholder avatars. Idempotent on fixed ids; logs nothing.
 */
export async function seedUsersStep(tx: Tx, ctx: SeedContext): Promise<void> {
  const all = seedUsers(ctx.anchor);
  await refuseTakenEmails(tx, all);

  // The reference rows, read whole once.
  const issueRows: IssueRow[] = await tx
    .select({ id: issues.id, colorLight: issues.colorLight })
    .from(issues)
    .orderBy(issues.sort);
  if (issueRows.length < ISSUE_COUNT) {
    throw new SeedError('The issues table has fewer than 19 rows');
  }

  // The bucket answers before any row is written, so no row lock is held meanwhile.
  const originals = await putAvatars(ctx, all, issueRows);

  await tx
    .insert(users)
    .values(all.map(userRow))
    .onConflictDoUpdate({
      target: users.id,
      set: {
        handle: sql`excluded.handle`,
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        role: sql`excluded.role`,
        createdAt: sql`excluded.created_at`,
        ageMethod: sql`excluded.age_method`,
        ageResult: sql`excluded.age_result`,
        ageSourceTier: sql`excluded.age_source_tier`,
        ageCheckedAt: sql`excluded.age_checked_at`,
        onboardingStep: sql`excluded.onboarding_step`,
        onboardedAt: sql`excluded.onboarded_at`,
        bio: sql`excluded.bio`,
        link: sql`excluded.link`,
        avatarKey: sql`excluded.avatar_key`,
        status: sql`excluded.status`,
        emailStatus: sql`excluded.email_status`,
        locale: sql`excluded.locale`,
        handleChangedAt: sql`excluded.handle_changed_at`,
      },
    });

  await tx
    .insert(authIdentities)
    .values(
      all.map((user) => ({
        userId: user.id,
        provider: 'email',
        subject: user.email.toLowerCase(),
        email: user.email.toLowerCase(),
        emailVerified: true,
        createdAt: user.createdAt,
      })),
    )
    .onConflictDoUpdate({
      target: [authIdentities.provider, authIdentities.subject],
      set: {
        userId: sql`excluded.user_id`,
        email: sql`excluded.email`,
        emailVerified: sql`excluded.email_verified`,
      },
    });

  const consents: NewUserConsentRow[] = all.flatMap((user) =>
    CONSENT_KINDS.map((kind) => ({
      id: SEED_CONSENT_IDS[user.key][kind],
      userId: user.id,
      kind,
      version: LEGAL_VERSIONS[kind],
      granted: true,
      platform: 'web',
      createdAt: shift(user.createdAt, 30 * SECOND_MS),
    })),
  );
  await tx
    .insert(userConsents)
    .values(consents)
    .onConflictDoUpdate({
      target: userConsents.id,
      set: {
        version: sql`excluded.version`,
        granted: sql`excluded.granted`,
        createdAt: sql`excluded.created_at`,
      },
    });

  const ids = all.map((user) => user.id);
  await tx.execute(sql`delete from user_issues where user_id = any(${sql.param(ids)}::uuid[])`);
  const picks = all.flatMap((user) => {
    const { positions, starred } = seedIssuePicks(user.number);
    return positions.map((position, j) => {
      const issue = issueRows[position];
      if (issue === undefined) {
        throw new SeedError('The issues table has fewer than 19 rows');
      }
      return { userId: user.id, issueId: issue.id, starred: j < starred };
    });
  });
  await tx.insert(userIssues).values(picks);

  const uploadRows: NewUploadRow[] = [];
  for (const user of all) {
    const uploadId = avatarUploadId(user);
    const original = originals.get(user.id);
    if (uploadId === null || original === undefined) {
      continue;
    }
    uploadRows.push({
      id: uploadId,
      userId: user.id,
      key: incomingUploadKey(user.id, uploadId, 'image/jpeg'),
      kind: 'photo',
      purpose: 'avatar',
      platform: 'web',
      contentType: 'image/jpeg',
      maxBytes: AVATAR_MAX_BYTES,
      declaredBytes: original.bytes,
      bytes: original.bytes,
      sha256: original.sha256,
      createdAt: shift(user.createdAt, 20 * SECOND_MS),
      consumedAt: shift(user.createdAt, 30 * SECOND_MS),
      objectDeletedAt: shift(user.createdAt, 40 * SECOND_MS),
    });
  }
  await tx
    .insert(uploads)
    .values(uploadRows)
    .onConflictDoUpdate({
      target: uploads.id,
      set: {
        userId: sql`excluded.user_id`,
        key: sql`excluded.key`,
        kind: sql`excluded.kind`,
        purpose: sql`excluded.purpose`,
        platform: sql`excluded.platform`,
        contentType: sql`excluded.content_type`,
        maxBytes: sql`excluded.max_bytes`,
        declaredBytes: sql`excluded.declared_bytes`,
        bytes: sql`excluded.bytes`,
        sha256: sql`excluded.sha256`,
        createdAt: sql`excluded.created_at`,
        consumedAt: sql`excluded.consumed_at`,
        objectDeletedAt: sql`excluded.object_deleted_at`,
      },
    });
}

/** Seed step `010-users`. */
export const step: SeedStep = { name: '010-users', run: seedUsersStep };
