import { generateKeyPairSync } from 'node:crypto';
import { dataExports, markAccountDeleting, users } from '@citizenrun/db';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDb,
  insertDataExport,
  insertUser,
} from '@citizenrun/db/testing';
import { JOB_NAMES, newId } from '@citizenrun/shared';
import type { JobName } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { accountDelete } from './jobs/account/delete.ts';
import { accountExport } from './jobs/account/export.ts';
import { uploadsCleanup } from './jobs/cleanup/uploads-cleanup.ts';
import { avatarUpload, setAvatarColumns } from './lib/media/testing/avatar-upload.ts';
import { mediaProcessImage } from './jobs/media/process-image.ts';
import { notifyEmail } from './jobs/notify/email.ts';
import { opsAlertJob } from './jobs/ops/alert.ts';
import { opsDeadJob } from './jobs/ops/dead.ts';
import { PermanentJobError } from './jobs/types.ts';
import { solidJpeg, truncated } from './lib/media/images.fixtures.ts';
import type { Bucket } from './lib/storage.ts';
import { QUEUE_REGISTRY } from './queues.ts';
import { testWorkerEnv } from './testing/env.ts';
import { insertEveryKind } from './testing/every-kind.ts';
import type { EveryKind } from './testing/every-kind.ts';
import { CaptureMailer } from './testing/fakes/mailer.ts';
import { createFakeOutbound } from './testing/fakes/outbound.ts';
import { runJob, runQueued } from './testing/job.ts';

// TEST-privacy-logscan's worker suite: every queue runs over values carrying the marker on its
// success, retry and permanent-failure paths, or is listed with the reason it cannot carry one.

type QueuePrivacy =
  | { covered: true; run: () => Promise<void>; noPermanentPath?: string }
  | { covered: false; reason: string };

const EMPTY_PAYLOAD = 'reads no row and no object that carries user text; its payload is empty';

const ADMINS = 'admin@example.test,second@example.test';
// The fixed words of the job_failed subject, which no log line may carry.
const SUBJECT_WORDS = 'A job failed three times';

class RejectingMailer extends CaptureMailer {
  override sendEmail(): Promise<void> {
    return Promise.reject(new PermanentJobError('The provider refused the message.'));
  }
}

function anyLineHolds(text: string): boolean {
  return captureLogs().lines.some((line) => line.raw.includes(text));
}

// The data of every ops.alert job row in any state.
async function alertJobData(): Promise<string> {
  const rows = await getTestDb().execute<{ data: unknown }>(
    sql`select data from pgboss.job where name = 'ops.alert'`,
    'objects',
  );
  return JSON.stringify(rows.map((row) => row.data));
}

async function deadLetterPaths(): Promise<void> {
  // Success: the payload never enters a job row; only its source reaches the alert.
  const mailer = new CaptureMailer();
  const dead = await runJob(
    opsDeadJob,
    { note: marker() },
    { deadLetter: { queue: 'backup.check', jobId: newId(), errorClass: 'FixtureFailure' } },
  );
  expect(dead.outcome).toBe('completed');
  const ran = await runQueued({ queues: ['ops.alert'], mailer });
  expect(ran.map((job) => job.outcome)).toEqual(['completed']);
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]?.text).toContain('FixtureFailure');
  expect(JSON.stringify(mailer.sent)).not.toContain(marker());
  expect(await alertJobData()).not.toContain(marker());
  expect(anyLineHolds(marker())).toBe(false);

  // Retry: the alert queue is missing, the job fails and is retried.
  const boss = await createTestBoss();
  await boss.deleteQueue('ops.alert');
  try {
    const failed = await runJob(
      opsDeadJob,
      { note: marker() },
      { deadLetter: { queue: 'cost.check', jobId: newId(), errorClass: 'FixtureFailure' } },
    );
    expect(failed.outcome).toBe('failed');
  } finally {
    await boss.createQueue('ops.alert');
  }
  expect(anyLineHolds(marker())).toBe(false);
  // Permanent path: none. The payload is never parsed, so nothing in it can fail for good.
}

