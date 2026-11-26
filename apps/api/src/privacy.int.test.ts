import { readFile } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { getTestDb, insertConsents, insertUser } from '@citizenrun/db/testing';
import {
  AppleCallbackFormSchema,
  AppleHandoffBodySchema,
  AppleNotificationBodySchema,
  CheckHandleQuerySchema,
  CreateClientErrorBodySchema,
  ERROR_CODES,
  LEGAL_VERSIONS,
  SetHandleBodySchema,
  SignInWithAppleBodySchema,
  SignInWithGoogleBodySchema,
  StartEmailSignInBodySchema,
  SuggestPlacesBodySchema,
  UpdateMeBodySchema,
  VerifyEmailSignInBodySchema,
  brandVariant,
  newId,
  variantForAppEnv,
} from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { randomToken } from '@citizenrun/shared/crypto';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE } from './scripts/gen-openapi.ts';
import { createTestApp } from './testing/app.ts';
import type { TestApp } from './testing/app.ts';
import { signIn } from './testing/auth.ts';
import { insertIdentity } from './testing/factories.ts';
import { fakeAddressSuggestions } from './testing/fakes/geocoder.ts';
import { FIXTURE_APPLE, FakeIdentityProviders } from './testing/fakes/identity.ts';
import { findTextInTables } from './testing/find-in-tables.ts';
import type { TestAuth, TestResponse } from './testing/request.ts';

// TEST-privacy-logscan's API suite. The always-on scan of the harness runs after every case as well.

/** How a row's request is sent. */
type Transport = {
  /** JSON (the default), or Apple's url-encoded form post from Apple's origin with no client header. */
  body?: 'json' | 'form';
  /** The X-OS-Client value of a JSON request; null sends none (a provider's server call). */
  client?: string | null;
  /** A signed-in phone's request by this method (default a logged-out POST); a `get` row's fields travel in the query. */
  method?: 'get' | 'put' | 'patch';
};

/** One run's request: the app it went to, the answer, and the secrets the scan looks for besides the marker. */
type Sent = { testApp: TestApp; response: TestResponse; secrets: readonly string[] };

/** One operation that takes text a user typed or a secret, and how to run it three ways. */
type SensitiveInput = {
  path: string;
  transport?: Transport;
  /** The body fields, as dot paths, that get the marker or carry a secret of the run. */
  fields: readonly string[];
  /** A valid body without any marker, for the validation failures. */
  validBody: () => Record<string, unknown>;
  /** Whether a body is valid, so the marker goes only into values the schema admits. */
  isValid: (body: unknown) => boolean;
  /** The validation failures are sent signed in, because the route reads a session before its input. */
  signedIn?: true;
  successStatus: number;
  /** Success: the fields carry the marker where the schema admits it, or a secret the run made. */
  success: () => Promise<Sent>;
  /** The text of every stored row the success path writes, when no stored row may hold the marker. */
  storedText?: () => Promise<string>;
  /** Asserts the answer to a body with one invalid marked field; default 400 `invalid_request`. */
  expectInvalid?: (response: TestResponse) => Promise<void>;
  /** A failure inside the operation; asserts its answer and returns what it sent. */
  failInside: () => Promise<Sent>;
};

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const IOS = 'ios/1.4.0';
const ANDROID = 'android/1.4.0';
const APPLE_ORIGIN = 'https://appleid.apple.com';
const APPLE_RETURN_PREFIX = `${brandVariant(variantForAppEnv('ci')).scheme}://auth/apple?`;
// The lengths an over-long marked value tries in turn: one past each maximum of the listed schemas.
const OVER_MAXIMUM_LENGTHS = [101, 257, 513, 1025, 4097, 8193];

const START_EMAIL = '/v1/auth/email/start';
const VERIFY_EMAIL = '/v1/auth/email/verify';
const NONCE = '/v1/auth/nonce';
const APPLE = '/v1/auth/apple';
const APPLE_CALLBACK = '/v1/auth/apple/callback';
const APPLE_HANDOFF = '/v1/auth/apple/handoff';
const APPLE_NOTIFICATIONS = '/v1/auth/apple/notifications';
const GOOGLE = '/v1/auth/google';
const ME = '/v1/me';
const CHECK_HANDLE = '/v1/handles/check';
const SET_HANDLE = '/v1/me/handle';
const SUGGEST_PLACES = '/v1/geo/autocomplete';
// A fixture key, never a real one: Geoapify with the suggestion fake behind it.
const FIXTURE_GEO_KEY = 'fixture-geo-key';
const GEOAPIFY_ENV = { GEO_PROVIDER: 'geoapify', GEO_API_KEY: FIXTURE_GEO_KEY } as const;

// Every request comes from its own address, so no case nears a per-replica limit.
const TEST_NETS = ['203.0.113', '198.51.100'];
const HOSTS_PER_NET = 254;
let nextHost = 0;
function freshIp(): string {
  const net = TEST_NETS[Math.floor(nextHost / HOSTS_PER_NET) % TEST_NETS.length] ?? '203.0.113';
  const ip = `${net}.${String((nextHost % HOSTS_PER_NET) + 1)}`;
  nextHost += 1;
  return ip;
}

// Each provider row signs in a subject of its own.
let nextSubject = 1;
function freshSubject(): string {
  const subject = `000555.privacy.${String(nextSubject)}`;
  nextSubject += 1;
  return subject;
}

