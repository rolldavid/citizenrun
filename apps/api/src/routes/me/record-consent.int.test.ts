import { userConsents } from '@citizenrun/db';
import {
  insertConsent,
  insertConsents,
  insertRateCounter,
  insertUser,
} from '@citizenrun/db/testing';
import {
  ConsentStateSchema,
  ERROR_CODES,
  ErrorEnvelopeSchema,
  LEGAL_VERSIONS,
} from '@citizenrun/shared';
import type { ConsentState, ErrorCode } from '@citizenrun/shared';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-11: TEST-api-ME for POST /v1/me/consents, CTL-77.
const PATH = '/v1/me/consents';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.write: 30 a minute per user.
const ME_WRITE_LIMIT = 30;
// A version string that is never a current LEGAL_VERSIONS value.
const OLD_VERSION = '2000-01-01';

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Five seconds into a minute, so no case crosses a minute window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function now(): Date {
  return testApp.deps.clock.now();
}

function record(body: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { body, ...options });
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

async function expectConsents(response: TestResponse): Promise<ConsentState> {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return ConsentStateSchema.parse(await response.json());
}

/** A user with the three agreements at their current versions, signed in by bearer. */
async function member(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, overrides);
  await insertConsents(testApp.deps.db, user.id);
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function rowsOf(userId: string) {
  return testApp.deps.db
    .select({
      kind: userConsents.kind,
      version: userConsents.version,
      granted: userConsents.granted,
      platform: userConsents.platform,
    })
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(asc(userConsents.id));
}

type Agreement = 'terms' | 'content_policy' | 'privacy_policy';

const agreement = (kind: Agreement = 'terms') => ({
  kind,
  version: LEGAL_VERSIONS[kind],
  granted: true,
});

