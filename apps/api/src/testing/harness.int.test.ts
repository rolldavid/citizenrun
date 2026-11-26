import {
  authChallenges,
  authIdentities,
  dayPeriod,
  emailCodes,
  monthPeriod,
  reservedHandles,
  sessions,
  usageCounters,
  users,
} from '@citizenrun/db';
import { getTestDb, insertUser } from '@citizenrun/db/testing';
import { emailCodeHash, keyedHash, sha256Hex } from '@citizenrun/shared/crypto';
import { FakeClock } from '@citizenrun/shared/testing';
import { asc, eq, sql } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { enqueueOf } from '../deps.ts';
import { isCaptureMailer } from '../lib/mailer.ts';
import { createTestApp } from './app.ts';
import { signIn, signInAdmin } from './auth.ts';
import { insertChallenge, insertEmailCode, insertReservedHandle } from './factories.ts';
import { FIXTURE_APPLE, FakeIdentityProviders } from './fakes/identity.ts';
import { createFakeOutbound } from './fakes/outbound.ts';
import { queuedJobs } from './jobs.ts';

const SECOND_MS = 1000;

// The database's own clock, read as epoch milliseconds.
async function dbNowMs(): Promise<number> {
  const rows = await getTestDb().execute<{ ms: number }>(
    sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
    'objects',
  );
  const ms = rows[0]?.ms;
  if (ms === undefined) {
    throw new Error('now() returned no row');
  }
  return ms;
}