/** A test address holding the lower-cased marker; the email schema lower-cases what it admits. */
function markedEmail(prefix: string): string {
  return `${prefix}${marker().toLowerCase()}@example.test`;
}

/** A marked value of exactly `length` characters. */
function markerOfLength(length: number): string {
  const value = marker();
  return value.repeat(Math.ceil(length / value.length)).slice(0, length);
}

function clientErrorBody(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: '/office/[slug]',
    component: 'OfficeScreen',
    appVersion: '1.4.0',
    platform: 'web',
    frames: [{ file: 'src/features/office/office-screen.tsx', line: 42, column: 7 }],
    requestId: newId(),
  };
}

function signupDetails(): Record<string, unknown> {
  return {
    age: { method: 'self_declared', sourceTier: 'self' },
    agreements: {
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    },
    aiScreening: true,
    state: 'TX',
  };
}

// A database whose every insert rejects with the marker in the error's message; nothing else of it
// is read by the operations listed here.
function insertRejectingDb(): Db {
  const rejectingInsert = {
    values: () => Promise.reject(new Error(`insert failed ${marker()}`)),
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'insert') {
          return () => rejectingInsert;
        }
        throw new Error(`db.${String(property)} is not part of this fake`);
      },
    },
  ) as Db; // a fake with only the insert path the operations use
}

/** A test app with the fixture Apple and Google settings and the fake key sets behind them. */
async function providerApp(): Promise<{ testApp: TestApp; identity: FakeIdentityProviders }> {
  const clock = new FakeClock();
  const identity = new FakeIdentityProviders(clock);
  const testApp = await createTestApp({
    clock,
    identity,
    env: { ...identity.appleEnv(), ...identity.googleEnv() },
  });
  return { testApp, identity };
}

function wrapResponse(response: Response): TestResponse {
  return {
    status: response.status,
    headers: response.headers,
    json: async <T = unknown>(): Promise<T> => {
      const parsed: unknown = await response.json();
      return parsed as T; // the caller names the shape it expects
    },
    text: () => response.text(),
  };
}

async function post(
  testApp: TestApp,
  path: string,
  body: unknown,
  transport: Transport = {},
): Promise<TestResponse> {
  if (transport.body === 'form') {
    const fields = Object.entries(body as Record<string, unknown>).map(
      ([name, value]): [string, string] => [name, String(value)],
    ); // a form row's body holds strings only
    const response = await testApp.app.request(
      new URL(path, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: APPLE_ORIGIN,
          'x-real-ip': freshIp(),
        },
        body: new URLSearchParams(fields).toString(),
      },
    );
    return wrapResponse(response);
  }
  return testApp.request.post(path, {
    client: transport.client === undefined ? IOS : transport.client,
    ip: freshIp(),
    body,
  });
}

/** A signed-in phone's request by `transport.method`: the fields in the query for `get`, else the JSON body. */
async function sendSignedIn(
  testApp: TestApp,
  path: string,
  fields: Record<string, unknown>,
  transport: Transport,
  auth: TestAuth,
): Promise<TestResponse> {
  const options = { auth, client: transport.client ?? IOS, ip: freshIp() };
  if (transport.method === 'get') {
    const query = Object.fromEntries(
      Object.entries(fields).map(([name, value]): [string, string] => [name, String(value)]),
    );
    return testApp.request.get(path, { ...options, query });
  }
  if (transport.method === 'put') {
    return testApp.request.put(path, { ...options, body: fields });
  }
  if (transport.method === 'patch') {
    return testApp.request.patch(path, { ...options, body: fields });
  }
  return testApp.request.post(path, { ...options, body: fields });
}

/** A user with the four sign-up agreements (so a bio needs no other answer), signed in by bearer. */
async function signedInUser(testApp: TestApp): Promise<TestAuth> {
  const user = await insertUser(testApp.deps.db);
  await insertConsents(testApp.deps.db, user.id);
  return signIn(testApp.deps.db, user, 'bearer');
}

/** The lower-cased marker: 20 characters a handle admits, stored as typed. */
function markedHandle(): string {
  return marker().toLowerCase();
}

/** Removes any user an earlier run left holding the marked handle (the rows share one database). */
async function freeMarkedHandle(testApp: TestApp): Promise<void> {
  await testApp.deps.db.delete(users).where(eq(users.handle, markedHandle()));
}

type NonceResult = { nonce: string; nonceHash: string; state: string; expiresAt: string };

async function issueNonce(testApp: TestApp, client: string): Promise<NonceResult> {
  const response = await post(testApp, NONCE, {}, { client });
  expect(response.status).toBe(200);
  return response.json<NonceResult>();
}

/** E-AUTH-01 for `email` on `testApp`: the pending token and the code the capture mailer holds. */
async function startEmail(
  testApp: TestApp,
  email: string,
): Promise<{ pendingToken: string; code: string }> {
  const response = await post(testApp, START_EMAIL, { email });
  expect(response.status).toBe(200);
  const { pendingToken } = await response.json<{ pendingToken: string }>();
  const code = testApp.fakes.mailer.codeFor(email) ?? '';
  expect(code).toMatch(/^[0-9]{6}$/);
  return { pendingToken, code };
}

/** A string field of a log line or row equal to the code: the code as JSON writes it. */
function asJsonString(value: string): string {
  return JSON.stringify(value);
}

