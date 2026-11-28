import { reservedHandles, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ApiError, ERROR_CODES, RESERVED_HANDLE_WORDS } from '@citizenrun/shared';
import type { HandleError } from '@citizenrun/shared';
import { keyedHash, loadKeyRing } from '@citizenrun/shared/crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertReservedHandle } from '../../testing/factories.ts';
import {
  checkHandleAvailability,
  handleErrorToApiError,
  normalizeHandleInput,
  setHandle,
} from './handles.ts';

// TEST-handle-rules, the route half (L-handle-service).
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// A second fixture secret, for a ring whose previous key is the test environment's.
const ROTATED_SECRET = 'fedcba9876543210'.repeat(4);

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

function now(): Date {
  return testApp.deps.clock.now();
}

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

async function handleOf(userId: string): Promise<string | null | undefined> {
  const [row] = await testApp.deps.db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId));
  return row?.handle;
}

function set(userId: string, raw: string, at: Date = now()): Promise<void> {
  return setHandle(
    testApp.deps.db,
    { userId, raw, now: at, platform: 'ios' },
    testApp.deps.keyRing,
  );
}

function check(userId: string, raw: string, at: Date = now()) {
  return checkHandleAvailability(testApp.deps.db, { userId, raw, now: at }, testApp.deps.keyRing);
}

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) {
    throw new Error('Expected an ApiError.');
  }
  expect(error.code).toBe(code);
  return error;
}

