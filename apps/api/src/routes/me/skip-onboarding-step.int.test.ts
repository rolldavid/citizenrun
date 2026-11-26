import { appEvents, users } from '@citizenrun/db';
import { insertRateCounter, insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, Me } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-10: TEST-api-ME and TEST-onboarding for POST /v1/me/onboarding/skip.
const PATH = '/v1/me/onboarding/skip';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.write: 30 a minute per user.
const ME_WRITE_LIMIT = 30;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };
type Step = 'photo' | 'handle' | 'issues' | 'location' | 'done';

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function skip(step: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { body: { step }, ...options });
}

async function expectMe(response: TestResponse): Promise<Me> {
  expect(response.status).toBe(200);
  return MeSchema.parse(await response.json());
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

async function atStep(step: Step, overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, {
    ...(step === 'photo' || step === 'handle' ? { handle: null } : {}),
    onboardingStep: step,
    onboardedAt: null,
    ...overrides,
  });
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function userRow(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

async function eventsOf(userId: string) {
  return testApp.deps.db
    .select({ name: appEvents.name, props: appEvents.props, platform: appEvents.platform })
    .from(appEvents)
    .where(eq(appEvents.userId, userId))
    .orderBy(appEvents.id);
}

describe('POST /v1/me/onboarding/skip', () => {
  it('ok', async () => {
    const { auth } = await atStep('photo');
    expect((await expectMe(await skip('photo', { auth }))).onboardingStep).toBe('handle');
  });

  it('photo at photo moves to handle', async () => {
    const { user, auth } = await atStep('photo');
    const me = await expectMe(await skip('photo', { auth }));
    expect(me.onboardingStep).toBe('handle');
    expect(me.onboardedAt).toBeNull();
    expect(await eventsOf(user.id)).toEqual([
      { name: 'onboarding_step', props: { step: 'photo', outcome: 'skipped' }, platform: 'ios' },
    ]);
  });

  it('location at location moves to done, sets onboarded_at and writes onboarding_done', async () => {
    const { user, auth } = await atStep('location');
    const me = await expectMe(await skip('location', { auth }));
    const now = testApp.deps.clock.now();
    expect(me.onboardingStep).toBe('done');
    expect(me.onboardedAt).toBe(now.toISOString());
    expect((await userRow(user.id)).onboardedAt).toEqual(now);
    expect(await eventsOf(user.id)).toEqual([
      { name: 'onboarding_step', props: { step: 'location', outcome: 'skipped' }, platform: 'ios' },
      { name: 'onboarding_done', props: {}, platform: 'ios' },
    ]);
  });

  it('location at photo answers onboarding_step_mismatch', async () => {
    const { user, auth } = await atStep('photo');
    await expectEnvelope(await skip('location', { auth }), 'onboarding_step_mismatch');
    expect((await userRow(user.id)).onboardingStep).toBe('photo');
    expect(await eventsOf(user.id)).toEqual([]);
  });

  it('photo at issues answers 200 unchanged', async () => {
    const { user, auth } = await atStep('issues');
    const me = await expectMe(await skip('photo', { auth }));
    expect(me.onboardingStep).toBe('issues');
    expect(await eventsOf(user.id)).toEqual([]);
  });

  it('a skip after onboarding is done changes nothing', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const me = await expectMe(await skip('location', { auth }));
    expect(me.onboardingStep).toBe('done');
    expect((await userRow(user.id)).onboardedAt).toEqual(user.onboardedAt);
  });

  it('handle answers 400', async () => {
    const { user, auth } = await atStep('handle');
    const envelope = await expectEnvelope(await skip('handle', { auth }), 'invalid_request');
    expect(envelope.error.fields).toEqual({ step: 'invalid_value' });
    expect((await userRow(user.id)).onboardingStep).toBe('handle');
  });

  it('two concurrent skips of photo leave the step at handle and write one event', async () => {
    const { user, auth } = await atStep('photo');
    const responses = await Promise.all([skip('photo', { auth }), skip('photo', { auth })]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await userRow(user.id)).onboardingStep).toBe('handle');
    expect(await eventsOf(user.id)).toHaveLength(1);
  });

  it('rejects invalid input', async () => {
    const { auth } = await atStep('photo');
    const missing = await expectEnvelope(
      await testApp.request.post(PATH, { auth, body: {} }),
      'invalid_request',
    );
    // zod reports a missing enum value as invalid_value; the field's path is what the case needs.
    expect(Object.keys(missing.error.fields)).toEqual(['step']);
    const wrongType = await expectEnvelope(await skip(1, { auth }), 'invalid_request');
    expect(wrongType.error.fields).toEqual({ step: 'invalid_value' });
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await skip('photo'), 'unauthenticated');
    const { auth } = await atStep('photo');
    await expectEnvelope(await skip('issues', { auth }), 'invalid_request');
    await expectEnvelope(await skip('location', { auth }), 'onboarding_step_mismatch');
  });

  it('requires a session', async () => {
    await expectEnvelope(await skip('photo'), 'unauthenticated');
    const user = await insertUser(testApp.deps.db, { onboardingStep: 'photo' });
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * 24 * 60 * MINUTE_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await skip('photo', { auth: expired }), 'unauthenticated');
  });

  it('checks origin on cookie writes', async () => {
    const user = await insertUser(testApp.deps.db, { onboardingStep: 'photo', handle: null });
    const cookie: TestAuth = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(await skip('photo', { auth: cookie, origin: null }), 'origin_rejected');
    expect((await userRow(user.id)).onboardingStep).toBe('photo');
    const me = await expectMe(await skip('photo', { auth: cookie }));
    expect(me.onboardingStep).toBe('handle');
    expect((await eventsOf(user.id))[0]?.platform).toBe('web');
  });

  it('suspended accounts cannot write', async () => {
    const { user, auth } = await atStep('photo', {
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await skip('photo', { auth }), 'account_suspended');
    expect((await userRow(user.id)).onboardingStep).toBe('photo');
  });

  it('rate-limited', async () => {
    const { user, auth } = await atStep('photo');
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_write:1m`,
      windowStart,
      count: ME_WRITE_LIMIT,
    });
    const response = await skip('photo', { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect((await userRow(user.id)).onboardingStep).toBe('photo');
  });
});