function returnQuery(response: TestResponse): URLSearchParams {
  expect(response.status).toBe(302);
  const location = response.headers.get('location') ?? '';
  expect(location.startsWith(APPLE_RETURN_PREFIX)).toBe(true);
  expectNoMarkerIn(location);
  return new URLSearchParams(location.slice(APPLE_RETURN_PREFIX.length));
}

async function expectReturnError(response: TestResponse, error: string): Promise<void> {
  expect(returnQuery(response).get('error')).toBe(error);
  expect(await response.text()).toBe('');
}

/** Apple's form post for a fresh nonce on `testApp`, with the marker in `code` and in `user`. */
async function markedCallbackForm(
  testApp: TestApp,
  identity: FakeIdentityProviders,
): Promise<{ form: Record<string, string>; nonce: NonceResult; idToken: string }> {
  const nonce = await issueNonce(testApp, ANDROID);
  const email = markedEmail('c');
  const idToken = await identity.appleIdToken({
    aud: FIXTURE_APPLE.servicesId,
    nonce: nonce.nonceHash,
    sub: freshSubject(),
    email,
    email_verified: true,
  });
  const user = JSON.stringify({ name: { firstName: marker(), lastName: marker() }, email });
  return {
    form: { state: nonce.state, code: marker(), id_token: idToken, user },
    nonce,
    idToken,
  };
}

/** E-AUTH-03 then E-AUTH-05 on `testApp`: the redirect's hand-off code and every secret on the way. */
async function appleHandoffCode(
  testApp: TestApp,
  identity: FakeIdentityProviders,
): Promise<{ code: string; nonce: NonceResult; secrets: string[] }> {
  const { form, nonce, idToken } = await markedCallbackForm(testApp, identity);
  const response = await post(testApp, APPLE_CALLBACK, form, { body: 'form' });
  const code = returnQuery(response).get('code') ?? '';
  expect(code).toMatch(TOKEN_PATTERN);
  return { code, nonce, secrets: [code, nonce.nonce, nonce.nonceHash, nonce.state, idToken] };
}

function base64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** The typed text of an address or place query, with the marker in it. */
function markedQuery(): string {
  return `Fixture ${marker()}`;
}

/** A test app on Geoapify whose suggestion fake answers the marked query with one suggestion. */
async function geoapifyApp(): Promise<TestApp> {
  const testApp = await createTestApp({ env: GEOAPIFY_ENV });
  fakeAddressSuggestions(testApp.fakes.outbound, {
    [markedQuery()]: [{ formatted: `1 Fixture Way ${marker()}`, lat: 30.1, lon: -39.9 }],
  });
  return testApp;
}

/** A user whose email holds no marker, signed in by bearer, so a table scan for it means something. */
async function unmarkedUser(testApp: TestApp): Promise<TestAuth> {
  const user = await insertUser(testApp.deps.db, { email: 'fixture.places@example.test' });
  return signIn(testApp.deps.db, user, 'bearer');
}

