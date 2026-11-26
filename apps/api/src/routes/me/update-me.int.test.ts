import { appEvents, uploads, users } from '@citizenrun/db';
import { insertConsent, insertRateCounter, insertUpload, insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, Me } from '@citizenrun/shared';
import { avatarKeys } from '@citizenrun/shared/storage';
import { marker } from '@citizenrun/shared/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-02: TEST-api-ME for PATCH /v1/me, INV-01 and INV-23.
const PATH = '/v1/me';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.write: 30 a minute per user.
const ME_WRITE_LIMIT = 30;

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

function patchMe(body: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.patch(PATH, { body, ...options });
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

async function expectMe(response: TestResponse): Promise<Me> {
  expect(response.status).toBe(200);
  return MeSchema.parse(await response.json());
}

/** A finished user with an AI-screening answer, signed in by bearer. */
async function member(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, overrides);
  await insertConsent(testApp.deps.db, { userId: user.id, kind: 'ai_screening', granted: true });
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

async function uploadRow(id: string) {
  const [row] = await testApp.deps.db.select().from(uploads).where(eq(uploads.id, id));
  return row;
}

async function jobsFor(name: 'media.process.image' | 'uploads.cleanup', userId: string) {
  const jobs = await queuedJobs(testApp.deps.db, name);
  return jobs
    .map((job) => job.data)
    .filter(
      (data): data is Record<string, unknown> =>
        typeof data === 'object' && data !== null && Reflect.get(data, 'userId') === userId,
    );
}

async function eventsOf(userId: string) {
  return testApp.deps.db
    .select({ name: appEvents.name, props: appEvents.props, platform: appEvents.platform })
    .from(appEvents)
    .where(eq(appEvents.userId, userId));
}

function repeat(char: string, count: number): string {
  return Array.from({ length: count }, () => char).join('');
}

describe('PATCH /v1/me', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const me = await expectMe(await patchMe({ name: 'Ada Ortiz' }, { auth }));
    expect(me.id).toBe(user.id);
    expect(me.name).toBe('Ada Ortiz');
    expect((await userRow(user.id)).name).toBe('Ada Ortiz');
  });

  it('rejects invalid input', async () => {
    const { user, auth } = await member();
    const cases: [unknown, string, string][] = [
      [{ name: repeat('a', 201) }, 'name', 'too_long'],
      [{ name: 5 }, 'name', 'invalid_type'],
      [{ bio: repeat('b', 401) }, 'bio', 'too_long'],
      [{ link: repeat('l', 2049) }, 'link', 'too_long'],
      [{ avatarUploadKey: '' }, 'avatarUploadKey', 'too_short'],
      [{ avatarUploadKey: repeat('k', 201) }, 'avatarUploadKey', 'too_long'],
      [{ locale: 'fr' }, 'locale', 'invalid_value'],
    ];
    for (const [body, field, code] of cases) {
      const envelope = await expectEnvelope(await patchMe(body, { auth }), 'invalid_request');
      expect(envelope.error.fields[field], field).toBe(code);
    }
    const malformed = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'X-OS-Client': 'ios/1.4.0',
        },
        body: '{"name":',
      },
    );
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Envelope).error.code).toBe('invalid_request');
    const before = await userRow(user.id);
    expect((await patchMe({ shoeSize: 9 }, { auth })).status).toBe(200);
    expect(await userRow(user.id)).toEqual(before);
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await patchMe({ name: 'x' }), 'unauthenticated');
    const { auth } = await member();
    await expectEnvelope(await patchMe({ name: 7 }, { auth }), 'invalid_request');
    await expectEnvelope(await patchMe({ avatarUploadKey: 'nope' }, { auth }), 'upload_invalid');
  });

  it('requires a session', async () => {
    await expectEnvelope(await patchMe({ name: 'x' }), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now().getTime() - 100 * 24 * 60 * MINUTE_MS),
      expiresAt: new Date(now().getTime() - MINUTE_MS),
    });
    await expectEnvelope(await patchMe({ name: 'x' }, { auth: expired }), 'unauthenticated');
  });

  it('a body with email or role changes neither', async () => {
    const { user, auth } = await member();
    const me = await expectMe(
      await patchMe(
        { email: 'someone-else@example.test', role: 'admin', name: 'Kept Name' },
        { auth },
      ),
    );
    expect(me.email).toBe(user.email);
    expect(me.role).toBe('user');
    const row = await userRow(user.id);
    expect(row.email).toBe(user.email);
    expect(row.role).toBe('user');
    expect(row.name).toBe('Kept Name');
  });

  it('any name passing normalization is accepted', async () => {
    const { user, auth } = await member();
    const me = await expectMe(await patchMe({ name: 'Zoë Ortiz-Lee' }, { auth }));
    expect(me.name).toBe('Zoë Ortiz-Lee');
    expect((await userRow(user.id)).name).toBe('Zoë Ortiz-Lee');
  });

  it('control, zero-width, bidirectional and badge characters are removed from a name', async () => {
    const { user, auth } = await member();
    await expectMe(await patchMe({ name: 'Ann\u0007a​ Lee‮ ✔' }, { auth }));
    expect((await userRow(user.id)).name).toBe('Anna Lee');
  });

  it('a 51-code-point name answers too_long', async () => {
    const { user, auth } = await member();
    const envelope = await expectEnvelope(
      await patchMe({ name: repeat('é', 51) }, { auth }),
      'invalid_request',
    );
    expect(envelope.error.fields).toEqual({ name: 'too_long' });
    expect((await userRow(user.id)).name).toBe(user.name);
    await expectMe(await patchMe({ name: repeat('é', 50) }, { auth }));
  });

  it('a 161-code-point bio answers too_long', async () => {
    const { user, auth } = await member();
    const envelope = await expectEnvelope(
      await patchMe({ bio: repeat('🗳', 161) }, { auth }),
      'invalid_request',
    );
    expect(envelope.error.fields).toEqual({ bio: 'too_long' });
    expect((await userRow(user.id)).bio).toBeNull();
    await expectMe(await patchMe({ bio: repeat('🗳', 160) }, { auth }));
  });

  it('every failing field is reported at once', async () => {
    const { auth } = await member();
    const envelope = await expectEnvelope(
      await patchMe(
        { name: repeat('a', 51), bio: repeat('b', 161), link: 'http://x.org' },
        { auth },
      ),
      'invalid_request',
    );
    expect(envelope.error.fields).toEqual({
      name: 'too_long',
      bio: 'too_long',
      link: 'invalid_format',
    });
  });

  it('null clears name, bio and link', async () => {
    const { user, auth } = await member({
      name: 'Old Name',
      bio: 'Old bio',
      link: 'https://example.org/old',
    });
    const me = await expectMe(await patchMe({ name: null, bio: null, link: null }, { auth }));
    expect([me.name, me.bio, me.link]).toEqual([null, null, null]);
    const row = await userRow(user.id);
    expect([row.name, row.bio, row.link]).toEqual([null, null, null]);
  });

  it('an absent key is left unchanged', async () => {
    const { user, auth } = await member({ name: 'Kept', bio: 'Kept bio' });
    await expectMe(await patchMe({ link: 'https://example.org/new' }, { auth }));
    const row = await userRow(user.id);
    expect([row.name, row.bio, row.link]).toEqual(['Kept', 'Kept bio', 'https://example.org/new']);
  });

  it('an http link, a link with credentials and a 201-character link answer invalid_format', async () => {
    const { user, auth } = await member();
    const long = `https://example.org/${repeat('a', 201 - 'https://example.org/'.length)}`;
    expect(long).toHaveLength(201);
    for (const link of ['http://example.org', 'https://user:pass@example.org', long]) {
      const envelope = await expectEnvelope(await patchMe({ link }, { auth }), 'invalid_request');
      expect(envelope.error.fields).toEqual({ link: 'invalid_format' });
    }
    expect((await userRow(user.id)).link).toBeNull();
  });

  it('a valid link is stored as its url', async () => {
    const { user, auth } = await member();
    const me = await expectMe(await patchMe({ link: '  https://Example.ORG/about  ' }, { auth }));
    expect(me.link).toBe('https://example.org/about');
    expect((await userRow(user.id)).link).toBe('https://example.org/about');
  });

  it('a bio from a user with no ai_screening row answers ai_consent_required and is not stored', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    await expectEnvelope(
      await patchMe({ bio: 'Running for school board.' }, { auth }),
      'ai_consent_required',
    );
    expect((await userRow(user.id)).bio).toBeNull();
    // Clearing the bio needs no answer.
    await expectMe(await patchMe({ bio: null }, { auth }));
  });

  it('the same bio after a declined answer is stored', async () => {
    const user = await insertUser(testApp.deps.db);
    await insertConsent(testApp.deps.db, { userId: user.id, kind: 'ai_screening', granted: false });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const me = await expectMe(await patchMe({ bio: 'Running for school board.' }, { auth }));
    expect(me.bio).toBe('Running for school board.');
  });

  it('a changed bio clears bio_ai_screen_status', async () => {
    const { user, auth } = await member({ bio: 'Old bio', bioAiScreenStatus: 'ok' });
    await expectMe(await patchMe({ bio: 'Old bio' }, { auth }));
    expect((await userRow(user.id)).bioAiScreenStatus).toBe('ok');
    await expectMe(await patchMe({ bio: 'New bio' }, { auth }));
    const row = await userRow(user.id);
    expect(row.bio).toBe('New bio');
    expect(row.bioAiScreenStatus).toBeNull();
  });

  it("another user's key is refused", async () => {
    const { auth } = await member();
    const other = await insertUpload(testApp.deps.db);
    await expectEnvelope(await patchMe({ avatarUploadKey: other.key }, { auth }), 'upload_invalid');
    expect((await uploadRow(other.id))?.consumedAt).toBeNull();
  });

  it('a consumed key is refused', async () => {
    const { user, auth } = await member();
    const consumed = await insertUpload(testApp.deps.db, { userId: user.id, consumedAt: now() });
    await expectEnvelope(
      await patchMe({ avatarUploadKey: consumed.key }, { auth }),
      'upload_invalid',
    );
  });

  it('a key for another purpose is refused', async () => {
    const { user, auth } = await member();
    const post = await insertUpload(testApp.deps.db, { userId: user.id, purpose: 'post' });
    await expectEnvelope(await patchMe({ avatarUploadKey: post.key }, { auth }), 'upload_invalid');
    expect((await uploadRow(post.id))?.consumedAt).toBeNull();
    expect(await jobsFor('media.process.image', user.id)).toEqual([]);
  });

  it('an upload whose object is deleted is refused', async () => {
    const { user, auth } = await member();
    const gone = await insertUpload(testApp.deps.db, { userId: user.id, objectDeletedAt: now() });
    await expectEnvelope(await patchMe({ avatarUploadKey: gone.key }, { auth }), 'upload_invalid');
  });

  it('a valid avatar key consumes the upload, enqueues one media.process.image job, answers avatarPending true and moves photo to handle', async () => {
    const { user, auth } = await member({
      onboardingStep: 'photo',
      onboardedAt: null,
      handle: null,
    });
    const upload = await insertUpload(testApp.deps.db, { userId: user.id });
    const me = await expectMe(await patchMe({ avatarUploadKey: upload.key }, { auth }));
    expect(me.avatarPending).toBe(true);
    expect(me.avatar).toBeNull();
    expect(me.onboardingStep).toBe('handle');
    expect((await uploadRow(upload.id))?.consumedAt).toEqual(now());
    expect(await jobsFor('media.process.image', user.id)).toEqual([
      { target: 'avatar', userId: user.id, uploadId: upload.id },
    ]);
    expect(await eventsOf(user.id)).toEqual([
      { name: 'onboarding_step', props: { step: 'photo', outcome: 'completed' }, platform: 'ios' },
    ]);
    // A repeat with the same key: the upload is consumed.
    await expectEnvelope(
      await patchMe({ avatarUploadKey: upload.key }, { auth }),
      'upload_invalid',
    );
    expect(await jobsFor('media.process.image', user.id)).toHaveLength(1);
  });

  it('an avatar attached at the handle step is saved and the step stays', async () => {
    const { user, auth } = await member({
      onboardingStep: 'handle',
      onboardedAt: null,
      handle: null,
    });
    const upload = await insertUpload(testApp.deps.db, { userId: user.id });
    const me = await expectMe(await patchMe({ avatarUploadKey: upload.key }, { auth }));
    expect(me.onboardingStep).toBe('handle');
    expect(me.avatarPending).toBe(true);
    expect(await jobsFor('media.process.image', user.id)).toHaveLength(1);
    expect(await eventsOf(user.id)).toEqual([]);
  });

  it('avatarUploadKey null clears both keys and enqueues one cleanup per old key', async () => {
    const fixtureUpload = (n: number) => `0195d2c4-0000-7000-8000-${String(n).padStart(12, '0')}`;
    const both = await member();
    const shown = avatarKeys(both.user.id, fixtureUpload(1)).small;
    const pending = avatarKeys(both.user.id, fixtureUpload(2)).small;
    await testApp.deps.db
      .update(users)
      .set({ avatarKey: shown, avatarPendingKey: pending })
      .where(eq(users.id, both.user.id));
    const me = await expectMe(await patchMe({ avatarUploadKey: null }, { auth: both.auth }));
    expect(me.avatar).toBeNull();
    expect(me.avatarPending).toBe(false);
    const row = await userRow(both.user.id);
    expect([row.avatarKey, row.avatarPendingKey]).toEqual([null, null]);
    // Both jobs are sent in one transaction, so their order in the queue is not fixed.
    const cleanups = await jobsFor('uploads.cleanup', both.user.id);
    cleanups.sort((a, b) => String(a['uploadId']).localeCompare(String(b['uploadId'])));
    expect(cleanups).toEqual([
      { scope: 'avatar', userId: both.user.id, uploadId: fixtureUpload(1) },
      { scope: 'avatar', userId: both.user.id, uploadId: fixtureUpload(2) },
    ]);

    const one = await member();
    await testApp.deps.db
      .update(users)
      .set({ avatarKey: avatarKeys(one.user.id, fixtureUpload(3)).small })
      .where(eq(users.id, one.user.id));
    await expectMe(await patchMe({ avatarUploadKey: null }, { auth: one.auth }));
    expect(await jobsFor('uploads.cleanup', one.user.id)).toEqual([
      { scope: 'avatar', userId: one.user.id, uploadId: fixtureUpload(3) },
    ]);

    const none = await member();
    await expectMe(await patchMe({ avatarUploadKey: null }, { auth: none.auth }));
    expect(await jobsFor('uploads.cleanup', none.user.id)).toEqual([]);
  });

  it('a suspended user answers account_suspended', async () => {
    const { user, auth } = await member({
      status: 'suspended',
      suspendedAt: now(),
      suspendedReason: 'spam',
    });
    await expectEnvelope(await patchMe({ name: 'Changed' }, { auth }), 'account_suspended');
    expect((await userRow(user.id)).name).toBe(user.name);
    expect((await testApp.request.get(PATH, { auth })).status).toBe(200);
  });

  it('a cookie request without Origin answers origin_rejected', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await patchMe({ name: 'Changed' }, { auth: cookie, origin: null }),
      'origin_rejected',
    );
    await expectEnvelope(
      await patchMe(
        { name: 'Changed' },
        { auth: cookie, origin: 'https://elsewhere.example.test' },
      ),
      'origin_rejected',
    );
    await expectEnvelope(
      await patchMe(
        { name: 'Changed' },
        { auth: cookie, client: 'ios/1.4.0', origin: testApp.deps.env.PUBLIC_URL },
      ),
      'origin_rejected',
    );
    expect((await userRow(user.id)).name).toBe(user.name);
    expect((await patchMe({ name: 'From the web' }, { auth: cookie })).status).toBe(200);
    const bearer: TestAuth = await signIn(testApp.deps.db, user, 'bearer');
    expect((await patchMe({ name: 'From a phone' }, { auth: bearer, origin: null })).status).toBe(
      200,
    );
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await patchMe({ name: 'Nobody' }), 'unauthenticated');
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_write:1m`,
      windowStart,
      count: ME_WRITE_LIMIT,
    });
    const response = await patchMe({ name: 'Too Many' }, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect((await userRow(user.id)).name).toBe(user.name);
  });

  it('name, bio and link markers appear in no log line', async () => {
    const { user, auth } = await member();
    const value = marker();
    const me = await expectMe(
      await patchMe(
        { name: `Name ${value}`, bio: `Bio ${value}`, link: `https://example.org/${value}` },
        { auth },
      ),
    );
    expect(me.name).toBe(`Name ${value}`);
    expect((await userRow(user.id)).link).toBe(`https://example.org/${value}`);
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(value);
    }
  });
});