describe('the sign-in test harness', () => {
  it('signIn stores only the hash', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    const auth = await signIn(db, user, 'bearer');
    expect(auth.kind).toBe('bearer');
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row?.tokenHash).toBe(sha256Hex(auth.token));
    expect(row?.platform).toBe('ios');
    expect(Object.values(row ?? {})).not.toContain(auth.token);
    expect(JSON.stringify(row)).not.toContain(auth.token);

    const cookie = await signIn(db, user, 'cookie');
    const [web] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(cookie.token)));
    expect(web?.platform).toBe('web');
  });

  it('signIn passes the times it is given', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    const authenticatedAt = new Date('2026-01-02T03:04:05.000Z');
    const expiresAt = new Date('2026-04-02T03:04:05.000Z');
    const auth = await signIn(db, user, 'cookie', { authenticatedAt, expiresAt });
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(auth.token)));
    expect(row?.authenticatedAt).toEqual(authenticatedAt);
    expect(row?.expiresAt).toEqual(expiresAt);
  });

  it('signInAdmin makes a verified admin', async () => {
    const db = getTestDb();
    const { user, auth } = await signInAdmin(db, 'cookie');
    expect(user.role).toBe('admin');
    expect(user.email).toBe('admin@example.test');
    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({
      provider: 'email',
      subject: 'admin@example.test',
      emailVerified: true,
    });
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(auth.token)));
    const now = await dbNowMs();
    expect(Math.abs((session?.authenticatedAt.getTime() ?? 0) - now)).toBeLessThanOrEqual(
      SECOND_MS,
    );
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));
    expect(stored?.role).toBe('admin');
  });

  it('fake Apple tokens verify against the fake key set', async () => {
    const { fakes } = await createTestApp();
    const identity = fakes.identity;
    const options = {
      issuer: 'https://appleid.apple.com',
      audience: FIXTURE_APPLE.bundleId,
      algorithms: ['RS256'],
      currentDate: fakes.clock.now(),
    };
    const { payload } = await jwtVerify(
      await identity.appleIdToken({ nonce: 'n' }),
      identity.keys.apple,
      options,
    );
    expect(payload.nonce).toBe('n');
    expect(payload.sub).toBe('000123.fixture');
    await expect(
      jwtVerify(
        await identity.appleIdToken({ nonce: 'n' }, { foreignKey: true }),
        identity.keys.apple,
        options,
      ),
    ).rejects.toThrow();
    // A token signed RS384 with the provider's key matches no RS256 key.
    await expect(
      jwtVerify(await identity.appleIdToken({}, { alg: 'RS384' }), identity.keys.apple, {
        ...options,
        algorithms: ['RS256', 'RS384'],
      }),
    ).rejects.toThrow();
    // A claim set to undefined is left out, and Google's tokens verify against Google's set only.
    const google = await identity.googleIdToken({ sub: undefined });
    const verified = await jwtVerify(google, identity.keys.google, {
      issuer: 'https://accounts.google.com',
      currentDate: fakes.clock.now(),
    });
    expect('sub' in verified.payload).toBe(false);
    await expect(jwtVerify(google, identity.keys.apple)).rejects.toThrow();
    // Apple's notices carry the event as a JSON string.
    const notice = await identity.appleNotification({ type: 'consent-revoked', sub: 's' });
    const read = await jwtVerify(notice, identity.keys.apple, options);
    expect(JSON.parse(String(read.payload.events))).toEqual({ type: 'consent-revoked', sub: 's' });
  });

  it('the fake token endpoint records the exchange', async () => {
    const identity = new FakeIdentityProviders(new FakeClock());
    const outbound = createFakeOutbound();
    identity.registerAppleEndpoints(outbound);
    const response = await outbound.fetch('appleid.apple.com', '/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: FIXTURE_APPLE.servicesId,
        client_secret: 'fixture-secret',
        code: 'fixture-code',
        grant_type: 'authorization_code',
        redirect_uri: 'https://app.example.test/v1/auth/apple/callback',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refresh_token: 'fixture-refresh-1' });
    expect(identity.exchanges).toEqual([
      {
        clientId: FIXTURE_APPLE.servicesId,
        clientSecret: 'fixture-secret',
        code: 'fixture-code',
        grantType: 'authorization_code',
        redirectUri: 'https://app.example.test/v1/auth/apple/callback',
      },
    ]);
    const revoke = await outbound.fetch('appleid.apple.com', '/auth/revoke', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: FIXTURE_APPLE.bundleId,
        client_secret: 'fixture-secret',
        token: 'fixture-refresh-1',
        token_type_hint: 'refresh_token',
      }),
    });
    expect(revoke.status).toBe(200);
    expect(identity.revocations).toEqual([
      {
        clientId: FIXTURE_APPLE.bundleId,
        clientSecret: 'fixture-secret',
        token: 'fixture-refresh-1',
        tokenTypeHint: 'refresh_token',
      },
    ]);

    const failing = new FakeIdentityProviders(new FakeClock());
    const other = createFakeOutbound();
    failing.registerAppleEndpoints(other, { token: 'fail' });
    const refused = await other.fetch('appleid.apple.com', '/auth/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: FIXTURE_APPLE.bundleId, code: 'fixture-code' }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'invalid_grant' });
    expect(failing.exchanges).toHaveLength(1);
    expect(failing.exchanges[0]?.redirectUri).toBeNull();
  });

  it('the test environment holds the sign-in values', async () => {
    const { deps, fakes } = await createTestApp();
    const env = deps.env;
    expect(env.PUBLIC_URL).toBe('https://app.example.test');
    expect(env.ADMIN_EMAILS).toEqual(['admin@example.test']);
    expect(env.CLIENT_IP_HEADER).toBe('x-real-ip');
    expect(env.APP_ENV).toBe('ci');
    expect(env.MIN_CLIENT_VERSION_IOS).toBe('1.0.0');
    expect(env.MIN_CLIENT_VERSION_ANDROID).toBe('1.0.0');
    expect(env.MIN_CLIENT_VERSION_WEB).toBe('1.0.0');
    expect(env.APPLE_TEAM_ID).toBeNull();
    expect(env.APPLE_KEY_ID).toBeNull();
    expect(env.APPLE_PRIVATE_KEY).toBeNull();
    expect(env.APPLE_BUNDLE_ID).toBeNull();
    expect(env.APPLE_SERVICES_ID).toBeNull();
    expect(env.GOOGLE_CLIENT_IDS).toBeNull();
    expect(env.RESEND_API_KEY).toBeNull();
    expect(env.captureMail).toBe(true);
    expect(env.devRoutes).toBe(false);
    expect(env.SESSION_COOKIE_NAME).toBe('__Host-os_session');
    // The test key ring comes from the fixture APP_SECRET.
    expect(deps.keyRing.current['identity-hash'].kid).toMatch(/^[0-9a-f]{8}$/);
    // The dependencies are the fakes the test reads.
    expect(deps.outbound).toBe(fakes.outbound.fetch);
    expect(deps.identityKeys).toBe(fakes.identity.keys);
    expect(deps.clock).toBe(fakes.clock);
  });

  it('env overrides reach the app', async () => {
    const identity = new FakeIdentityProviders(new FakeClock());
    const { deps } = await createTestApp({ env: identity.appleEnv() });
    expect(deps.env.APPLE_TEAM_ID).toBe(FIXTURE_APPLE.teamId);
    expect(deps.env.APPLE_KEY_ID).toBe(FIXTURE_APPLE.keyId);
    expect(deps.env.APPLE_BUNDLE_ID).toBe(FIXTURE_APPLE.bundleId);
    expect(deps.env.APPLE_SERVICES_ID).toBe(FIXTURE_APPLE.servicesId);
    expect(deps.env.APPLE_PRIVATE_KEY).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    const google = await createTestApp({ env: identity.googleEnv() });
    expect(google.deps.env.GOOGLE_CLIENT_IDS).toBe(
      'fixture-web.apps.googleusercontent.com,fixture-ios.apps.googleusercontent.com',
    );
  });

  it("the test app's mailer counts and keeps its mailbox", async () => {
    const { deps, fakes } = await createTestApp();
    await deps.mailer.sendEmail({
      to: 'person@example.test',
      subject: 'Fixture',
      text: 'Fixture code 123456',
      html: '<p>Fixture code 123456</p>',
      idempotencyKey: 'signin-fixture-1',
    });
    expect(isCaptureMailer(deps.mailer)).toBe(true);
    const held = deps.mailer.captured();
    expect(held).toHaveLength(1);
    expect(held[0]?.to).toEqual(['person@example.test']);
    expect(held[0]?.idempotencyKey).toBe('signin-fixture-1');
    expect(fakes.mailer.sent).toEqual(held);
    expect(fakes.mailer.captured()).toEqual(held);
    const now = fakes.clock.now();
    const counters = await getTestDb()
      .select({
        name: usageCounters.name,
        period: usageCounters.period,
        count: usageCounters.count,
      })
      .from(usageCounters)
      .orderBy(asc(usageCounters.name));
    expect(counters).toEqual([
      { name: 'email.day', period: dayPeriod(now), count: 1 },
      { name: 'email.month', period: monthPeriod(now), count: 1 },
    ]);
  });

  it('factories write what the services write', async () => {
    const { deps } = await createTestApp();
    const db = getTestDb();
    const ring = deps.keyRing;

    const { row: code, pendingToken } = await insertEmailCode(db, ring, {
      email: 'person@example.test',
      code: '123456',
    });
    const [storedCode] = await db.select().from(emailCodes).where(eq(emailCodes.id, code.id));
    expect(storedCode?.codeHash).toBe(emailCodeHash(ring, 'person@example.test', '123456'));
    expect(storedCode?.pendingTokenHash).toBe(sha256Hex(pendingToken));
    expect(storedCode?.attempts).toBe(0);
    expect(storedCode?.sendCount).toBe(1);

    const reserved = await insertReservedHandle(db, ring, { handle: 'fixture_handle' });
    const [storedHandle] = await db
      .select()
      .from(reservedHandles)
      .where(eq(reservedHandles.handleHash, reserved.handleHash));
    expect(storedHandle?.handleHash).toBe(
      keyedHash(ring, { kind: 'handle', handle: 'fixture_handle' }),
    );
    expect(storedHandle?.reason).toBe('deleted');

    const { row: challenge, secret } = await insertChallenge(db, { kind: 'nonce' });
    expect(secret).not.toBeNull();
    const [storedChallenge] = await db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.id, challenge.id));
    expect(storedChallenge?.secretHash).toBe(sha256Hex(secret ?? ''));
    const ahead = (storedChallenge?.expiresAt.getTime() ?? 0) - (await dbNowMs());
    expect(ahead).toBeGreaterThan(10 * 60 * SECOND_MS - 5 * SECOND_MS);
    expect(ahead).toBeLessThanOrEqual(10 * 60 * SECOND_MS);

    const hashed = await insertChallenge(db, {
      kind: 'apple_handoff',
      secretHash: sha256Hex('h.n'),
    });
    expect(hashed.secret).toBeNull();
    expect(hashed.row.secretHash).toBe(sha256Hex('h.n'));
  });

  it('queuedJobs reads what was sent', async () => {
    const { deps } = await createTestApp();
    const payload = {
      kind: 'cost_projection',
      values: { line: 'signin_ceiling', value: 1000, projected: 1000, threshold: 1000 },
    } as const;
    await enqueueOf(deps)('ops.alert', payload);
    const jobs = await queuedJobs(getTestDb(), 'ops.alert');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual(payload);
    expect(typeof jobs[0]?.id).toBe('string');
  });
});