async function opsAlertPaths(): Promise<void> {
  const payload = {
    kind: 'job_failed',
    values: { queue: 'backup.check', jobId: newId(), errorClass: 'FixtureFailure' },
  } as const;
  const env = { ADMIN_EMAILS: ADMINS };

  const sent = await runJob(opsAlertJob, payload, { env });
  expect(sent.outcome).toBe('completed');
  expect(sent.mailer.sent).toHaveLength(1);
  expect(sent.mailer.sent[0]?.subject).toContain(SUBJECT_WORDS);

  const retrying = new CaptureMailer();
  retrying.failNext('5xx');
  const retried = await runJob(opsAlertJob, payload, { env, mailer: retrying });
  expect(retried.outcome).toBe('failed');

  const rejected = await runJob(opsAlertJob, payload, { env, mailer: new RejectingMailer() });
  expect(rejected.outcome).toBe('completed');

  expect(captureLogs().lines.length).toBeGreaterThan(0);
  for (const address of ADMINS.split(',')) {
    expect(anyLineHolds(address)).toBe(false);
  }
  expect(anyLineHolds('example.test')).toBe(false);
  expect(anyLineHolds(SUBJECT_WORDS)).toBe(false);
}

async function notifyEmailPaths(): Promise<void> {
  // The factory user's address carries the marker.
  const user = await insertUser(getTestDb());
  const address = user.email ?? '';
  expect(address).toContain(marker());
  const payload = { template: 'signin_method_added', userId: user.id, provider: 'apple' } as const;

  // Success: one message to that address; the address is in no log line.
  const sent = await runJob(notifyEmail, payload);
  expect(sent.outcome).toBe('completed');
  expect(sent.mailer.sent).toHaveLength(1);
  expect(sent.mailer.sent[0]?.to).toEqual([address]);

  // Retry: a provider outage makes the job throw.
  const retrying = new CaptureMailer();
  retrying.failNext('5xx');
  const retried = await runJob(notifyEmail, payload, { mailer: retrying });
  expect(retried.outcome).toBe('failed');
  expect(retrying.sent).toHaveLength(0);

  // Permanent: the user row is gone, so the job skips and completes.
  await getTestDb().delete(users).where(eq(users.id, user.id));
  const gone = await runJob(notifyEmail, payload);
  expect(gone.outcome).toBe('completed');
  expect(gone.mailer.sent).toHaveLength(0);
  expect(
    captureLogs().lines.some(
      (line) => line.parsed.event === 'email.skipped' && line.parsed.reason === 'no_user',
    ),
  ).toBe(true);

  expect(captureLogs().lines.length).toBeGreaterThan(0);
  expect(anyLineHolds(marker())).toBe(false);
  expect(anyLineHolds(address)).toBe(false);
  expect(anyLineHolds('example.test')).toBe(false);
}

// The scenario of the deletion and export tests; the user's address carries the marker.
async function everyKind(): Promise<EveryKind> {
  const env = testWorkerEnv();
  const kind = await insertEveryKind(
    getTestDb(),
    await getTestBucket('media'),
    loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS),
    new Date(Math.floor(Date.now() / 1000) * 1000),
  );
  expect(kind.user.email).toContain(marker());
  return kind;
}

function expectNoUserValueLogged(kind: EveryKind): void {
  expect(captureLogs().lines.length).toBeGreaterThan(0);
  expect(anyLineHolds(marker())).toBe(false);
  expect(anyLineHolds(kind.user.email)).toBe(false);
  expect(anyLineHolds(kind.user.id)).toBe(false);
  expect(anyLineHolds(kind.user.handle)).toBe(false);
  expect(anyLineHolds('example.test')).toBe(false);
  for (const value of kind.forbidden) {
    expect(anyLineHolds(value), 'a secret of the scenario').toBe(false);
  }
}