/** Every operation with a string field in its body or query that gets the marker. */
const SENSITIVE_INPUTS: Readonly<Record<string, SensitiveInput>> = {
  createClientError: {
    path: '/v1/client-errors',
    transport: { client: 'web' },
    fields: ['name', 'code', 'route', 'component', 'appVersion', 'frames.0.file', 'requestId'],
    validBody: clientErrorBody,
    isValid: (body) => CreateClientErrorBodySchema.safeParse(body).success,
    successStatus: 204,
    // The marker goes only into keys the schema drops.
    success: async () => {
      const testApp = await createTestApp();
      const body = {
        ...clientErrorBody(),
        message: marker(),
        stack: `Error: ${marker()}\n    at fixture (src/app.ts:1:1)`,
      };
      const response = await post(testApp, '/v1/client-errors', body, { client: 'web' });
      return { testApp, response, secrets: [] };
    },
    storedText: async () => {
      const rows = await getTestDb().execute<{ text: string }>(
        sql`select coalesce(string_agg(t::text, ''), '') as text from client_errors t`,
        'objects',
      );
      return rows[0]?.text ?? '';
    },
    // Valid fields carry the marker where the schema admits it, and the write throws.
    failInside: async () => {
      const testApp = await createTestApp({ db: insertRejectingDb() });
      const fields = SENSITIVE_INPUTS['createClientError']?.fields ?? [];
      const body = clientErrorBody();
      let marked = 0;
      for (const field of fields) {
        for (const candidate of [marker(), `/${marker()}`]) {
          const tried = structuredClone(body);
          setAt(tried, field, candidate);
          if (CreateClientErrorBodySchema.safeParse(tried).success) {
            setAt(body, field, candidate);
            marked += 1;
            break;
          }
        }
      }
      expect(marked).toBeGreaterThan(0);
      const response = await post(testApp, '/v1/client-errors', body, { client: 'web' });
      await expectEnvelope(response, 'internal');
      const errorLines = testApp.logs.filter((line) => line.parsed['event'] === 'request.error');
      expect(errorLines).toHaveLength(1);
      return { testApp, response, secrets: [] };
    },
  },
  startEmailSignIn: {
    path: START_EMAIL,
    fields: ['email'],
    validBody: () => ({ email: 'person@example.test' }),
    isValid: (body) => StartEmailSignInBodySchema.safeParse(body).success,
    successStatus: 200,
    success: async () => {
      const testApp = await createTestApp();
      const email = markedEmail('m');
      const response = await post(testApp, START_EMAIL, { email });
      const { pendingToken } = await response.json<{ pendingToken: string }>();
      const code = testApp.fakes.mailer.codeFor(email) ?? '';
      expect(code).toMatch(/^[0-9]{6}$/);
      return { testApp, response, secrets: [pendingToken, asJsonString(code)] };
    },
    // The capture mailer's provider 5xx.
    failInside: async () => {
      const testApp = await createTestApp();
      testApp.fakes.mailer.failNext('5xx');
      const response = await post(testApp, START_EMAIL, { email: markedEmail('m') });
      await expectEnvelope(response, 'unavailable');
      expect(testApp.fakes.mailer.sent).toHaveLength(0);
      return { testApp, response, secrets: [] };
    },
  },
  verifyEmailSignIn: {
    path: VERIFY_EMAIL,
    fields: ['pendingToken', 'code', 'signup.state'],
    validBody: () => ({ pendingToken: randomToken(), code: '123456', signup: signupDetails() }),
    isValid: (body) => VerifyEmailSignInBodySchema.safeParse(body).success,
    successStatus: 200,
    success: async () => {
      const testApp = await createTestApp();
      const { pendingToken, code } = await startEmail(testApp, markedEmail('v'));
      const response = await post(testApp, VERIFY_EMAIL, {
        pendingToken,
        code,
        signup: signupDetails(),
      });
      return { testApp, response, secrets: [pendingToken, asJsonString(code)] };
    },
    // A wrong code.
    failInside: async () => {
      const testApp = await createTestApp();
      const { pendingToken, code } = await startEmail(testApp, markedEmail('w'));
      const wrong = code === '000000' ? '000001' : '000000';
      const response = await post(testApp, VERIFY_EMAIL, {
        pendingToken,
        code: wrong,
        signup: signupDetails(),
      });
      await expectEnvelope(response, 'code_invalid');
      return {
        testApp,
        response,
        secrets: [pendingToken, asJsonString(code), asJsonString(wrong)],
      };
    },
  },
  signInWithApple: {
    path: APPLE,
    fields: ['idToken', 'nonce', 'code', 'name.givenName', 'name.familyName'],
    validBody: () => ({
      idToken: 'header.payload.signature',
      code: 'fixture-code',
      nonce: randomToken(),
      name: { givenName: 'Given', familyName: 'Family' },
    }),
    isValid: (body) => SignInWithAppleBodySchema.safeParse(body).success,
    successStatus: 200,
    success: async () => {
      const { testApp, identity } = await providerApp();
      identity.registerAppleEndpoints(testApp.fakes.outbound);
      const nonce = await issueNonce(testApp, IOS);
      const idToken = await identity.appleIdToken({
        nonce: nonce.nonceHash,
        sub: freshSubject(),
        email: markedEmail('a'),
        email_verified: true,
      });
      const response = await post(testApp, APPLE, {
        idToken,
        code: marker(),
        nonce: nonce.nonce,
        name: { givenName: marker(), familyName: marker() },
        signup: signupDetails(),
      });
      expect(identity.exchanges.map((exchange) => exchange.code)).toEqual([marker()]);
      return { testApp, response, secrets: [idToken, nonce.nonce, nonce.nonceHash] };
    },
    // Apple's token endpoint answers 500 with the marker in its body; the sign-in still succeeds.
    failInside: async () => {
      const { testApp, identity } = await providerApp();
      testApp.fakes.outbound.on('appleid.apple.com', 'POST', '/auth/token', () => ({
        status: 500,
        body: `token endpoint failed ${marker()}`,
      }));
      const nonce = await issueNonce(testApp, IOS);
      const idToken = await identity.appleIdToken({
        nonce: nonce.nonceHash,
        sub: freshSubject(),
        email: markedEmail('b'),
        email_verified: true,
      });
      const response = await post(testApp, APPLE, {
        idToken,
        code: marker(),
        nonce: nonce.nonce,
        name: { givenName: marker(), familyName: marker() },
        signup: signupDetails(),
      });
      expect(response.status).toBe(200);
      expect(testApp.fakes.outbound.calls.map((call) => call.path)).toEqual(['/auth/token']);
      return { testApp, response, secrets: [idToken, nonce.nonce, nonce.nonceHash] };
    },
  },
  appleSignInCallback: {
    path: APPLE_CALLBACK,
    transport: { body: 'form' },
    fields: ['id_token', 'code', 'state', 'user'],
    validBody: () => ({ state: 'x', code: 'fixture-code', id_token: 'x', user: '{}' }),
    isValid: (body) => AppleCallbackFormSchema.safeParse(body).success,
    successStatus: 302,
    success: async () => {
      const { testApp, identity } = await providerApp();
      identity.registerAppleEndpoints(testApp.fakes.outbound);
      const { form, nonce, idToken } = await markedCallbackForm(testApp, identity);
      const response = await post(testApp, APPLE_CALLBACK, form, { body: 'form' });
      const code = returnQuery(response).get('code') ?? '';
      expect(code).toMatch(TOKEN_PATTERN);
      return {
        testApp,
        response,
        secrets: [idToken, nonce.state, nonce.nonce, nonce.nonceHash, code],
      };
    },
    // Every refusal of Apple's form post is a redirect, a malformed form included.
    expectInvalid: (response) => expectReturnError(response, 'invalid_request'),
    // A state that fails verification.
    failInside: async () => {
      const { testApp, identity } = await providerApp();
      identity.registerAppleEndpoints(testApp.fakes.outbound);
      const { form, nonce, idToken } = await markedCallbackForm(testApp, identity);
      const response = await post(
        testApp,
        APPLE_CALLBACK,
        { ...form, state: marker() },
        { body: 'form' },
      );
      await expectReturnError(response, 'state_invalid');
      expect(testApp.fakes.outbound.calls).toHaveLength(0);
      return { testApp, response, secrets: [idToken, nonce.state, nonce.nonce, nonce.nonceHash] };
    },
  },
  appleSignInHandoff: {
    path: APPLE_HANDOFF,
    transport: { client: ANDROID },
    fields: ['code', 'nonce'],
    validBody: () => ({ code: randomToken(), nonce: randomToken() }),
    isValid: (body) => AppleHandoffBodySchema.safeParse(body).success,
    successStatus: 200,
    success: async () => {
      const { testApp, identity } = await providerApp();
      identity.registerAppleEndpoints(testApp.fakes.outbound);
      const { code, nonce, secrets } = await appleHandoffCode(testApp, identity);
      const response = await post(
        testApp,
        APPLE_HANDOFF,
        { code, nonce: nonce.nonce, signup: signupDetails() },
        { client: ANDROID },
      );
      return { testApp, response, secrets };
    },
    // A used hand-off code.
    failInside: async () => {
      const { testApp, identity } = await providerApp();
      identity.registerAppleEndpoints(testApp.fakes.outbound);
      const { code, nonce, secrets } = await appleHandoffCode(testApp, identity);
      const body = { code, nonce: nonce.nonce, signup: signupDetails() };
      const first = await post(testApp, APPLE_HANDOFF, body, { client: ANDROID });
      expect(first.status).toBe(200);
      const response = await post(testApp, APPLE_HANDOFF, body, { client: ANDROID });
      await expectEnvelope(response, 'handoff_invalid');
      return { testApp, response, secrets };
    },
  },
  receiveAppleNotification: {
    path: APPLE_NOTIFICATIONS,
    transport: { client: null },
    fields: ['payload'],
    validBody: () => ({ payload: 'header.payload.signature' }),
    isValid: (body) => AppleNotificationBodySchema.safeParse(body).success,
    successStatus: 200,
    success: async () => {
      const { testApp, identity } = await providerApp();
      const email = markedEmail('n');
      const subject = freshSubject();
      const user = await insertUser(testApp.deps.db, { email });
      await insertIdentity(testApp.deps.db, {
        userId: user.id,
        provider: 'apple',
        subject,
        email,
        emailVerified: true,
      });
      const payload = await identity.appleNotification({
        type: 'email-disabled',
        sub: subject,
        email: `${marker()}@example.test`,
      });
      const response = await post(testApp, APPLE_NOTIFICATIONS, { payload }, { client: null });
      return { testApp, response, secrets: [payload, subject] };
    },
    // An unsigned payload.
    failInside: async () => {
      const { testApp } = await providerApp();
      const claims = {
        iss: APPLE_ORIGIN,
        aud: FIXTURE_APPLE.bundleId,
        events: JSON.stringify({
          type: 'email-disabled',
          sub: marker(),
          email: `${marker()}@example.test`,
        }),
      };
      const payload = `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64Url(
        JSON.stringify(claims),
      )}.`;
      const response = await post(testApp, APPLE_NOTIFICATIONS, { payload }, { client: null });
      await expectEnvelope(response, 'signature_invalid');
      return { testApp, response, secrets: [payload] };
    },
  },
  signInWithGoogle: {
    path: GOOGLE,
    fields: ['idToken', 'nonce'],
    validBody: () => ({ idToken: 'header.payload.signature', nonce: randomToken() }),
    isValid: (body) => SignInWithGoogleBodySchema.safeParse(body).success,
    successStatus: 200,
    success: async () => {
      const { testApp, identity } = await providerApp();
      const nonce = await issueNonce(testApp, IOS);
      const idToken = await identity.googleIdToken({
        nonce: nonce.nonceHash,
        sub: freshSubject(),
        email: markedEmail('g'),
        email_verified: true,
      });
      const response = await post(testApp, GOOGLE, {
        idToken,
        nonce: nonce.nonce,
        signup: signupDetails(),
      });
      return { testApp, response, secrets: [idToken, nonce.nonce, nonce.nonceHash] };
    },
    // A token for another audience.
    failInside: async () => {
      const { testApp, identity } = await providerApp();
      const nonce = await issueNonce(testApp, IOS);
      const idToken = await identity.googleIdToken({
        nonce: nonce.nonceHash,
        aud: FIXTURE_APPLE.bundleId,
        sub: freshSubject(),
        email: markedEmail('h'),
        email_verified: true,
      });
      const response = await post(testApp, GOOGLE, {
        idToken,
        nonce: nonce.nonce,
        signup: signupDetails(),
      });
      await expectEnvelope(response, 'identity_token_invalid');
      return { testApp, response, secrets: [idToken, nonce.nonce, nonce.nonceHash] };
    },
  },
  updateMe: {
    path: ME,
    transport: { method: 'patch' },
    fields: ['name', 'bio', 'link'],
    validBody: () => ({
      name: 'Fixture Name',
      bio: 'Fixture bio.',
      link: 'https://example.test/fixture',
    }),
    isValid: (body) => UpdateMeBodySchema.safeParse(body).success,
    signedIn: true,
    successStatus: 200,
    success: async () => {
      const testApp = await createTestApp();
      const auth = await signedInUser(testApp);
      const link = `https://example.test/${marker()}`;
      const response = await sendSignedIn(
        testApp,
        ME,
        { name: marker(), bio: marker(), link },
        { method: 'patch' },
        auth,
      );
      expect(await response.json()).toMatchObject({ name: marker(), bio: marker(), link });
      return { testApp, response, secrets: [] };
    },
    // An upload key that names no upload, beside a marked bio.
    failInside: async () => {
      const testApp = await createTestApp();
      const auth = await signedInUser(testApp);
      const response = await sendSignedIn(
        testApp,
        ME,
        { bio: marker(), avatarUploadKey: `incoming/${newId()}/${marker()}.jpg` },
        { method: 'patch' },
        auth,
      );
      await expectEnvelope(response, 'upload_invalid');
      return { testApp, response, secrets: [] };
    },
  },
  checkHandle: {
    path: CHECK_HANDLE,
    transport: { method: 'get' },
    fields: ['handle'],
    validBody: () => ({ handle: 'fixture_handle' }),
    isValid: (body) => CheckHandleQuerySchema.safeParse(body).success,
    signedIn: true,
    successStatus: 200,
    success: async () => {
      const testApp = await createTestApp();
      await freeMarkedHandle(testApp);
      const auth = await signedInUser(testApp);
      const response = await sendSignedIn(
        testApp,
        CHECK_HANDLE,
        { handle: markedHandle() },
        { method: 'get' },
        auth,
      );
      expect(await response.json()).toEqual({
        handle: markedHandle(),
        available: true,
        reason: null,
      });
      return { testApp, response, secrets: [] };
    },
    // Another user holds the handle.
    failInside: async () => {
      const testApp = await createTestApp();
      await freeMarkedHandle(testApp);
      await insertUser(testApp.deps.db, { handle: markedHandle() });
      const auth = await signedInUser(testApp);
      const response = await sendSignedIn(
        testApp,
        CHECK_HANDLE,
        { handle: markedHandle() },
        { method: 'get' },
        auth,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        handle: markedHandle(),
        available: false,
        reason: 'taken',
      });
      return { testApp, response, secrets: [] };
    },
  },
  setHandle: {
    path: SET_HANDLE,
    transport: { method: 'put' },
    fields: ['handle'],
    validBody: () => ({ handle: 'fixture_handle' }),
    isValid: (body) => SetHandleBodySchema.safeParse(body).success,
    signedIn: true,
    successStatus: 200,
    success: async () => {
      const testApp = await createTestApp();
      await freeMarkedHandle(testApp);
      const auth = await signedInUser(testApp);
      const response = await sendSignedIn(
        testApp,
        SET_HANDLE,
        { handle: markedHandle() },
        { method: 'put' },
        auth,
      );
      expect(await response.json()).toMatchObject({ handle: markedHandle() });
      return { testApp, response, secrets: [] };
    },
    // Another user holds the handle: the unique key refuses it.
    failInside: async () => {
      const testApp = await createTestApp();
      await freeMarkedHandle(testApp);
      await insertUser(testApp.deps.db, { handle: markedHandle() });
      const auth = await signedInUser(testApp);
      const response = await sendSignedIn(
        testApp,
        SET_HANDLE,
        { handle: markedHandle() },
        { method: 'put' },
        auth,
      );
      await expectEnvelope(response, 'handle_taken');
      return { testApp, response, secrets: [] };
    },
  },
  suggestPlaces: {
    path: SUGGEST_PLACES,
    fields: ['q'],
    validBody: () => ({ q: 'Fixture City', kind: 'place' }),
    isValid: (body) => SuggestPlacesBodySchema.safeParse(body).success,
    signedIn: true,
    successStatus: 200,
    // The marked text as a place query, then as an address query sent to the provider.
    success: async () => {
      const testApp = await geoapifyApp();
      const auth = await signedInUser(testApp);
      const place = await sendSignedIn(
        testApp,
        SUGGEST_PLACES,
        { q: markedQuery(), kind: 'place' },
        {},
        auth,
      );
      expect(place.status).toBe(200);
      const response = await sendSignedIn(
        testApp,
        SUGGEST_PLACES,
        { q: markedQuery(), kind: 'address' },
        {},
        auth,
      );
      expect(await response.json()).toMatchObject({ attribution: 'geoapify' });
      expect(testApp.fakes.outbound.calls).toHaveLength(1);
      return { testApp, response, secrets: [FIXTURE_GEO_KEY] };
    },
    // The provider answers 5xx with the marker in its body.
    failInside: async () => {
      const testApp = await createTestApp({ env: GEOAPIFY_ENV });
      testApp.fakes.outbound.on(
        'api.geoapify.com',
        'GET',
        /^\/v1\/geocode\/autocomplete\?/,
        () => ({
          status: 503,
          body: `Unavailable ${marker()}`,
        }),
      );
      const auth = await signedInUser(testApp);
      const response = await sendSignedIn(
        testApp,
        SUGGEST_PLACES,
        { q: markedQuery(), kind: 'address' },
        {},
        auth,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], nextCursor: null, attribution: null });
      const failed = testApp.logs.filter((line) => line.parsed['event'] === 'geo.provider_failed');
      expect(failed).toHaveLength(1);
      return { testApp, response, secrets: [FIXTURE_GEO_KEY] };
    },
  },
};