describe('POST /v1/me/consents', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const state = await expectConsents(await record(agreement('terms'), { auth }));
    expect(Object.keys(state).sort()).toEqual([
      'contentPolicy',
      'needed',
      'privacyPolicy',
      'terms',
    ]);
    expect(state.needed).toEqual([]);
    expect((await rowsOf(user.id)).at(-1)).toEqual({
      kind: 'terms',
      version: LEGAL_VERSIONS.terms,
      granted: true,
      platform: 'ios',
    });
  });

  it('rejects invalid input', async () => {
    const { user, auth } = await member();
    const before = await rowsOf(user.id);
    const cases: [unknown, string, string][] = [
      // A missing enumerated field is reported as invalid_value by the router's issue mapping.
      [{ version: LEGAL_VERSIONS.terms, granted: true }, 'kind', 'invalid_value'],
      [{ kind: 'cookies', version: LEGAL_VERSIONS.terms, granted: true }, 'kind', 'invalid_value'],
      // The AI-screening answer is no longer taken (D-900), granted or declined.
      [
        { kind: 'ai_screening', version: LEGAL_VERSIONS.terms, granted: true },
        'kind',
        'invalid_value',
      ],
      [
        { kind: 'ai_screening', version: LEGAL_VERSIONS.terms, granted: false },
        'kind',
        'invalid_value',
      ],
      [{ kind: 'terms', granted: true }, 'version', 'required'],
      [{ kind: 'terms', version: '', granted: true }, 'version', 'too_short'],
      [{ kind: 'terms', version: 'v'.repeat(33), granted: true }, 'version', 'too_long'],
      [{ kind: 'terms', version: 7, granted: true }, 'version', 'invalid_type'],
      [{ kind: 'terms', version: LEGAL_VERSIONS.terms }, 'granted', 'required'],
      [{ kind: 'terms', version: LEGAL_VERSIONS.terms, granted: 'yes' }, 'granted', 'invalid_type'],
    ];
    for (const [body, field, code] of cases) {
      const envelope = await expectEnvelope(await record(body, { auth }), 'invalid_request');
      expect(envelope.error.fields[field], field).toBe(code);
    }
    const malformed = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'X-OS-Client': 'ios/1.4.0',
        },
        body: '{"kind":',
      },
    );
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Envelope).error.code).toBe('invalid_request');
    expect(await rowsOf(user.id)).toEqual(before);
    // An unknown key is dropped: the row is written as if it were absent.
    await expectConsents(
      await record({ ...agreement('terms'), userId: 'x', platform: 'web' }, { auth }),
    );
    expect((await rowsOf(user.id)).at(-1)?.platform).toBe('ios');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await record(agreement()), 'unauthenticated');
    const { auth } = await member();
    await expectEnvelope(
      await record({ kind: 'terms', version: OLD_VERSION, granted: true }, { auth }),
      'consent_version_outdated',
    );
    await expectEnvelope(
      await record({ kind: 'terms', version: LEGAL_VERSIONS.terms, granted: false }, { auth }),
      'invalid_request',
    );
  });

  it('requires a session', async () => {
    await expectEnvelope(await record(agreement()), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now().getTime() - 100 * DAY_MS),
      expiresAt: new Date(now().getTime() - MINUTE_MS),
    });
    await expectEnvelope(await record(agreement(), { auth: expired }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await record(agreement(), {
        auth: cookie,
        headers: { Authorization: 'Bearer not-a-session-token-of-anyone-at-all' },
      }),
      'unauthenticated',
    );
    expect(await rowsOf(user.id)).toEqual([]);
  });

  it('checks origin on cookie writes', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await record(agreement(), { auth: cookie, origin: null }),
      'origin_rejected',
    );
    await expectEnvelope(
      await record(agreement(), { auth: cookie, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    await expectEnvelope(
      await record(agreement(), {
        auth: cookie,
        client: 'ios/1.4.0',
        origin: testApp.deps.env.PUBLIC_URL,
      }),
      'origin_rejected',
    );
    expect(await rowsOf(user.id)).toEqual([]);
    await expectConsents(await record(agreement('terms'), { auth: cookie }));
    const bearer: TestAuth = await signIn(testApp.deps.db, user, 'bearer');
    await expectConsents(await record(agreement('content_policy'), { auth: bearer, origin: null }));
    expect(await rowsOf(user.id)).toHaveLength(2);
  });

  it('an AI-screening answer is refused, and an earlier one is not reported', async () => {
    const user = await insertUser(testApp.deps.db);
    // A row written while the answer was asked.
    await insertConsent(testApp.deps.db, {
      userId: user.id,
      kind: 'ai_screening',
      version: OLD_VERSION,
      granted: false,
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const before = await rowsOf(user.id);
    for (const granted of [true, false]) {
      const envelope = await expectEnvelope(
        await record({ kind: 'ai_screening', version: OLD_VERSION, granted }, { auth }),
        'invalid_request',
      );
      expect(envelope.error.fields).toEqual({ kind: 'invalid_value' });
    }
    expect(await rowsOf(user.id)).toEqual(before);
    const me = await testApp.request.get('/v1/me', { auth });
    expect(me.status).toBe(200);
    expect((await me.json<{ consents: ConsentState }>()).consents).not.toHaveProperty(
      'aiScreening',
    );
  });

  it('terms with granted false answers not_allowed on granted', async () => {
    const { user, auth } = await member();
    const before = await rowsOf(user.id);
    for (const kind of ['terms', 'content_policy', 'privacy_policy'] as const) {
      const envelope = await expectEnvelope(
        await record({ kind, version: LEGAL_VERSIONS[kind], granted: false }, { auth }),
        'invalid_request',
      );
      expect(envelope.error.fields).toEqual({ granted: 'not_allowed' });
    }
    expect(await rowsOf(user.id)).toEqual(before);
  });

  it('an old version answers consent_version_outdated', async () => {
    const { user, auth } = await member();
    const before = await rowsOf(user.id);
    await expectEnvelope(
      await record({ kind: 'terms', version: OLD_VERSION, granted: true }, { auth }),
      'consent_version_outdated',
    );
    await expectEnvelope(
      await record({ kind: 'privacy_policy', version: OLD_VERSION, granted: true }, { auth }),
      'consent_version_outdated',
    );
    expect(await rowsOf(user.id)).toEqual(before);
  });

  it('agreeing to a new terms version removes terms from needed', async () => {
    const user = await insertUser(testApp.deps.db);
    await insertConsents(testApp.deps.db, user.id);
    // The newest granted terms row carries an older version than LEGAL_VERSIONS.terms.
    await insertConsent(testApp.deps.db, { userId: user.id, kind: 'terms', version: OLD_VERSION });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const me = await testApp.request.get('/v1/me', { auth });
    expect((await me.json<{ consents: ConsentState }>()).consents.needed).toEqual(['terms']);
    const state = await expectConsents(
      await record({ kind: 'terms', version: LEGAL_VERSIONS.terms, granted: true }, { auth }),
    );
    expect(state.needed).toEqual([]);
    expect(state.terms).toEqual({
      agreedVersion: LEGAL_VERSIONS.terms,
      currentVersion: LEGAL_VERSIONS.terms,
    });
  });

  it('a suspended user can record', async () => {
    const { user, auth } = await member({
      status: 'suspended',
      suspendedAt: now(),
      suspendedReason: 'spam',
    });
    await expectConsents(await record(agreement('privacy_policy'), { auth }));
    expect((await rowsOf(user.id)).at(-1)?.kind).toBe('privacy_policy');
  });

  it("the row's platform is the request's platform", async () => {
    const user = await insertUser(testApp.deps.db);
    const phone = await signIn(testApp.deps.db, user, 'bearer');
    const web = await signIn(testApp.deps.db, user, 'cookie');
    await expectConsents(
      await record(agreement('terms'), { auth: phone, client: 'android/1.4.0' }),
    );
    await expectConsents(await record(agreement('content_policy'), { auth: web }));
    expect((await rowsOf(user.id)).map((row) => row.platform)).toEqual(['android', 'web']);
  });

  it('a repeat adds a row and changes nothing the user sees', async () => {
    const { user, auth } = await member();
    // member() wrote one granted terms row at sign-up.
    const first = await expectConsents(await record(agreement('terms'), { auth }));
    const second = await expectConsents(await record(agreement('terms'), { auth }));
    expect(second).toEqual(first);
    expect((await rowsOf(user.id)).filter((row) => row.kind === 'terms')).toHaveLength(3);
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_write:1m`,
      windowStart,
      count: ME_WRITE_LIMIT,
    });
    const before = await rowsOf(user.id);
    const response = await record(agreement(), { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await rowsOf(user.id)).toEqual(before);
  });
});