async function accountDeletePaths(): Promise<void> {
  const kind = await everyKind();
  await getTestDb().transaction((tx) => markAccountDeleting(tx, kind.user.id));
  const payload = { userId: kind.user.id, skipDeferral: false };

  // Retry: Apple is configured and answers 503, so the job throws before it deletes anything.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const down = createFakeOutbound();
  down.on('appleid.apple.com', 'POST', '/auth/revoke', () => ({ status: 503 }));
  const retried = await runJob(accountDelete, payload, {
    env: {
      APPLE_TEAM_ID: 'FIXTURETM1',
      APPLE_KEY_ID: 'FIXTUREKY1',
      APPLE_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    },
    outbound: down.fetch,
  });
  expect(retried.outcome).toBe('failed');
  expect(down.calls).toHaveLength(1);

  // Success: the account is deleted and the confirmation goes to the address.
  const deleted = await runJob(accountDelete, payload);
  expect(deleted.outcome).toBe('completed');
  expect(deleted.mailer.sent).toHaveLength(1);
  expect(deleted.mailer.sent[0]?.to).toEqual([kind.user.email]);

  // Permanent: the user row is already gone, so the job returns.
  const gone = await runJob(accountDelete, payload);
  expect(gone.outcome).toBe('completed');
  expect(
    captureLogs().lines.some(
      (line) => line.parsed.event === 'account.delete.skipped' && line.parsed.reason === 'gone',
    ),
  ).toBe(true);

  expectNoUserValueLogged(kind);
}

async function accountExportPaths(): Promise<void> {
  const kind = await everyKind();

  // Success: the file is written and the row is ready.
  const ready = await insertDataExport(getTestDb(), { userId: kind.user.id, status: 'queued' });
  const exported = await runJob(accountExport, { exportId: ready.id });
  expect(exported.outcome).toBe('completed');

  // Retry: the media bucket does not exist, so the write fails and the job throws. The local
  // store creates a bucket on its first write, so the name is one no bucket can have.
  const media = await getTestBucket('media');
  const retrying = await insertDataExport(getTestDb(), { userId: kind.user.id, status: 'queued' });
  const retried = await runJob(
    accountExport,
    { exportId: retrying.id },
    { media: { client: media.client, bucket: `${media.bucket}_gone` } },
  );
  expect(retried.outcome).toBe('failed');

  // Permanent: the user is being deleted, so the row ends failed.
  const refused = await insertDataExport(getTestDb(), { userId: kind.user.id, status: 'queued' });
  await getTestDb().transaction((tx) => markAccountDeleting(tx, kind.user.id));
  const failed = await runJob(accountExport, { exportId: refused.id });
  expect(failed.outcome).toBe('completed');
  const [row] = await getTestDb()
    .select({ status: dataExports.status })
    .from(dataExports)
    .where(eq(dataExports.id, refused.id));
  expect(row?.status).toBe('failed');

  expectNoUserValueLogged(kind);
}

// The media bucket under a name no bucket can have, so every call fails.
async function missingMediaBucket(): Promise<Bucket> {
  const media = await getTestBucket('media');
  return { client: media.client, bucket: `${media.bucket}_gone` };
}

// No log line names an object key, the user or anything the factory marked.
function expectNoMediaValueLogged(
  user: { id: string; email: string | null },
  keys: readonly string[],
): void {
  expect(captureLogs().lines.length).toBeGreaterThan(0);
  expect(anyLineHolds(marker())).toBe(false);
  expect(anyLineHolds(user.id)).toBe(false);
  expect(anyLineHolds(user.email ?? marker())).toBe(false);
  expect(anyLineHolds('example.test')).toBe(false);
  expect(anyLineHolds('incoming/')).toBe(false);
  expect(anyLineHolds('avatars/')).toBe(false);
  for (const key of keys) {
    expect(anyLineHolds(key)).toBe(false);
  }
}

async function mediaProcessImagePaths(): Promise<void> {
  const clock = new FakeClock();
  const user = await insertUser(getTestDb());
  expect(user.email).toContain(marker());

  // Success: the avatar passes and becomes the user's.
  const passed = await avatarUpload(clock, await solidJpeg(800, 600), { user });
  const done = await runJob(mediaProcessImage, passed.payload, { clock });
  expect(done.outcome).toBe('completed');
  const [row] = await getTestDb()
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id));
  expect(row?.avatarKey).toBe(passed.keys.small);

  // Retry: the bucket is unreachable, so the job throws.
  const waiting = await avatarUpload(clock, await solidJpeg(800, 600), { user });
  const retried = await runJob(mediaProcessImage, waiting.payload, {
    clock,
    media: await missingMediaBucket(),
  });
  expect(retried.outcome).toBe('failed');

  // Permanent: a truncated JPEG is refused for good.
  const broken = await avatarUpload(clock, truncated(await solidJpeg(800, 600)), { user });
  const refused = await runJob(mediaProcessImage, broken.payload, { clock });
  expect(refused.outcome).toBe('completed');
  expect(
    captureLogs().lines.some(
      (line) => line.parsed.event === 'media.failed' && line.parsed.reason === 'undecodable',
    ),
  ).toBe(true);

  expectNoMediaValueLogged(
    user,
    [passed, waiting, broken].flatMap((fixture) => [fixture.upload.key, fixture.keys.small]),
  );
}