/** Operations with a string field that a user never types, each with its reason. */
const NO_USER_TEXT: Readonly<Record<string, string>> = {
  setIssues: 'Issue ids from the reference list and starred flags.',
  skipOnboardingStep: 'One enumerated onboarding step.',
  recordConsent: 'An enumerated kind and a version compared with a constant.',
  recordAgeSignal: 'An enumerated age band and source tier.',
  createUpload: 'Enumerated kind, purpose and content type, and a size.',
};

function setAt(body: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let target: unknown = body;
  for (const key of keys.slice(0, -1)) {
    target = (target as Record<string, unknown>)[key]; // walks a body this file built
  }
  (target as Record<string, unknown>)[keys.at(-1) ?? ''] = value; // the parent found above
}

// A value's base64 forms, one per byte alignment of the value inside the encoded text: each is the
// run of characters made of the value's bytes only, the same whatever comes before and after.
function base64Forms(value: string): string[] {
  const bytes = Buffer.from(value, 'utf8');
  return [0, 1, 2].map((offset) => {
    const shifted = Buffer.concat([Buffer.alloc(offset), bytes]);
    const encoded = shifted.toString('base64');
    const skipGroups = offset === 0 ? 0 : 1;
    const wholeGroups = Math.floor(shifted.length / 3) - skipGroups;
    return encoded.slice(skipGroups * 4, (skipGroups + wholeGroups) * 4);
  });
}

