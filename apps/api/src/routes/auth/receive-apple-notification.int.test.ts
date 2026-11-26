import { authIdentities, sessions, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertIdentity, insertSession } from '../../testing/factories.ts';
import { FIXTURE_APPLE, FakeIdentityProviders } from '../../testing/fakes/identity.ts';
import type { AppleNotificationEvent } from '../../testing/fakes/identity.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestResponse } from '../../testing/request.ts';

// E-AUTH-07: TEST-api-AUTH; TEST-auth-providers `Apple server notices`; CTL-10, CTL-15.
const PATH = '/v1/auth/apple/notifications';
const SECOND_MS = 1000;
const HOUR_MS = 3600 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// auth.appleNotify allows 600 an hour per address.
const PER_ADDRESS_HOURLY = 600;

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost % 250)}`;
  nextHost += 1;
  return ip;
}

let nextSubject = 1;
function freshSubject(): string {
  const subject = `000999.fixture.${String(nextSubject)}`;
  nextSubject += 1;
  return subject;
}

let identity: FakeIdentityProviders;
let testApp: TestApp;

async function makeApp(env: Record<string, string | undefined> = {}): Promise<TestApp> {
  const clock = new FakeClock();
  identity = new FakeIdentityProviders(clock);
  return createTestApp({ clock, identity, env: { ...identity.appleEnv(), ...env } });
}

beforeEach(async () => {
  testApp = await makeApp();
});

/** Apple's server call: no client header and no Origin. */
function notify(payload: unknown, options: { ip?: string } = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, {
    ip: options.ip ?? freshIp(),
    client: null,
    origin: null,
    body: payload === undefined ? {} : { payload },
  });
}

async function send(event: AppleNotificationEvent, options: { aud?: string } = {}) {
  return notify(await identity.appleNotification(event, options));
}

async function expectOk(response: TestResponse): Promise<void> {
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({});
}

async function expectError(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body: unknown = await response.json();
  expect(body).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
}

/** A user with an Apple identity, two sessions and, unless `email` is null, an email identity. */
async function appleUser(email: string | null = 'apple-user@example.test') {
  const user = await insertUser(testApp.deps.db, { email });
  const subject = freshSubject();
  await insertIdentity(testApp.deps.db, {
    userId: user.id,
    provider: 'apple',
    subject,
    email,
    emailVerified: email !== null,
  });
  await insertSession(testApp.deps.db, { userId: user.id });
  await insertSession(testApp.deps.db, { userId: user.id, platform: 'web' });
  return { user, subject };
}

async function stateOf(userId: string) {
  const [user] = await testApp.deps.db.select().from(users).where(eq(users.id, userId));
  const identities = await testApp.deps.db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId));
  const sessionRows = await testApp.deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return {
    status: user?.status,
    emailStatus: user?.emailStatus,
    deletionRequested:
      user?.deletionRequestedAt !== null && user?.deletionRequestedAt !== undefined,
    providers: identities.map((row) => row.provider).sort(),
    sessions: sessionRows.length,
  };
}

describe('POST /v1/auth/apple/notifications', () => {
  it('ok', async () => {
    const { user, subject } = await appleUser();
    await expectOk(await send({ type: 'consent-revoked', sub: subject }));
    expect((await stateOf(user.id)).sessions).toBe(0);
  });

  it('consent-revoked deletes the sessions and the Apple identity and keeps the user', async () => {
    const { user, subject } = await appleUser();
    const bystander = await appleUser('bystander@example.test');
    await expectOk(await send({ type: 'consent-revoked', sub: subject }));
    expect(await stateOf(user.id)).toEqual({
      status: 'active',
      emailStatus: 'ok',
      deletionRequested: false,
      providers: ['email'],
      sessions: 0,
    });
    // Another user is untouched.
    expect((await stateOf(bystander.user.id)).sessions).toBe(2);
    expect(await queuedJobs(testApp.deps.db, 'account.delete')).toHaveLength(0);
  });

  it('account-deleted does the same', async () => {
    const { user, subject } = await appleUser();
    await expectOk(await send({ type: 'account-deleted', sub: subject }));
    expect(await stateOf(user.id)).toEqual({
      status: 'active',
      emailStatus: 'ok',
      deletionRequested: false,
      providers: ['email'],
      sessions: 0,
    });
    // With an email identity as well, the user stays active and no deletion starts.
    expect(await queuedJobs(testApp.deps.db, 'account.delete')).toHaveLength(0);
  });

  it('account-deleted for a user whose only identity was Apple starts the deletion', async () => {
    const { user, subject } = await appleUser(null);
    await expectOk(await send({ type: 'account-deleted', sub: subject }));
    expect(await stateOf(user.id)).toEqual({
      status: 'deleting',
      emailStatus: 'ok',
      deletionRequested: true,
      providers: [],
      sessions: 0,
    });
    const jobs = await queuedJobs(testApp.deps.db, 'account.delete');
    expect(jobs.map((job) => job.data)).toEqual([{ userId: user.id, skipDeferral: false }]);
  });

  it('consent-revoked for a user whose only identity was Apple keeps the account', async () => {
    const { user, subject } = await appleUser(null);
    await expectOk(await send({ type: 'consent-revoked', sub: subject }));
    expect((await stateOf(user.id)).status).toBe('active');
    expect(await queuedJobs(testApp.deps.db, 'account.delete')).toHaveLength(0);
  });

  it('email-disabled sets the status when the address matches', async () => {
    const { user, subject } = await appleUser('relay@example.test');
    await expectOk(
      await send({ type: 'email-disabled', sub: subject, email: 'other@example.test' }),
    );
    expect((await stateOf(user.id)).emailStatus).toBe('ok');
    await expectOk(await send({ type: 'email-disabled', sub: subject }));
    expect((await stateOf(user.id)).emailStatus).toBe('ok');
    await expectOk(
      await send({
        type: 'email-disabled',
        sub: subject,
        email: 'Relay@Example.Test',
        is_private_email: 'true',
      }),
    );
    expect(await stateOf(user.id)).toMatchObject({ emailStatus: 'disabled', sessions: 2 });
  });

  it('email-enabled restores ok', async () => {
    const { user, subject } = await appleUser('relay@example.test');
    await expectOk(
      await send({ type: 'email-disabled', sub: subject, email: 'relay@example.test' }),
    );
    await expectOk(
      await send({ type: 'email-enabled', sub: subject, email: 'other@example.test' }),
    );
    expect((await stateOf(user.id)).emailStatus).toBe('disabled');
    await expectOk(
      await send({ type: 'email-enabled', sub: subject, email: 'relay@example.test' }),
    );
    expect((await stateOf(user.id)).emailStatus).toBe('ok');
    // A bounced address is not turned back on by Apple's notice.
    await testApp.deps.db
      .update(users)
      .set({ emailStatus: 'bounced' })
      .where(eq(users.id, user.id));
    await expectOk(
      await send({ type: 'email-enabled', sub: subject, email: 'relay@example.test' }),
    );
    expect((await stateOf(user.id)).emailStatus).toBe('bounced');
  });

  it('another type changes nothing', async () => {
    const { user, subject } = await appleUser();
    const before = await stateOf(user.id);
    await expectOk(await send({ type: 'something-new', sub: subject }));
    expect(await stateOf(user.id)).toEqual(before);
  });

  it('an unknown sub answers 200 with no change', async () => {
    const { user } = await appleUser(null);
    const before = await stateOf(user.id);
    await expectOk(await send({ type: 'account-deleted', sub: 'unknown.subject' }));
    expect(await stateOf(user.id)).toEqual(before);
    expect(await queuedJobs(testApp.deps.db, 'account.delete')).toHaveLength(0);
  });

  it('a notice for the Services ID is accepted and events may be an object', async () => {
    const first = await appleUser();
    await expectOk(
      await send(
        { type: 'consent-revoked', sub: first.subject },
        { aud: FIXTURE_APPLE.servicesId },
      ),
    );
    expect((await stateOf(first.user.id)).sessions).toBe(0);
    const second = await appleUser('second@example.test');
    await expectOk(
      await notify(
        await identity.appleIdToken({
          sub: undefined,
          events: { type: 'consent-revoked', sub: second.subject },
        }),
      ),
    );
    expect((await stateOf(second.user.id)).providers).toEqual(['email']);
  });

  it('an unsigned body is 400', async () => {
    const { user, subject } = await appleUser(null);
    const before = await stateOf(user.id);
    const foreign = await identity.appleNotification(
      { type: 'account-deleted', sub: subject },
      { foreignKey: true },
    );
    await expectError(await notify(foreign), 'signature_invalid');
    await expectError(await notify('not-a-jwt'), 'signature_invalid');
    const otherAudience = await identity.appleNotification(
      { type: 'account-deleted', sub: subject },
      { aud: 'org.example.other' },
    );
    await expectError(await notify(otherAudience), 'signature_invalid');
    const otherIssuer = await identity.appleIdToken({
      iss: 'https://evil.example.test',
      events: JSON.stringify({ type: 'account-deleted', sub: subject }),
    });
    await expectError(await notify(otherIssuer), 'signature_invalid');
    expect(await stateOf(user.id)).toEqual(before);
  });

  it('each exempt route rejects a bad signature or state', async () => {
    const { user, subject } = await appleUser();
    const forged = await identity.appleNotification(
      { type: 'consent-revoked', sub: subject },
      { alg: 'RS384' },
    );
    await expectError(await notify(forged), 'signature_invalid');
    expect((await stateOf(user.id)).sessions).toBe(2);
  });

  it('an events claim that is not JSON answers 400 invalid_request', async () => {
    const { user, subject } = await appleUser();
    await expectError(
      await notify(await identity.appleIdToken({ events: 'not json' })),
      'invalid_request',
    );
    await expectError(
      await notify(await identity.appleIdToken({ events: JSON.stringify({ type: 'x' }) })),
      'invalid_request',
    );
    await expectError(await notify(await identity.appleIdToken({})), 'invalid_request');
    await expectError(
      await notify(
        await identity.appleIdToken({
          events: JSON.stringify({ type: 'x'.repeat(65), sub: subject }),
        }),
      ),
      'invalid_request',
    );
    expect((await stateOf(user.id)).sessions).toBe(2);
  });

  it('accepts a request with no X-OS-Client and no Origin', async () => {
    const { subject } = await appleUser();
    const response = await testApp.request.post(PATH, {
      ip: freshIp(),
      client: null,
      origin: null,
      body: {
        payload: await identity.appleNotification({ type: 'consent-revoked', sub: subject }),
      },
    });
    await expectOk(response);
    // Apple's server may send an Origin of its own; the request-forgery check does not apply.
    const again = await testApp.request.post(PATH, {
      ip: freshIp(),
      client: null,
      origin: 'https://appleid.apple.com',
      body: {
        payload: await identity.appleNotification({ type: 'consent-revoked', sub: subject }),
      },
    });
    await expectOk(again);
  });

  it('providers without configuration', async () => {
    testApp = await makeApp({ APPLE_BUNDLE_ID: undefined });
    const { user, subject } = await appleUser(null);
    const before = await stateOf(user.id);
    await expectError(
      await send({ type: 'account-deleted', sub: subject }),
      'provider_not_configured',
    );
    expect(await stateOf(user.id)).toEqual(before);
    expect(testApp.fakes.outbound.calls).toHaveLength(0);
  });

  it('a repeated notice leaves the same state', async () => {
    const { user, subject } = await appleUser(null);
    const notice = await identity.appleNotification({ type: 'account-deleted', sub: subject });
    await expectOk(await notify(notice));
    const after = await stateOf(user.id);
    await expectOk(await notify(notice));
    expect(await stateOf(user.id)).toEqual(after);
    expect(await queuedJobs(testApp.deps.db, 'account.delete')).toHaveLength(1);

    const relay = await appleUser('repeat@example.test');
    const disable = await identity.appleNotification({
      type: 'email-disabled',
      sub: relay.subject,
      email: 'repeat@example.test',
    });
    await expectOk(await notify(disable));
    await expectOk(await notify(disable));
    expect((await stateOf(relay.user.id)).emailStatus).toBe('disabled');
  });

  it('no payload, subject or email reaches a log line', async () => {
    const value = marker();
    const { subject } = await appleUser(`${value.toLowerCase()}@example.test`);
    const payload = await identity.appleNotification({
      type: 'email-disabled',
      sub: subject,
      email: `${value}@example.test`,
    });
    await expectOk(await notify(payload));
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw.toLowerCase()).not.toContain(value.toLowerCase());
      expect(line.raw).not.toContain(payload);
      expect(line.raw).not.toContain(subject);
    }
  });

  it('rejects invalid input', async () => {
    const cases: [unknown, string, string][] = [
      [undefined, 'payload', 'required'],
      ['', 'payload', 'too_short'],
      ['x'.repeat(8193), 'payload', 'too_long'],
      [42, 'payload', 'invalid_type'],
    ];
    for (const [payload, field, code] of cases) {
      const response = await notify(payload);
      expect(response.status, code).toBe(400);
      const envelope = await response.json<{
        error: { code: string; fields: Record<string, string> };
      }>();
      expect(envelope.error.code).toBe('invalid_request');
      expect(envelope.error.fields[field], code).toBe(code);
    }
  });

  it('envelope on every error', async () => {
    await expectError(await notify(undefined), 'invalid_request');
    await expectError(await notify('x'), 'signature_invalid');
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.200';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      const response = await notify(undefined, { ip });
      if (response.status !== 400) {
        expect(response.status, `call ${String(n)}`).toBe(400);
      }
    }
    const limited = await notify(undefined, { ip });
    await expectError(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toHourEnd = Math.ceil((Math.ceil(now / HOUR_MS) * HOUR_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toHourEnd));
    // Another address is not limited.
    expect((await notify(undefined, { ip: '203.0.113.201' })).status).toBe(400);
  });
});
