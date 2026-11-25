import { createLogger } from '@citizenrun/shared';
import type { EmailMessage, Logger, Mailer } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from './client.ts';
import { usageCounters } from './schema/index.ts';
import { captureLogs, getTestDb } from './testing/index.ts';
import { addUsage, dayPeriod, monthPeriod, withEmailCounters } from './usage-counters.ts';

class FixtureSendFailure extends Error {
  override readonly name = 'FixtureSendFailure';
}

class FixtureCountFailure extends Error {
  override readonly name = 'FixtureCountFailure';
}

// A mailer that keeps what it was handed, or throws when told to.
class RecordingMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  fail = false;

  sendEmail(message: EmailMessage): Promise<void> {
    if (this.fail) {
      return Promise.reject(new FixtureSendFailure('fixture refusal'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

function message(n: number): EmailMessage {
  return {
    to: 'fixture@example.test',
    subject: 'Fixture subject',
    text: 'Fixture text',
    html: '<p>Fixture text</p>',
    idempotencyKey: `job:fixture-${String(n)}`,
  };
}

function testLogger(): Logger {
  return createLogger({ service: 'worker', level: 'debug', sink: captureLogs().sink });
}

async function counterRows(): Promise<{ name: string; period: string; count: number }[]> {
  return getTestDb()
    .select({ name: usageCounters.name, period: usageCounters.period, count: usageCounters.count })
    .from(usageCounters)
    .orderBy(asc(usageCounters.name), asc(usageCounters.period));
}

describe('usage counters', () => {
  it('one message adds one to each counter', async () => {
    const inner = new RecordingMailer();
    const clock = new FakeClock('2027-03-05T12:00:00Z');
    const mailer = withEmailCounters(inner, getTestDb(), clock, testLogger());
    await mailer.sendEmail(message(1));
    expect(inner.sent).toHaveLength(1);
    expect(await counterRows()).toEqual([
      { name: 'email.day', period: '2027-03-05', count: 1 },
      { name: 'email.month', period: '2027-03-01', count: 1 },
    ]);
  });

  it('two days of one month give two day rows and one month row', async () => {
    const inner = new RecordingMailer();
    const clock = new FakeClock('2027-03-05T23:59:59Z');
    const mailer = withEmailCounters(inner, getTestDb(), clock, testLogger());
    await mailer.sendEmail(message(1));
    clock.set('2027-03-06T00:00:01Z');
    await mailer.sendEmail(message(2));
    expect(await counterRows()).toEqual([
      { name: 'email.day', period: '2027-03-05', count: 1 },
      { name: 'email.day', period: '2027-03-06', count: 1 },
      { name: 'email.month', period: '2027-03-01', count: 2 },
    ]);
  });

  it('a failed send counts nothing', async () => {
    const inner = new RecordingMailer();
    inner.fail = true;
    const mailer = withEmailCounters(
      inner,
      getTestDb(),
      new FakeClock('2027-03-05T12:00:00Z'),
      testLogger(),
    );
    await expect(mailer.sendEmail(message(1))).rejects.toBeInstanceOf(FixtureSendFailure);
    expect(await counterRows()).toEqual([]);
  });

  it('a counting failure does not fail the send', async () => {
    const real = getTestDb();
    const failing: Db = new Proxy(real, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return () => Promise.reject(new FixtureCountFailure('fixture database refusal'));
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const inner = new RecordingMailer();
    const mailer = withEmailCounters(
      inner,
      failing,
      new FakeClock('2027-03-05T12:00:00Z'),
      testLogger(),
    );
    await expect(mailer.sendEmail(message(1))).resolves.toBeUndefined();
    expect(inner.sent).toHaveLength(1);
    const failed = captureLogs().lines.filter((line) => line.parsed.event === 'email.count_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.parsed).toMatchObject({
      level: 'warn',
      errorClass: 'FixtureCountFailure',
    });
    expect(failed[0]?.raw).not.toContain('fixture database refusal');
    expect(await counterRows()).toEqual([]);
  });

  it('addUsage returns the new count', async () => {
    const db = getTestDb();
    expect(await addUsage(db, 'email.signin.day', '2027-03-05', 1)).toBe(1);
    expect(await addUsage(db, 'email.signin.day', '2027-03-05', 1)).toBe(2);
    expect(await addUsage(db, 'email.signin.day', '2027-03-06', 3)).toBe(3);
    const rows = await db
      .select({ count: usageCounters.count })
      .from(usageCounters)
      .where(eq(usageCounters.period, '2027-03-05'));
    expect(rows).toEqual([{ count: 2 }]);
  });

  it('periods are the UTC day and the first of the UTC month', () => {
    // 23:30 on the last day of March in Los Angeles is already April in UTC.
    const now = new Date('2027-04-01T06:30:00.000Z');
    expect(dayPeriod(now)).toBe('2027-04-01');
    expect(monthPeriod(now)).toBe('2027-04-01');
    expect(dayPeriod(new Date('2027-03-31T23:59:59.999Z'))).toBe('2027-03-31');
    expect(monthPeriod(new Date('2027-03-31T23:59:59.999Z'))).toBe('2027-03-01');
  });
});
