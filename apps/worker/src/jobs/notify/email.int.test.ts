import { rateLimits, usageCounters } from '@citizenrun/db';
import { captureLogs, getTestDb, insertRateCounter, insertUser } from '@citizenrun/db/testing';
import { BRAND, newId } from '@citizenrun/shared';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { CaptureMailer } from '../../testing/fakes/mailer.ts';
import { runJob } from '../../testing/job.ts';
import { notifyEmail } from './email.ts';

// The job is created late on 5 March (UTC) and runs early on 6 March: the date is the creation day.
const CREATED_ON = new Date('2027-03-05T23:30:00.000Z');
const RUNS_AT = '2027-03-06T00:10:00.000Z';
const RUN_DAY = new Date('2027-03-06T00:00:00.000Z');

const GOOGLE_SENTENCE = 'Sign in with Google was added to your account on March 5, 2027.';

function lines(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

function anyLineHolds(text: string): boolean {
  return captureLogs().lines.some((line) => line.raw.includes(text));
}

async function capRows(): Promise<{ key: string; windowStart: string; count: number }[]> {
  const rows = await getTestDb().select().from(rateLimits);
  return rows.map((row) => ({
    key: row.key,
    windowStart: row.windowStart.toISOString(),
    count: row.count,
  }));
}

function payloadFor(userId: string, provider: 'email' | 'apple' | 'google' = 'google') {
  return { template: 'signin_method_added', userId, provider } as const;
}

function runOptions(jobId: string, mailer?: CaptureMailer) {
  return {
    clock: new FakeClock(RUNS_AT),
    job: { id: jobId, createdOn: CREATED_ON },
    ...(mailer === undefined ? {} : { mailer }),
  };
}

describe('J-notify.email', () => {
  it("sends the notice to the user's address", async () => {
    const user = await insertUser(getTestDb());
    const jobId = newId();
    const result = await runJob(notifyEmail, payloadFor(user.id), runOptions(jobId));

    expect(result.outcome).toBe('completed');
    expect(result.mailer.sent).toHaveLength(1);
    const [email] = result.mailer.sent;
    expect(email?.to).toEqual([user.email]);
    expect(email?.idempotencyKey).toBe(`job:${jobId}`);
    expect(email?.subject).toBe(`A sign-in method was added to your ${BRAND.displayName} account`);
    expect(email?.text).toContain(GOOGLE_SENTENCE);
    expect(email?.html).toContain('<html lang="en">');
    // Neither contact is known yet: no support sentence, no reply address, no address line.
    expect(email?.text).not.toContain("If this wasn't you");
    expect(email?.replyTo).toBeNull();
    expect(email?.html).not.toContain('<hr');
    expect(email?.headers).toEqual({});
    expect(lines('email.sent')).toEqual([
      expect.objectContaining({ level: 'info', template: 'signin_method_added' }),
    ]);
    expect(await capRows()).toEqual([
      { key: `u:${user.id}:email:1d`, windowStart: RUN_DAY.toISOString(), count: 1 },
    ]);
  });

  it('writes each provider in its own sentence', async () => {
    const user = await insertUser(getTestDb());
    const apple = await runJob(notifyEmail, payloadFor(user.id, 'apple'), runOptions(newId()));
    const email = await runJob(notifyEmail, payloadFor(user.id, 'email'), runOptions(newId()));
    expect(apple.mailer.sent[0]?.text).toContain(
      'Sign in with Apple was added to your account on March 5, 2027.',
    );
    expect(email.mailer.sent[0]?.text).toContain(
      'Sign-in with an email code was added to your account on March 5, 2027.',
    );
  });

  it('is idempotent', async () => {
    const user = await insertUser(getTestDb());
    const jobId = newId();
    const mailer = new CaptureMailer();
    const first = await runJob(notifyEmail, payloadFor(user.id), runOptions(jobId, mailer));
    const second = await runJob(notifyEmail, payloadFor(user.id), {
      ...runOptions(jobId, mailer),
      job: { id: jobId, createdOn: CREATED_ON, retryCount: 1 },
    });

    expect(first.outcome).toBe('completed');
    expect(second.outcome).toBe('completed');
    // The fake drops a repeated idempotency key, as the provider does (D-246).
    expect(mailer.sent).toHaveLength(1);
    // A retry counts against the cap again, which only makes the cap stricter.
    expect(await capRows()).toEqual([
      { key: `u:${user.id}:email:1d`, windowStart: RUN_DAY.toISOString(), count: 2 },
    ]);
    expect(await getTestDb().select().from(usageCounters)).toEqual([]);
  });

  it('skips a missing user, a missing address, a bounced address and an inactive account', async () => {
    const db = getTestDb();
    const noAddress = await insertUser(db, { email: null });
    const bounced = await insertUser(db, { emailStatus: 'bounced' });
    const inactive = await insertUser(db, { status: 'deleting', deletionRequestedAt: CREATED_ON });
    const cases = [
      { userId: newId(), reason: 'no_user' },
      { userId: noAddress.id, reason: 'no_address' },
      { userId: bounced.id, reason: 'email_status' },
      { userId: inactive.id, reason: 'not_active' },
    ] as const;

    for (const { userId, reason } of cases) {
      const before = lines('email.skipped').length;
      const result = await runJob(notifyEmail, payloadFor(userId), runOptions(newId()));
      expect(result.outcome, reason).toBe('completed');
      expect(result.mailer.sent, reason).toHaveLength(0);
      const skipped = lines('email.skipped').slice(before);
      expect(skipped, reason).toEqual([
        expect.objectContaining({ template: 'signin_method_added', reason }),
      ]);
    }
    expect(lines('email.sent')).toEqual([]);
    expect(await capRows()).toEqual([]);
  });

  it('counts the notice in the daily cap but never skips it', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    await insertRateCounter(db, { key: `u:${user.id}:email:1d`, windowStart: RUN_DAY, count: 5 });

    const result = await runJob(notifyEmail, payloadFor(user.id), runOptions(newId()));

    expect(result.outcome).toBe('completed');
    expect(result.mailer.sent).toHaveLength(1);
    expect(await capRows()).toEqual([
      { key: `u:${user.id}:email:1d`, windowStart: RUN_DAY.toISOString(), count: 6 },
    ]);
    expect(lines('email.skipped')).toEqual([]);
  });

  it('retries on a provider outage', async () => {
    const user = await insertUser(getTestDb());
    const mailer = new CaptureMailer();
    mailer.failNext('5xx');

    const result = await runJob(notifyEmail, payloadFor(user.id), runOptions(newId(), mailer));

    expect(result.outcome).toBe('failed');
    expect(mailer.sent).toHaveLength(0);
    expect(lines('email.sent')).toEqual([]);
    expect(lines('email.failed')).toEqual([]);
  });

  it('completes on a refused message', async () => {
    const user = await insertUser(getTestDb());
    const mailer = new CaptureMailer();
    mailer.failNext('4xx');

    const result = await runJob(notifyEmail, payloadFor(user.id), runOptions(newId(), mailer));

    expect(result.outcome).toBe('completed');
    expect(mailer.sent).toHaveLength(0);
    expect(lines('email.failed')).toEqual([
      expect.objectContaining({
        level: 'error',
        template: 'signin_method_added',
        errorClass: 'PermanentJobError',
      }),
    ]);
    expect(lines('email.sent')).toEqual([]);
  });

  it('never logs the address', async () => {
    const user = await insertUser(getTestDb());
    expect(user.email).toContain(marker());
    const mailer = new CaptureMailer();
    await runJob(notifyEmail, payloadFor(user.id), runOptions(newId(), mailer));
    mailer.failNext('4xx');
    await runJob(notifyEmail, payloadFor(user.id), runOptions(newId(), mailer));
    mailer.failNext('5xx');
    await runJob(notifyEmail, payloadFor(user.id), runOptions(newId(), mailer));

    expect(mailer.sent).toHaveLength(1);
    expect(captureLogs().lines.length).toBeGreaterThan(0);
    expect(anyLineHolds(user.email ?? '')).toBe(false);
    expect(anyLineHolds(marker())).toBe(false);
    expect(anyLineHolds('example.test')).toBe(false);
    expect(anyLineHolds('A sign-in method was added')).toBe(false);
  });
});