describe('L-handle-service', () => {
  it('upper case is lowered', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null, onboardingStep: 'handle' });
    expect(await check(user.id, 'Seed_User')).toEqual({
      handle: 'seed_user',
      available: true,
      reason: null,
    });
    await set(user.id, 'Seed_User');
    expect(await handleOf(user.id)).toBe('seed_user');
  });

  it('every reserved word is refused', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null });
    for (const word of RESERVED_HANDLE_WORDS) {
      // Every reserved word is ASCII, so its length is its count of code points.
      const length = word.length;
      const result = await check(user.id, word);
      expect(result.available, word).toBe(false);
      expect(result.reason, word).toBe(length >= 3 && length <= 20 ? 'reserved' : 'invalid');
    }
  });

  it('reserved words answer handle_reserved on the route', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null, onboardingStep: 'handle' });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    for (const word of ['admin', 'settings', 'admin1']) {
      const response = await testApp.request.put('/v1/me/handle', { auth, body: { handle: word } });
      expect(response.status, word).toBe(409);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe(
        'handle_reserved',
      );
    }
    expect(await handleOf(user.id)).toBeNull();
  });

  it('once every 30 days', async () => {
    const user = await insertUser(testApp.deps.db, { handle: 'fixture_a' });
    await set(user.id, 'fixture_b');
    const changedAt = now();
    await expectApiError(
      set(user.id, 'fixture_c', shift(changedAt, 30 * DAY_MS - MINUTE_MS)),
      'handle_change_too_soon',
    );
    expect(await handleOf(user.id)).toBe('fixture_b');
    await set(user.id, 'fixture_c', shift(changedAt, 30 * DAY_MS));
    expect(await handleOf(user.id)).toBe('fixture_c');
  });

  it('released handles are held 90 days', async () => {
    const changer = await insertUser(testApp.deps.db, { handle: 'fixture_held' });
    const other = await insertUser(testApp.deps.db, { handle: null });
    await set(changer.id, 'fixture_moved');
    const rows = await testApp.deps.db.select().from(reservedHandles);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.handleHash).not.toBe('fixture_held');
    expect(row?.handleHash).not.toContain('fixture_held');
    expect(row?.handleHash).toBe(
      keyedHash(testApp.deps.keyRing, { kind: 'handle', handle: 'fixture_held' }),
    );
    expect(row?.reason).toBe('released');
    expect(row?.reservedUntil).toEqual(shift(now(), 90 * DAY_MS));

    await expectApiError(set(other.id, 'Fixture_Held'), 'handle_reserved');
    expect((await check(other.id, 'fixture_held')).reason).toBe('reserved');
    await expectApiError(
      set(other.id, 'fixture_held', shift(now(), 90 * DAY_MS - MINUTE_MS)),
      'handle_reserved',
    );
    await set(other.id, 'fixture_held', shift(now(), 90 * DAY_MS));
    expect(await handleOf(other.id)).toBe('fixture_held');
  });

  it('a second release keeps the later hold', async () => {
    const first = await insertUser(testApp.deps.db, { handle: 'fixture_twice' });
    await insertReservedHandle(testApp.deps.db, testApp.deps.keyRing, {
      handle: 'fixture_twice',
      reason: 'deleted',
      reservedUntil: shift(now(), 200 * DAY_MS),
    });
    await set(first.id, 'fixture_other');
    const [row] = await testApp.deps.db.select().from(reservedHandles);
    expect(row?.reservedUntil).toEqual(shift(now(), 200 * DAY_MS));
  });

  it('a hold made under the previous key still refuses after a rotation', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null });
    await insertReservedHandle(testApp.deps.db, testApp.deps.keyRing, {
      handle: 'fixture_rotated',
      reason: 'released',
      reservedUntil: shift(now(), 10 * DAY_MS),
    });
    const rotated = loadKeyRing(ROTATED_SECRET, testApp.deps.env.APP_SECRET);
    expect(
      await checkHandleAvailability(
        testApp.deps.db,
        { userId: user.id, raw: 'fixture_rotated', now: now() },
        rotated,
      ),
    ).toEqual({ handle: 'fixture_rotated', available: false, reason: 'reserved' });
    await expectApiError(
      setHandle(
        testApp.deps.db,
        { userId: user.id, raw: 'fixture_rotated', now: now(), platform: 'ios' },
        rotated,
      ),
      'handle_reserved',
    );
  });

  it('deleted accounts release their handle after 90 days', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null });
    const until = shift(now(), 90 * DAY_MS);
    await insertReservedHandle(testApp.deps.db, testApp.deps.keyRing, {
      handle: 'fixture_gone',
      reason: 'deleted',
      reservedUntil: until,
    });
    await expectApiError(set(user.id, 'fixture_gone'), 'handle_reserved');
    expect((await check(user.id, 'fixture_gone', shift(until, MINUTE_MS))).available).toBe(true);
    await set(user.id, 'fixture_gone', shift(until, MINUTE_MS));
    expect(await handleOf(user.id)).toBe('fixture_gone');
  });

  it('taken handles', async () => {
    const first = await insertUser(testApp.deps.db, { handle: null });
    const second = await insertUser(testApp.deps.db, { handle: null });
    const results = await Promise.allSettled([
      set(first.id, 'fixture_taken'),
      set(second.id, 'fixture_taken'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason: unknown = rejected[0]?.reason;
    expect(reason).toBeInstanceOf(ApiError);
    expect(reason instanceof ApiError ? reason.code : null).toBe('handle_taken');
    expect(reason instanceof Error ? reason.message : '').not.toMatch(/duplicate|violates/);
    for (const line of testApp.logs) {
      expect(line.raw).not.toMatch(/duplicate key|violates|users_handle_key/);
    }
  });

  it('live check', async () => {
    const user = await insertUser(testApp.deps.db, { handle: null });
    await insertUser(testApp.deps.db, { handle: 'fixture_live' });
    expect(await check(user.id, 'fixture_free')).toEqual({
      handle: 'fixture_free',
      available: true,
      reason: null,
    });
    expect(await check(user.id, 'fixture_live')).toEqual({
      handle: 'fixture_live',
      available: false,
      reason: 'taken',
    });
    expect(await check(user.id, 'support')).toEqual({
      handle: 'support',
      available: false,
      reason: 'reserved',
    });
    expect(await check(user.id, ' @A-B ')).toEqual({
      handle: 'a-b',
      available: false,
      reason: 'invalid',
    });
  });

  it('names are normalised', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const patch = (name: string) => testApp.request.patch('/v1/me', { auth, body: { name } });
    // NFKC folds the ligature; the zero-width, bidirectional, control, private-use, variation
    // selector and badge characters are removed.
    const response = await patch('ﬁne​ Name‮\u0007️ ✅');
    expect(response.status).toBe(200);
    const [row] = await testApp.deps.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.name).toBe('fine Name');
    const long = await patch('n'.repeat(60));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ error: { fields: { name: 'too_long' } } });
  });

  it('error mapping', () => {
    const expected: Record<HandleError, { code: string; fields: Record<string, string> }> = {
      reserved: { code: 'handle_reserved', fields: {} },
      too_short: { code: 'invalid_request', fields: { handle: 'too_short' } },
      too_long: { code: 'invalid_request', fields: { handle: 'too_long' } },
      invalid_characters: { code: 'invalid_request', fields: { handle: 'invalid_format' } },
      edge_dot: { code: 'invalid_request', fields: { handle: 'invalid_format' } },
      double_dot: { code: 'invalid_request', fields: { handle: 'invalid_format' } },
      no_letter_or_digit: { code: 'invalid_request', fields: { handle: 'invalid_format' } },
    };
    const rows = Object.entries(expected) as [HandleError, (typeof expected)[HandleError]][]; // the keys are the record's own HandleError keys
    for (const [handleError, answer] of rows) {
      const error = handleErrorToApiError(handleError);
      expect(error.code, handleError).toBe(answer.code);
      expect(error.status, handleError).toBe(answer.code === 'handle_reserved' ? 409 : 400);
      expect(error.fields, handleError).toEqual(answer.fields);
    }
    expect(ERROR_CODES.handle_reserved.status).toBe(409);
  });

  it('normalizeHandleInput trims, drops one @ and lowers', () => {
    expect(normalizeHandleInput('  @@Ab.C ')).toBe('@ab.c');
    expect(normalizeHandleInput('Ab_C')).toBe('ab_c');
  });
});
