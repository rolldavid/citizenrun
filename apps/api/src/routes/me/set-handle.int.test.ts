import { appEvents, reservedHandles, users } from '@citizenrun/db';
import { insertRateCounter, insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, Me } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-08: TEST-api-ME and TEST-handle-rules for PUT /v1/me/handle.
const PATH = '/v1/me/handle';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.handleSet: 10 an hour per user.
const HANDLE_SET_LIMIT = 10;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Five seconds into an hour, so no case crosses an hour window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + 5 * SECOND_MS));
});

function now(): Date {
  return testApp.deps.clock.now();
}

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

function putHandle(handle: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.put(PATH, { body: { handle }, ...options });
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

/** A user at the handle step with no handle, signed in by bearer for 200 days of fake time. */
async function atHandleStep(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, {
    handle: null,
    onboardingStep: 'handle',
    onboardedAt: null,
    ...overrides,
  });
  const auth = await signIn(testApp.deps.db, user, 'bearer', {
    authenticatedAt: now(),
    expiresAt: shift(now(), 200 * DAY_MS),
  });
  return { user, auth };
}

async function userRow(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

async function stepEvents(userId: string) {
  return testApp.deps.db
    .select({ name: appEvents.name, props: appEvents.props, platform: appEvents.platform })
    .from(appEvents)
    .where(eq(appEvents.userId, userId));
}

describe('PUT /v1/me/handle', () => {
  it('ok', async () => {
    const { auth } = await atHandleStep();
    const me = await expectMe(await putHandle('fixture_ok', { auth }));
    expect(me.handle).toBe('fixture_ok');
  });

  it('a first handle is set with handle_changed_at null and moves handle to issues', async () => {
    const { user, auth } = await atHandleStep();
    const me = await expectMe(await putHandle('@Fixture_First', { auth }));
    expect(me.handle).toBe('fixture_first');
    expect(me.onboardingStep).toBe('issues');
    expect(me.handleChangeAvailableAt).toBeNull();
    const row = await userRow(user.id);
    expect(row.handle).toBe('fixture_first');
    expect(row.handleChangedAt).toBeNull();
    expect(await stepEvents(user.id)).toEqual([
      { name: 'onboarding_step', props: { step: 'handle', outcome: 'completed' }, platform: 'ios' },
    ]);
    // A first set releases nothing.
    expect(await testApp.deps.db.select().from(reservedHandles)).toEqual([]);
  });

  it('a change right after the first set succeeds and starts the thirty days', async () => {
    const { user, auth } = await atHandleStep();
    await expectMe(await putHandle('fixture_one', { auth }));
    const me = await expectMe(await putHandle('fixture_two', { auth }));
    expect(me.handle).toBe('fixture_two');
    expect(me.handleChangeAvailableAt).toBe(shift(now(), 30 * DAY_MS).toISOString());
    expect((await userRow(user.id)).handleChangedAt).toEqual(now());
  });

  it('another change answers handle_change_too_soon until thirty days pass', async () => {
    const { user, auth } = await atHandleStep({ handle: 'fixture_start', onboardingStep: 'done' });
    const almost = shift(now(), -(30 * DAY_MS - MINUTE_MS));
    await testApp.deps.db
      .update(users)
      .set({ handleChangedAt: almost })
      .where(eq(users.id, user.id));
    await expectEnvelope(await putHandle('fixture_next', { auth }), 'handle_change_too_soon');
    expect((await userRow(user.id)).handle).toBe('fixture_start');

    await testApp.deps.db
      .update(users)
      .set({ handleChangedAt: shift(now(), -30 * DAY_MS) })
      .where(eq(users.id, user.id));
    const me = await expectMe(await putHandle('fixture_next', { auth }));
    expect(me.handle).toBe('fixture_next');
  });

  it('the old handle is held ninety days for every user, the changer included', async () => {
    const changer = await atHandleStep({ handle: 'fixture_old', onboardingStep: 'done' });
    const other = await atHandleStep();
    await expectMe(await putHandle('fixture_new', { auth: changer.auth }));

    const [held] = await testApp.deps.db.select().from(reservedHandles);
    expect(held?.reason).toBe('released');
    expect(held?.handleHash).not.toContain('fixture_old');
    expect(held?.reservedUntil).toEqual(shift(now(), 90 * DAY_MS));

    await expectEnvelope(await putHandle('fixture_old', { auth: other.auth }), 'handle_reserved');
    await expectEnvelope(await putHandle('fixture_old', { auth: changer.auth }), 'handle_reserved');

    testApp.deps.clock.advance(90 * DAY_MS - SECOND_MS);
    await expectEnvelope(await putHandle('fixture_old', { auth: other.auth }), 'handle_reserved');
    testApp.deps.clock.advance(SECOND_MS);
    const me = await expectMe(await putHandle('fixture_old', { auth: other.auth }));
    expect(me.handle).toBe('fixture_old');
  });

  it('two users racing for one handle get one 200 and one handle_taken with no Postgres text in the log', async () => {
    const first = await atHandleStep();
    const second = await atHandleStep();
    const responses = await Promise.all([
      putHandle('fixture_race', { auth: first.auth }),
      putHandle('fixture_race', { auth: second.auth }),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = responses.find((response) => response.status === 409);
    if (loser === undefined) {
      throw new Error('No request lost the race.');
    }
    const envelope = await expectEnvelope(loser, 'handle_taken');
    expect(envelope.error.fields).toEqual({});
    const texts = [JSON.stringify(envelope), ...testApp.logs.map((line) => line.raw)];
    for (const text of texts) {
      expect(text).not.toMatch(/duplicate key|violates|users_handle_key|23505/);
      expect(text).not.toContain('fixture_race');
    }
    const handles = [(await userRow(first.user.id)).handle, (await userRow(second.user.id)).handle];
    expect(handles.filter((handle) => handle === 'fixture_race')).toHaveLength(1);
  });

  it('a reserved word answers handle_reserved', async () => {
    const { user, auth } = await atHandleStep();
    for (const word of ['admin', 'Settings', 'admin1']) {
      await expectEnvelope(await putHandle(word, { auth }), 'handle_reserved');
    }
    expect((await userRow(user.id)).handle).toBeNull();
  });

  it('the rules map to their field codes', async () => {
    const { auth } = await atHandleStep();
    const cases: [string, string][] = [
      ['ab', 'too_short'],
      ['a'.repeat(21), 'too_long'],
      ['a-b', 'invalid_format'],
      ['.abc', 'invalid_format'],
      ['a..bc', 'invalid_format'],
      ['___', 'invalid_format'],
    ];
    for (const [handle, code] of cases) {
      const envelope = await expectEnvelope(await putHandle(handle, { auth }), 'invalid_request');
      expect(envelope.error.fields, handle).toEqual({ handle: code });
    }
  });

  it('the same handle again answers 200 with no change and still advances from handle', async () => {
    const changedAt = shift(now(), -5 * DAY_MS);
    const { user, auth } = await atHandleStep({
      handle: 'fixture_same',
      handleChangedAt: changedAt,
    });
    const me = await expectMe(await putHandle('Fixture_Same', { auth }));
    expect(me.handle).toBe('fixture_same');
    expect(me.onboardingStep).toBe('issues');
    expect((await userRow(user.id)).handleChangedAt).toEqual(changedAt);
    expect(await testApp.deps.db.select().from(reservedHandles)).toEqual([]);
  });

  it('a suspended user answers account_suspended', async () => {
    const { user, auth } = await atHandleStep({
      status: 'suspended',
      suspendedAt: now(),
      suspendedReason: 'spam',
    });
    await expectEnvelope(await putHandle('fixture_blocked', { auth }), 'account_suspended');
    expect((await userRow(user.id)).handle).toBeNull();
  });

  it('repeat is safe', async () => {
    const { user, auth } = await atHandleStep();
    const first = await expectMe(await putHandle('fixture_again', { auth }));
    const second = await expectMe(await putHandle('fixture_again', { auth }));
    expect(second.handle).toBe(first.handle);
    expect(second.onboardingStep).toBe('issues');
    expect((await userRow(user.id)).handleChangedAt).toBeNull();
    expect(await stepEvents(user.id)).toHaveLength(1);
  });

  it('rejects invalid input', async () => {
    const { auth } = await atHandleStep();
    const tooLong = await expectEnvelope(
      await putHandle('a'.repeat(41), { auth }),
      'invalid_request',
    );
    expect(tooLong.error.fields).toEqual({ handle: 'too_long' });
    const wrongType = await expectEnvelope(await putHandle(42, { auth }), 'invalid_request');
    expect(wrongType.error.fields).toEqual({ handle: 'invalid_type' });
    const missing = await expectEnvelope(
      await testApp.request.put(PATH, { auth, body: {} }),
      'invalid_request',
    );
    expect(missing.error.fields).toEqual({ handle: 'required' });
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await putHandle('fixture_x'), 'unauthenticated');
    const { auth } = await atHandleStep();
    await expectEnvelope(await putHandle('admin', { auth }), 'handle_reserved');
    await expectEnvelope(await putHandle('ab', { auth }), 'invalid_request');
  });

  it('requires a session', async () => {
    await expectEnvelope(await putHandle('fixture_x'), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: shift(now(), -100 * DAY_MS),
      expiresAt: shift(now(), -MINUTE_MS),
    });
    await expectEnvelope(await putHandle('fixture_x', { auth: expired }), 'unauthenticated');
  });

  it('checks origin on cookie writes', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null, onboardingStep: 'handle' });
    const cookie: TestAuth = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await putHandle('fixture_web', { auth: cookie, origin: null }),
      'origin_rejected',
    );
    await expectEnvelope(
      await putHandle('fixture_web', { auth: cookie, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    expect((await userRow(user.id)).handle).toBeNull();
    expect((await putHandle('fixture_web', { auth: cookie })).status).toBe(200);
  });

  it('rate-limited', async () => {
    const { user, auth } = await atHandleStep();
    const windowStart = new Date(Math.floor(now().getTime() / HOUR_MS) * HOUR_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:handle_set:1h`,
      windowStart,
      count: HANDLE_SET_LIMIT,
    });
    const response = await putHandle('fixture_limited', { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + HOUR_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect((await userRow(user.id)).handle).toBeNull();
  });
});