/** The marker and its lower-cased form (an email or a handle is stored lower-cased), each plain, URL-encoded and in base64. */
function markedForms(): string[] {
  return [marker(), marker().toLowerCase()].flatMap((value) => [
    value,
    encodeURIComponent(value),
    ...base64Forms(value),
  ]);
}

function expectNoMarkerIn(text: string): void {
  for (const form of markedForms()) {
    expect(text).not.toContain(form);
  }
}

/** No captured log line and no job payload holds a form of the marker or a secret of the run. */
async function expectNothingLeaked(testApp: TestApp, secrets: readonly string[]): Promise<void> {
  expect(testApp.logs.length).toBeGreaterThan(0);
  const jobs = await getTestDb().execute<{ text: string }>(
    sql`select coalesce(string_agg(data::text, ''), '') as text from pgboss.job`,
    'objects',
  );
  const texts = [...testApp.logs.map((line) => line.raw), jobs[0]?.text ?? ''];
  for (const text of texts) {
    expectNoMarkerIn(text);
    for (const secret of secrets) {
      expect(secret).not.toBe('');
      expect(text).not.toContain(secret);
    }
  }
}

async function send(
  testApp: TestApp,
  input: SensitiveInput,
  body: unknown,
  auth: TestAuth | null = null,
): Promise<TestResponse> {
  if (auth !== null) {
    const fields = body as Record<string, unknown>; // every row's body is an object this file built
    return sendSignedIn(testApp, input.path, fields, input.transport ?? {}, auth);
  }
  return post(testApp, input.path, body, input.transport);
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const text = await response.text();
  expectNoMarkerIn(text);
  expect(JSON.parse(text)).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
}

