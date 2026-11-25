import {
  authChallenges,
  authIdentities,
  emailCodes,
  issues,
  sessions,
  users,
} from '@citizenrun/db';
import type { Db, UserRow } from '@citizenrun/db';
import {
  insertAppEvent,
  insertConsents,
  insertDataExport,
  insertRateCounter,
  insertUpload,
  insertUser,
  setUserIssues,
} from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import {
  emailCodeHash,
  encryptRefreshToken,
  randomToken,
  sha256Hex,
} from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { avatarKeys } from '@citizenrun/shared/storage';
import { asc, eq } from 'drizzle-orm';
import { putObject } from '../lib/bucket-ops.ts';
import type { Bucket } from '../lib/storage.ts';

// TEST-account-deletion's scenario, which TEST-account-export reads too: one user with a row of
// every kind of owned data that exists, and a second user with rows of their own. One step per
// table; a table added later adds its step at the end of EVERY_KIND_STEPS.

/** What the scenario made, for the deletion and export tests. */
export type EveryKind = {
  user: { id: string; email: string; handle: string };
  other: { id: string };
  apple: { subject: string; clientId: string; refreshToken: string };
  /** Secrets and hashes no export may contain. */
  forbidden: readonly string[];
  objectKeys: { user: readonly string[]; other: readonly string[] };
};

/** The scenario while its steps run: each step adds its rows, objects and forbidden values. */
export type EveryKindBuild = {
  db: Db;
  media: Bucket;
  keys: KeyRing;
  now: Date;
  /** This scenario's number, in fixture values that must differ between scenarios. */
  seq: number;
  user: UserRow & { email: string; handle: string };
  other: UserRow & { email: string };
  apple: { subject: string; clientId: string; refreshToken: string };
  forbidden: string[];
  objectKeys: { user: string[]; other: string[] };
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const APPLE_CLIENT_ID = 'fixture.services.id';
const FIXTURE_CODE = '123456';
// A few bytes stand for each object: nothing decodes them.
const FIXTURE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const FIXTURE_JSON = new TextEncoder().encode('{"fixture":true}');

let scenarios = 0;

function after(now: Date, ms: number): Date {
  return new Date(now.getTime() + ms);
}

// The start of the UTC day of `at`.
function utcDay(at: Date): Date {
  return new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);
}

/** `users`: the two users, each with the verified `email` identity of the factory. */
export async function everyKindUsers(
  db: Db,
  media: Bucket,
  keys: KeyRing,
  now: Date,
): Promise<EveryKindBuild> {
  scenarios += 1;
  const seq = scenarios;
  const calendarTokenHash = sha256Hex(`fixture-calendar-${String(seq)}`);
  const user = await insertUser(db, { calendarTokenHash }, { now });
  const other = await insertUser(db, {}, { now });
  if (user.email === null || user.handle === null || other.email === null) {
    throw new Error('The user factory gave no email or handle.');
  }
  return {
    db,
    media,
    keys,
    now,
    seq,
    user: { ...user, email: user.email, handle: user.handle },
    other: { ...other, email: other.email },
    apple: { subject: '', clientId: APPLE_CLIENT_ID, refreshToken: '' },
    forbidden: [calendarTokenHash],
    objectKeys: { user: [], other: [] },
  };
}

/** `auth_identities`: an Apple identity with an encrypted refresh token and a Google identity. */
export async function everyKindAuthIdentities(build: EveryKindBuild): Promise<void> {
  const seq = String(build.seq);
  const subject = `fixture-apple-${seq}`;
  const refreshToken = `fixture-refresh-${seq}`;
  const googleSubject = `fixture-google-${seq}`;
  const refreshTokenEnc = encryptRefreshToken(build.keys, refreshToken, subject);
  await build.db.insert(authIdentities).values([
    {
      userId: build.user.id,
      provider: 'apple',
      subject,
      refreshTokenEnc,
      clientId: APPLE_CLIENT_ID,
      isPrivateEmail: false,
      email: build.user.email,
      emailVerified: true,
      createdAt: build.now,
    },
    {
      userId: build.user.id,
      provider: 'google',
      subject: googleSubject,
      email: build.user.email,
      emailVerified: true,
      createdAt: build.now,
    },
  ]);
  build.apple = { subject, clientId: APPLE_CLIENT_ID, refreshToken };
  const blob = Buffer.from(refreshTokenEnc);
  build.forbidden.push(
    subject,
    googleSubject,
    APPLE_CLIENT_ID,
    refreshToken,
    blob.toString('hex'),
    blob.toString('base64'),
  );
}

/** `email_codes`: a pending sign-in code for each user's address. */
export async function everyKindEmailCodes(build: EveryKindBuild): Promise<void> {
  for (const email of [build.user.email, build.other.email]) {
    const codeHash = emailCodeHash(build.keys, email, FIXTURE_CODE);
    const pendingToken = randomToken();
    const pendingTokenHash = sha256Hex(pendingToken);
    await build.db.insert(emailCodes).values({
      id: newId(),
      email,
      codeHash,
      pendingTokenHash,
      expiresAt: after(build.now, 10 * MINUTE_MS),
    });
    build.forbidden.push(codeHash, pendingToken, pendingTokenHash);
  }
}

/** `auth_challenges`: an Apple hand-off for the user and a nonce that names no one. */
export async function everyKindAuthChallenges(build: EveryKindBuild): Promise<void> {
  for (const kind of ['apple_handoff', 'nonce'] as const) {
    const secret = randomToken();
    const secretHash = sha256Hex(secret);
    await build.db.insert(authChallenges).values({
      id: newId(),
      kind,
      secretHash,
      userId: kind === 'apple_handoff' ? build.user.id : null,
      expiresAt: after(build.now, 10 * MINUTE_MS),
    });
    build.forbidden.push(secret, secretHash);
  }
}

