import { captureLogs } from '@citizenrun/db/testing';
import { OpsAlertKindSchema, createI18n, newId } from '@citizenrun/shared';
import type { OpsAlertKind } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { CaptureMailer } from '../../testing/fakes/mailer.ts';
import { runJob } from '../../testing/job.ts';
import { PermanentJobError } from '../types.ts';
import { opsAlertJob } from './alert.ts';

const APP_NAME = createI18n().services.interpolator.interpolate('{{appName}}', {}, 'en', {});

// Sample values for every kind; a kind added to the enum without a row here fails to compile.
const SAMPLES = {
  job_failed: {
    queue: 'backup.check',
    jobId: '0195d2c4-0000-7000-8000-000000000001',
    errorClass: 'TypeError',
  },
  dump_stale: { hoursSinceNewest: 40 },
  connections_high: { count: 85, max: 100 },
  bundle_stale: { hoursSince: 49 },
  bundle_rejected: {
    bundleId: '0195d2c4-0000-7000-8000-000000000002',
    version: '20270115T060000Z-full',
    gate: 'checksums',
  },
  bundle_held: {
    bundleId: '0195d2c4-0000-7000-8000-000000000002',
    version: '20270115T060000Z-full',
  },
  cost_projection: { line: 'storage', value: 700_000_000_000, projected: 1050, threshold: 1000 },
} as const satisfies Record<OpsAlertKind, Readonly<Record<string, string | number | null>>>;

class RejectingMailer extends CaptureMailer {
  override sendEmail(): Promise<void> {
    return Promise.reject(new PermanentJobError('The provider refused the message.'));
  }
}

function lines(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

describe('J-ops.alert', () => {
  it('renders every kind in the enum with sample values and no missing key', async () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...OpsAlertKindSchema.options].sort());
    for (const kind of OpsAlertKindSchema.options) {
      const result = await runJob(opsAlertJob, { kind, values: SAMPLES[kind] });
      expect(result.outcome, kind).toBe('completed');
      expect(result.mailer.sent, kind).toHaveLength(1);
      const [email] = result.mailer.sent;
      expect(email?.subject.startsWith(`[${APP_NAME} ci]`), kind).toBe(true);
      for (const part of [email?.subject, email?.text, email?.html]) {
        expect(part, kind).toBeTypeOf('string');
        expect(part, kind).not.toContain('{{');
        expect(part, kind).not.toContain('opsAlert');
      }
    }
    expect(lines('ops.alert.sent').map((line) => line.kind)).toEqual([
      ...OpsAlertKindSchema.options,
    ]);
  });

  it('one email to every admin address', async () => {
    const jobId = newId();
    const result = await runJob(
      opsAlertJob,
      { kind: 'job_failed', values: SAMPLES.job_failed },
      { jobId, env: { ADMIN_EMAILS: 'admin@example.test,second@example.test' } },
    );
    expect(result.outcome).toBe('completed');
    expect(result.mailer.sent).toHaveLength(1);
    const [email] = result.mailer.sent;
    expect(email?.to).toEqual(['admin@example.test', 'second@example.test']);
    expect(email?.idempotencyKey).toBe(`job:${jobId}`);
    expect(email?.headers).toEqual({});
    expect(Object.keys(email?.headers ?? {})).not.toContain('List-Unsubscribe');
    expect(email?.replyTo).toBeNull();
    expect(email?.subject).toBe(`[${APP_NAME} ci] A job failed three times: backup.check`);
    expect(email?.text).toContain(`Operational alert for the ${APP_NAME} ci environment.`);
  });

  it('is idempotent', async () => {
    const jobId = newId();
    const mailer = new CaptureMailer();
    const payload = { kind: 'dump_stale', values: SAMPLES.dump_stale } as const;
    const first = await runJob(opsAlertJob, payload, { jobId, mailer });
    const second = await runJob(opsAlertJob, payload, { jobId, mailer, retryCount: 1 });
    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.idempotencyKey).toBe(`job:${jobId}`);
  });

  it('a null value reads not known yet', async () => {
    const result = await runJob(opsAlertJob, {
      kind: 'dump_stale',
      values: { hoursSinceNewest: null },
    });
    expect(result.mailer.sent[0]?.text).toContain('Age in hours: not known yet.');
    expect(result.mailer.sent[0]?.html).toContain('Age in hours: not known yet.');
  });

  it('the retry path', async () => {
    const mailer = new CaptureMailer();
    mailer.failNext('5xx');
    const result = await runJob(
      opsAlertJob,
      { kind: 'job_failed', values: SAMPLES.job_failed },
      { mailer },
    );
    expect(result.outcome).toBe('failed');
    expect(mailer.sent).toEqual([]);
    expect(lines('ops.alert.sent')).toEqual([]);
    expect(lines('job.failed')).toEqual([
      expect.objectContaining({ level: 'warn', errorClass: 'RetryableJobError' }),
    ]);
  });

  it('the permanent path', async () => {
    const mailer = new RejectingMailer();
    const result = await runJob(
      opsAlertJob,
      { kind: 'job_failed', values: SAMPLES.job_failed },
      { mailer },
    );
    expect(result.outcome).toBe('completed');
    expect(mailer.sent).toEqual([]);
    expect(lines('ops.alert.rejected')).toEqual([
      expect.objectContaining({ level: 'error', kind: 'job_failed' }),
    ]);
    expect(lines('ops.alert.sent')).toEqual([]);
  });

  it('no recipient in local without admin addresses', async () => {
    const result = await runJob(
      opsAlertJob,
      { kind: 'job_failed', values: SAMPLES.job_failed },
      { env: { APP_ENV: 'local', ADMIN_EMAILS: undefined } },
    );
    expect(result.outcome).toBe('completed');
    expect(result.ctx.env.ADMIN_EMAILS).toBeNull();
    expect(result.mailer.sent).toEqual([]);
    expect(lines('ops.alert.no_recipient')).toEqual([
      expect.objectContaining({ level: 'warn', kind: 'job_failed' }),
    ]);
    expect(lines('ops.alert.sent')).toEqual([]);
  });

  it('no values key outside the schema is accepted', async () => {
    const result = await runJob(opsAlertJob, { kind: 'job_failed', values: { 'Bad-Key': 1 } });
    expect(result.outcome).toBe('permanent');
    expect(result.mailer.sent).toEqual([]);
  });

  it('logs no recipient, subject or value', async () => {
    await runJob(
      opsAlertJob,
      { kind: 'job_failed', values: SAMPLES.job_failed },
      { env: { ADMIN_EMAILS: 'admin@example.test,second@example.test' } },
    );
    const raw = captureLogs()
      .lines.map((line) => line.raw)
      .join('\n');
    expect(raw).not.toContain('example.test');
    expect(raw).not.toContain('A job failed three times');
    expect(raw).not.toContain('TypeError');
  });
});