/** Success: the documented status; no stored row the row names holds the marker; nothing leaked. */
async function runSuccess(input: SensitiveInput): Promise<void> {
  const { testApp, response, secrets } = await input.success();
  expect(response.status).toBe(input.successStatus);
  if (input.storedText !== undefined) {
    const stored = await input.storedText();
    expect(stored).not.toBe('');
    expectNoMarkerIn(stored);
  }
  await expectNothingLeaked(testApp, secrets);
}

/** Validation failure: each field in turn holds an invalid marked value. */
async function runValidationFailures(input: SensitiveInput): Promise<void> {
  const testApp = await createTestApp();
  const auth = input.signedIn === true ? await signedInUser(testApp) : null;
  const candidates = [`Bad ${marker()}`, ...OVER_MAXIMUM_LENGTHS.map(markerOfLength)];
  for (const field of input.fields) {
    const body = structuredClone(input.validBody());
    expect(input.isValid(body), field).toBe(true);
    const invalid = candidates.find((candidate) => {
      const tried = structuredClone(body);
      setAt(tried, field, candidate);
      return !input.isValid(tried);
    });
    expect(invalid, field).toBeDefined();
    setAt(body, field, invalid);
    const response = await send(testApp, input, body, auth);
    if (input.expectInvalid === undefined) {
      await expectEnvelope(response, 'invalid_request');
    } else {
      await input.expectInvalid(response);
    }
  }
  await expectNothingLeaked(testApp, []);
}

/** Inner failure: the row arranges the failure and asserts its answer; nothing leaked. */
async function runInnerFailure(input: SensitiveInput): Promise<void> {
  const { testApp, secrets } = await input.failInside();
  await expectNothingLeaked(testApp, secrets);
}

/** Every string value anywhere inside a parsed log line. */
function stringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringValues);
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap(stringValues);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Whether a schema of the document holds a string anywhere, following $ref, properties, items,
// combinators and additional properties.
function holdsString(
  document: Record<string, unknown>,
  schema: unknown,
  seen: Set<string>,
): boolean {
  if (!isRecord(schema)) {
    return false;
  }
  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    if (seen.has(ref)) {
      return false;
    }
    seen.add(ref);
    const name = ref.replace('#/components/schemas/', '');
    const components = isRecord(document['components']) ? document['components'] : {};
    const schemas = isRecord(components['schemas']) ? components['schemas'] : {};
    return holdsString(document, schemas[name], seen);
  }
  const type = schema['type'];
  if (type === 'string' || (Array.isArray(type) && type.includes('string'))) {
    return true;
  }
  const nested: unknown[] = [schema['items'], schema['additionalProperties']];
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const list = schema[key];
    if (Array.isArray(list)) {
      nested.push(...list);
    }
  }
  if (isRecord(schema['properties'])) {
    nested.push(...Object.values(schema['properties']));
  }
  return nested.some((child) => holdsString(document, child, seen));
}