/** `sessions`: an iOS and a web session for the user, an iOS session for the other user. */
export async function everyKindSessions(build: EveryKindBuild): Promise<void> {
  const rows = [
    { userId: build.user.id, platform: 'ios' },
    { userId: build.user.id, platform: 'web' },
    { userId: build.other.id, platform: 'ios' },
  ] as const;
  for (const row of rows) {
    const token = randomToken();
    const tokenHash = sha256Hex(token);
    await build.db.insert(sessions).values({
      id: newId(),
      userId: row.userId,
      platform: row.platform,
      tokenHash,
      expiresAt: after(build.now, 90 * DAY_MS),
    });
    build.forbidden.push(token, tokenHash);
  }
}

/** `user_consents`: the four consents of sign-up for each user. */
export async function everyKindUserConsents(build: EveryKindBuild): Promise<void> {
  await insertConsents(build.db, build.user.id);
  await insertConsents(build.db, build.other.id);
}

/** `user_issues`: three picks for each user, the user's second one starred. */
export async function everyKindUserIssues(build: EveryKindBuild): Promise<void> {
  const firstThree = await build.db
    .select({ id: issues.id })
    .from(issues)
    .orderBy(asc(issues.sort))
    .limit(3);
  await setUserIssues(
    build.db,
    build.user.id,
    firstThree.map((issue, index) => ({ issueId: issue.id, starred: index === 1 })),
  );
  await setUserIssues(build.db, build.other.id);
}

// A consumed avatar upload: its original under incoming/, the two renditions under avatars/, and
// the user's avatar_key on the small one.
async function insertAvatar(build: EveryKindBuild, userId: string, keys: string[]): Promise<void> {
  const upload = await insertUpload(build.db, { userId, consumedAt: build.now });
  const { small, large } = avatarKeys(userId, upload.id);
  await putObject(build.media, upload.key, FIXTURE_JPEG, { contentType: 'image/jpeg' });
  await putObject(build.media, large, FIXTURE_JPEG, { contentType: 'image/jpeg' });
  await putObject(build.media, small, FIXTURE_JPEG, { contentType: 'image/jpeg' });
  await build.db.update(users).set({ avatarKey: small }).where(eq(users.id, userId));
  keys.push(upload.key, large, small);
}

/** `uploads`: an avatar for each user, and an upload the user never attached. */
export async function everyKindUploads(build: EveryKindBuild): Promise<void> {
  await insertAvatar(build, build.user.id, build.objectKeys.user);
  await insertAvatar(build, build.other.id, build.objectKeys.other);
  const unconsumed = await insertUpload(build.db, { userId: build.user.id });
  await putObject(build.media, unconsumed.key, FIXTURE_JPEG, { contentType: 'image/jpeg' });
  build.objectKeys.user.push(unconsumed.key);
}

/** `rate_limits`: the user's email cap for today and yesterday, and the other user's for today. */
export async function everyKindRateLimits(build: EveryKindBuild): Promise<void> {
  const today = utcDay(build.now);
  const yesterday = after(today, -DAY_MS);
  await insertRateCounter(build.db, { key: `u:${build.user.id}:email:1d`, windowStart: today });
  await insertRateCounter(build.db, { key: `u:${build.user.id}:email:1d`, windowStart: yesterday });
  await insertRateCounter(build.db, { key: `u:${build.other.id}:email:1d`, windowStart: today });
}

/** `app_events`: one event for each user. */
export async function everyKindAppEvents(build: EveryKindBuild): Promise<void> {
  await insertAppEvent(build.db, { userId: build.user.id }, { now: build.now });
  await insertAppEvent(build.db, { userId: build.other.id }, { now: build.now });
}

/** `data_exports`: a ready export with its file under exports/<user id>/ for each user. */
export async function everyKindDataExports(build: EveryKindBuild): Promise<void> {
  const targets = [
    { userId: build.user.id, keys: build.objectKeys.user },
    { userId: build.other.id, keys: build.objectKeys.other },
  ];
  for (const target of targets) {
    const row = await insertDataExport(
      build.db,
      { userId: target.userId, status: 'ready' },
      { now: build.now },
    );
    if (row.objectKey === null) {
      throw new Error('A ready export has no object key.');
    }
    await putObject(build.media, row.objectKey, FIXTURE_JSON, {
      contentType: 'application/json',
    });
    target.keys.push(row.objectKey);
  }
}

/** The steps after `users`, in table order. */
export const EVERY_KIND_STEPS: readonly ((build: EveryKindBuild) => Promise<void>)[] = [
  everyKindAuthIdentities,
  everyKindEmailCodes,
  everyKindAuthChallenges,
  everyKindSessions,
  everyKindUserConsents,
  everyKindUserIssues,
  everyKindUploads,
  everyKindRateLimits,
  everyKindAppEvents,
  everyKindDataExports,
];

/** Gives one user a row of every kind of owned data that exists, and a second user rows of their own. One step function per table. */
export async function insertEveryKind(
  db: Db,
  media: Bucket,
  keys: KeyRing,
  now: Date,
): Promise<EveryKind> {
  const build = await everyKindUsers(db, media, keys, now);
  for (const step of EVERY_KIND_STEPS) {
    await step(build);
  }
  return {
    user: { id: build.user.id, email: build.user.email, handle: build.user.handle },
    other: { id: build.other.id },
    apple: { ...build.apple },
    forbidden: [...build.forbidden],
    objectKeys: { user: [...build.objectKeys.user], other: [...build.objectKeys.other] },
  };
}