async function uploadsCleanupPaths(): Promise<void> {
  const clock = new FakeClock();
  const user = await insertUser(getTestDb());
  expect(user.email).toContain(marker());
  const old = await avatarUpload(clock, await solidJpeg(80, 60), { user });
  const payload = { scope: 'avatar', userId: user.id, uploadId: old.upload.id } as const;

  // Retry: the bucket is unreachable, so the job throws.
  const retried = await runJob(uploadsCleanup, payload, {
    clock,
    media: await missingMediaBucket(),
  });
  expect(retried.outcome).toBe('failed');

  // Success: the old avatar's original is deleted.
  const current = await avatarUpload(clock, await solidJpeg(80, 60), { user });
  await setAvatarColumns(user.id, { avatarKey: current.keys.small });
  const done = await runJob(uploadsCleanup, payload, { clock });
  expect(done.outcome).toBe('completed');
  expect(captureLogs().lines.some((line) => line.parsed.event === 'uploads.cleanup.done')).toBe(
    true,
  );

  expectNoMediaValueLogged(user, [old.upload.key, current.keys.small]);
}

const QUEUE_PRIVACY: { readonly [N in JobName]: QueuePrivacy } = {
  'ops.dead': { covered: true, run: deadLetterPaths },
  'ops.alert': { covered: true, run: opsAlertPaths },
  'ops.heartbeat': { covered: false, reason: EMPTY_PAYLOAD },
  'backup.check': { covered: false, reason: EMPTY_PAYLOAD },
  'db.connections-check': { covered: false, reason: EMPTY_PAYLOAD },
  'cost.check': { covered: false, reason: EMPTY_PAYLOAD },
  'account.delete': { covered: true, run: accountDeletePaths },
  'account.export': { covered: true, run: accountExportPaths },
  'uploads.cleanup': {
    covered: true,
    run: uploadsCleanupPaths,
    noPermanentPath: 'no permanent failure: a missing object or row is already clean',
  },
  'media.process.image': { covered: true, run: mediaProcessImagePaths },
  'notify.email': { covered: true, run: notifyEmailPaths },
};

async function runCovered(name: JobName): Promise<void> {
  const row = QUEUE_PRIVACY[name];
  expect(row.covered).toBe(true);
  if (row.covered) {
    await row.run();
  }
}

describe('worker privacy', () => {
  it('every queue is covered or listed with a reason', () => {
    expect(Object.keys(QUEUE_PRIVACY).sort()).toEqual([...JOB_NAMES].sort());
    for (const definition of QUEUE_REGISTRY) {
      expect(Object.keys(QUEUE_PRIVACY)).toContain(definition.name);
    }
    for (const row of Object.values(QUEUE_PRIVACY)) {
      if (!row.covered) {
        expect(row.reason.trim().length).toBeGreaterThan(0);
      } else if (row.noPermanentPath !== undefined) {
        expect(row.noPermanentPath.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('dead letters reach the admin without their content', async () => {
    await runCovered('ops.dead');
  });

  it('ops alerts carry only their values', async () => {
    await runCovered('ops.alert');
  });

  it('user emails never log the address', async () => {
    await runCovered('notify.email');
  });

  it('account deletion never logs the account', async () => {
    await runCovered('account.delete');
  });

  it('account export never logs the account', async () => {
    await runCovered('account.export');
  });

  it('avatar processing never logs the user or an object key', async () => {
    await runCovered('media.process.image');
  });

  it('upload cleanup never logs the user or an object key', async () => {
    await runCovered('uploads.cleanup');
  });
});
