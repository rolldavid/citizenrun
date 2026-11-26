import { PrivacyLeakError, getTestDb, resetDb, scanForLeaks } from '@citizenrun/db/testing';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './app.ts';
import { CaptureMailer } from './fakes/mailer.ts';

describe('createTestApp', () => {
  it('createTestApp serves the OpenAPI document', async () => {
    const { request } = await createTestApp();
    const response = await request.get('/v1/openapi.json');
    expect(response.status).toBe(200);
    const document = await response.json<{ openapi: string }>();
    expect(document.openapi).toBe('3.1.0');
  });

  it('the test app uses the fake clock and the capture mailer', async () => {
    const { deps } = await createTestApp();
    expect(deps.clock).toBeInstanceOf(FakeClock);
    expect(deps.mailer).toBeInstanceOf(CaptureMailer);
    expect(deps.env.APP_ENV).toBe('ci');
    expect(deps.env.strictResponses).toBe(true);
    expect(deps.env.captureMail).toBe(true);
    expect(deps.env.ADMIN_EMAILS).toEqual(['admin@example.test']);
    expect(deps.lifecycle.isDraining()).toBe(false);
    const before = deps.clock.now().getTime();
    deps.clock.advance(60_000);
    expect(deps.clock.now().getTime()).toBe(before + 60_000);
  });

  it('statements are counted', async () => {
    const testApp = await createTestApp();
    // Warm the pool, so the count holds the statement alone.
    await testApp.deps.db.execute(sql`select 1`);
    testApp.resetStatementCount();
    expect(testApp.statementCount()).toBe(0);
    await testApp.deps.db.execute(sql`select 1`);
    expect(testApp.statementCount()).toBe(1);
    // The request client resets the count before each request; this route runs no statement.
    await testApp.request.get('/v1/openapi.json');
    expect(testApp.statementCount()).toBe(0);
  });

  it('two test apps do not share a mailer', async () => {
    const first = await createTestApp();
    const second = await createTestApp();
    await first.deps.mailer.sendEmail({
      to: 'user@example.test',
      subject: 'Fixture subject',
      text: 'Fixture text 123456',
      html: '<p>Fixture text</p>',
      idempotencyKey: 'job:fixture-1',
    });
    expect(first.deps.mailer.sent).toHaveLength(1);
    expect(first.deps.mailer.codeFor('USER@example.test')).toBe('123456');
    expect(second.deps.mailer.sent).toEqual([]);
  });

  it('the privacy scan reads every message the mailer holds', async () => {
    const { deps } = await createTestApp();
    await deps.mailer.sendEmail({
      to: 'user@example.test',
      subject: 'Fixture subject',
      text: `Fixture text ${marker()}`,
      html: '<p>Fixture text</p>',
      idempotencyKey: 'job:fixture-scan',
    });
    const error: unknown = await scanForLeaks(getTestDb()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrivacyLeakError);
    // Only the text holds the marker; the recipient, always a test address, is not read.
    expect(error instanceof PrivacyLeakError ? error.findings : null).toEqual([
      { source: expect.stringMatching(/^api capture mailer \d+ 2$/), pattern: 'marker' },
    ]);
    await resetDb();
    await expect(scanForLeaks(getTestDb())).resolves.toBeUndefined();
  });

  it('the fake mailer fails the next send when told to', async () => {
    const { deps } = await createTestApp();
    deps.mailer.failNext('429');
    const email = {
      to: ['user@example.test'],
      subject: 'Fixture subject',
      text: 'Fixture text',
      html: '<p>Fixture text</p>',
      idempotencyKey: 'job:fixture-2',
    };
    await expect(deps.mailer.sendEmail(email)).rejects.toMatchObject({ code: 'unavailable' });
    await deps.mailer.sendEmail(email);
    expect(deps.mailer.last('user@example.test')?.idempotencyKey).toBe('job:fixture-2');
    expect(deps.mailer.last('other@example.test')).toBeNull();
    expect(deps.mailer.codeFor('user@example.test')).toBeNull();
  });

  it('the test app queue sends through the worker database', async () => {
    const { deps } = await createTestApp();
    const id = await deps.queue.enqueue('ops.heartbeat', {});
    expect(typeof id).toBe('string');
  });

  it('an environment override reaches the app', async () => {
    const { deps } = await createTestApp({ env: { ADMIN_EMAILS: undefined } });
    expect(deps.env.ADMIN_EMAILS).toBeNull();
  });
});