function takesText(document: Record<string, unknown>, operation: Record<string, unknown>): boolean {
  const requestBody = operation['requestBody'];
  const content =
    isRecord(requestBody) && isRecord(requestBody['content']) ? requestBody['content'] : {};
  for (const media of Object.values(content)) {
    if (isRecord(media) && holdsString(document, media['schema'], new Set())) {
      return true;
    }
  }
  const parameters = operation['parameters'];
  return (Array.isArray(parameters) ? parameters : []).some(
    (parameter) =>
      isRecord(parameter) &&
      parameter['in'] === 'query' &&
      holdsString(document, parameter['schema'], new Set()),
  );
}

async function committedOperations(): Promise<{
  document: Record<string, unknown>;
  operations: Map<string, Record<string, unknown>>;
}> {
  const parsed: unknown = JSON.parse(await readFile(OPENAPI_FILE, 'utf8'));
  const document = isRecord(parsed) ? parsed : {};
  const operations = new Map<string, Record<string, unknown>>();
  const paths = isRecord(document['paths']) ? document['paths'] : {};
  for (const item of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = isRecord(item) ? item[method] : undefined;
      if (isRecord(operation) && typeof operation['operationId'] === 'string') {
        operations.set(operation['operationId'], operation);
      }
    }
  }
  return { document, operations };
}

describe('the API privacy suite', () => {
  it('client error reports keep only the fixed schema', async () => {
    const input = SENSITIVE_INPUTS['createClientError'];
    if (input === undefined) {
      throw new Error('createClientError is missing from SENSITIVE_INPUTS');
    }
    await runSuccess(input);

    const refusing = await createTestApp();
    const refused = await send(refusing, input, { ...input.validBody(), name: `Bad ${marker()}` });
    await expectEnvelope(refused, 'invalid_request');
    await expectNothingLeaked(refusing, []);

    await runInnerFailure(input);
  });

  it('sign-in email and code are not logged', async () => {
    const testApp = await createTestApp();
    const email = markedEmail('s');
    const { pendingToken, code } = await startEmail(testApp, email);
    const response = await post(testApp, VERIFY_EMAIL, {
      pendingToken,
      code,
      signup: signupDetails(),
    });
    expect(response.status).toBe(200);

    // The address reached the account, its one intended store.
    const stored = await getTestDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    expect(stored).toHaveLength(1);

    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(email);
      expect(line.raw).not.toContain(pendingToken);
      expect(stringValues(line.parsed)).not.toContain(code);
    }
    const jobs = await getTestDb().execute<{ text: string }>(
      sql`select coalesce(string_agg(data::text, ''), '') as text from pgboss.job`,
      'objects',
    );
    expect(jobs[0]?.text ?? '').not.toContain(email);
    await expectNothingLeaked(testApp, [pendingToken, asJsonString(code)]);
  });

  it('typed address and coordinates are dropped', async () => {
    // Address suggestions: the marked text through both kinds, and beside an invalid kind.
    const testApp = await geoapifyApp();
    const auth = await unmarkedUser(testApp);
    for (const kind of ['place', 'address'] as const) {
      const response = await sendSignedIn(
        testApp,
        SUGGEST_PLACES,
        { q: markedQuery(), kind },
        {},
        auth,
      );
      expect(response.status).toBe(200);
    }
    const refused = await sendSignedIn(
      testApp,
      SUGGEST_PLACES,
      { q: markedQuery(), kind: 'street' },
      {},
      auth,
    );
    await expectEnvelope(refused, 'invalid_request');
    // The text reached the provider, its one intended recipient, and nothing else kept it.
    expect(testApp.fakes.outbound.calls).toHaveLength(1);
    await expectNothingLeaked(testApp, [FIXTURE_GEO_KEY]);
    const jobs = await getTestDb().execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job`,
      'objects',
    );
    expect(jobs[0]?.n).toBe(0);
    for (const form of markedForms()) {
      expect(await findTextInTables(getTestDb(), form), form).toEqual([]);
    }
  });

  it('every operation that takes text is listed', async () => {
    const { document, operations } = await committedOperations();
    const unlisted: string[] = [];
    for (const [operationId, operation] of operations) {
      const listed = operationId in SENSITIVE_INPUTS || operationId in NO_USER_TEXT;
      if (takesText(document, operation) && !listed) {
        unlisted.push(operationId);
      }
    }
    expect(unlisted).toEqual([]);
    const stale = [...Object.keys(SENSITIVE_INPUTS), ...Object.keys(NO_USER_TEXT)].filter(
      (operationId) => !operations.has(operationId),
    );
    expect(stale).toEqual([]);
    for (const reason of Object.values(NO_USER_TEXT)) {
      expect(reason.trim()).not.toBe('');
    }
    expect(takesText(document, operations.get('createClientError') ?? {})).toBe(true);
    expect(takesText(document, operations.get('getReadyz') ?? {})).toBe(false);
  });

  it('SENSITIVE_INPUTS run three ways', async () => {
    for (const input of Object.values(SENSITIVE_INPUTS)) {
      await runSuccess(input);
      await runValidationFailures(input);
      await runInnerFailure(input);
    }
  });
});
