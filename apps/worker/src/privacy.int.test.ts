import { captureLogs, createTestBoss, getTestDb } from '@citizenrun/db/testing';
import { JOB_NAMES, newId } from '@citizenrun/shared';
import type { JobName } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { opsAlertJob } from './jobs/ops/alert.ts';
import { opsDeadJob } from './jobs/ops/dead.ts';
import { PermanentJobError } from './jobs/types.ts';
import { QUEUE_REGISTRY } from './queues.ts';
import { CaptureMailer } from './testing/fakes/mailer.ts';
import { runJob, runQueued } from './testing/job.ts';

// TEST-privacy-logscan's worker suite: every queue runs over values carrying the marker on its
// success, retry and permanent-failure paths, or is listed with the reason it cannot carry one.

type QueuePrivacy =
  { covered: true; run: () => Promise<void> } | { covered: false; reason: string };

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

const QUEUE_PRIVACY: { readonly [N in JobName]: QueuePrivacy } = {
  'ops.dead': { covered: true, run: deadLetterPaths },
  'ops.alert': { covered: true, run: opsAlertPaths },
  'ops.heartbeat': { covered: false, reason: EMPTY_PAYLOAD },
  'backup.check': { covered: false, reason: EMPTY_PAYLOAD },
  'db.connections-check': { covered: false, reason: EMPTY_PAYLOAD },
  'cost.check': { covered: false, reason: EMPTY_PAYLOAD },
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
      }
    }
  });

  it('dead letters reach the admin without their content', async () => {
    await runCovered('ops.dead');
  });

  it('ops alerts carry only their values', async () => {
    await runCovered('ops.alert');
  });
});
