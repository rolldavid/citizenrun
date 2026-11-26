import { appEvents, issues, userIssues, users } from '@citizenrun/db';
import { insertRateCounter, insertUser, setUserIssues } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, Me } from '@citizenrun/shared';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-09: TEST-api-ME and TEST-onboarding for PUT /v1/me/issues.
const PATH = '/v1/me/issues';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.write: 30 a minute per user.
const ME_WRITE_LIMIT = 30;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };
type Pick = { issueId: string; starred: boolean };

let testApp: TestApp;
// Every issue id, in issue order.
let issueIds: string[];

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
  const rows = await testApp.deps.db
    .select({ id: issues.id })
    .from(issues)
    .orderBy(asc(issues.sort));
  issueIds = rows.map((row) => row.id);
});

function picks(count: number, starred = 0): Pick[] {
  if (count > issueIds.length) {
    throw new Error('Not enough issues.');
  }
  return issueIds.slice(0, count).map((issueId, index) => ({ issueId, starred: index < starred }));
}

function putIssues(body: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.put(PATH, { body, ...options });
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

async function atIssuesStep(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, {
    onboardingStep: 'issues',
    onboardedAt: null,
    ...overrides,
  });
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function storedPicks(userId: string): Promise<Pick[]> {
  const rows = await testApp.deps.db
    .select({ issueId: userIssues.issueId, starred: userIssues.starred })
    .from(userIssues)
    .innerJoin(issues, eq(issues.id, userIssues.issueId))
    .where(eq(userIssues.userId, userId))
    .orderBy(asc(issues.sort));
  return rows;
}

async function stepOf(userId: string): Promise<string | undefined> {
  const [row] = await testApp.deps.db
    .select({ step: users.onboardingStep })
    .from(users)
    .where(eq(users.id, userId));
  return row?.step;
}

describe('PUT /v1/me/issues', () => {
  it('ok', async () => {
    const { auth } = await atIssuesStep();
    const me = await expectMe(await putIssues({ issues: picks(3, 1) }, { auth }));
    expect(me.issues).toEqual(picks(3, 1));
  });

  it('3 and 10 issues succeed', async () => {
    const { user, auth } = await atIssuesStep();
    await expectMe(await putIssues({ issues: picks(3) }, { auth }));
    expect(await storedPicks(user.id)).toEqual(picks(3));
    const me = await expectMe(await putIssues({ issues: picks(10, 3) }, { auth }));
    expect(me.issues).toEqual(picks(10, 3));
    expect(await storedPicks(user.id)).toEqual(picks(10, 3));
  });

  it('2 and 11 issues answer too_few and too_many', async () => {
    const { user, auth } = await atIssuesStep();
    const few = await expectEnvelope(
      await putIssues({ issues: picks(2) }, { auth }),
      'invalid_request',
    );
    expect(few.error.fields).toEqual({ issues: 'too_few' });
    const many = await expectEnvelope(
      await putIssues({ issues: picks(11) }, { auth }),
      'invalid_request',
    );
    expect(many.error.fields).toEqual({ issues: 'too_many' });
    expect(await storedPicks(user.id)).toEqual([]);
  });

  it('4 stars answer too_many on issues', async () => {
    const { auth } = await atIssuesStep();
    const envelope = await expectEnvelope(
      await putIssues({ issues: picks(5, 4) }, { auth }),
      'invalid_request',
    );
    expect(envelope.error.fields).toEqual({ issues: 'too_many' });
  });

  it('a duplicate answers invalid_value on issues', async () => {
    const { auth } = await atIssuesStep();
    const [first, second] = picks(2);
    const envelope = await expectEnvelope(
      await putIssues({ issues: [first, second, first] }, { auth }),
      'invalid_request',
    );
    expect(envelope.error.fields).toEqual({ issues: 'invalid_value' });
  });

  it('an unknown id answers unknown_issue with its index', async () => {
    const { user, auth } = await atIssuesStep();
    const [first, second] = picks(2);
    const envelope = await expectEnvelope(
      await putIssues(
        { issues: [first, { issueId: 'no-such-issue', starred: false }, second] },
        { auth },
      ),
      'unknown_issue',
    );
    expect(envelope.error.fields).toEqual({ 'issues.1.issueId': 'invalid_value' });
    expect(await storedPicks(user.id)).toEqual([]);
    expect(await stepOf(user.id)).toBe('issues');
  });

  it('a second call replaces the first set exactly', async () => {
    const { user, auth } = await atIssuesStep();
    await setUserIssues(testApp.deps.db, user.id, picks(5, 2));
    const replacement = issueIds.slice(5, 8).map((issueId) => ({ issueId, starred: true }));
    const me = await expectMe(await putIssues({ issues: replacement }, { auth }));
    expect(me.issues).toEqual(replacement);
    expect(await storedPicks(user.id)).toEqual(replacement);
  });

  it('the step moves from issues to location', async () => {
    const { user, auth } = await atIssuesStep();
    const me = await expectMe(await putIssues({ issues: picks(3) }, { auth }));
    expect(me.onboardingStep).toBe('location');
    const events = await testApp.deps.db
      .select({ name: appEvents.name, props: appEvents.props, platform: appEvents.platform })
      .from(appEvents)
      .where(eq(appEvents.userId, user.id));
    expect(events).toEqual([
      { name: 'onboarding_step', props: { step: 'issues', outcome: 'completed' }, platform: 'ios' },
    ]);
  });

  it('a finished user replaces the picks and stays done', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const me = await expectMe(await putIssues({ issues: picks(4) }, { auth }));
    expect(me.onboardingStep).toBe('done');
    expect(me.issues).toEqual(picks(4));
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await putIssues({ issues: picks(3) }), 'unauthenticated');
  });

  it('repeat is safe', async () => {
    const { user, auth } = await atIssuesStep();
    const first = await expectMe(await putIssues({ issues: picks(3, 1) }, { auth }));
    const second = await expectMe(await putIssues({ issues: picks(3, 1) }, { auth }));
    expect(second.issues).toEqual(first.issues);
    expect(await storedPicks(user.id)).toEqual(picks(3, 1));
    expect(second.onboardingStep).toBe('location');
  });

  it('rejects invalid input', async () => {
    const { auth } = await atIssuesStep();
    const missing = await expectEnvelope(await putIssues({}, { auth }), 'invalid_request');
    expect(missing.error.fields).toEqual({ issues: 'required' });
    const badId = await expectEnvelope(
      await putIssues(
        { issues: [...picks(2), { issueId: 'Not An Id', starred: false }] },
        { auth },
      ),
      'invalid_request',
    );
    expect(badId.error.fields).toEqual({ 'issues.2.issueId': 'invalid_format' });
    const longId = await expectEnvelope(
      await putIssues(
        { issues: [...picks(2), { issueId: 'a'.repeat(65), starred: false }] },
        { auth },
      ),
      'invalid_request',
    );
    expect(longId.error.fields).toEqual({ 'issues.2.issueId': 'too_long' });
    const noStar = await expectEnvelope(
      await putIssues({ issues: [...picks(2), { issueId: issueIds[5] }] }, { auth }),
      'invalid_request',
    );
    expect(noStar.error.fields).toEqual({ 'issues.2.starred': 'required' });
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await putIssues({ issues: picks(3) }), 'unauthenticated');
    const { auth } = await atIssuesStep();
    await expectEnvelope(await putIssues({ issues: picks(1) }, { auth }), 'invalid_request');
    await expectEnvelope(
      await putIssues({ issues: [...picks(2), { issueId: 'nope', starred: false }] }, { auth }),
      'unknown_issue',
    );
  });

  it('requires a session', async () => {
    await expectEnvelope(await putIssues({ issues: picks(3) }), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * 24 * 60 * MINUTE_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(
      await putIssues({ issues: picks(3) }, { auth: expired }),
      'unauthenticated',
    );
  });

  it('checks origin on cookie writes', async () => {
    const user = await insertUser(testApp.deps.db, { onboardingStep: 'issues', onboardedAt: null });
    const cookie: TestAuth = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await putIssues({ issues: picks(3) }, { auth: cookie, origin: null }),
      'origin_rejected',
    );
    expect(await storedPicks(user.id)).toEqual([]);
    expect((await putIssues({ issues: picks(3) }, { auth: cookie })).status).toBe(200);
  });

  it('suspended accounts cannot write', async () => {
    const { user, auth } = await atIssuesStep({
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await putIssues({ issues: picks(3) }, { auth }), 'account_suspended');
    expect(await storedPicks(user.id)).toEqual([]);
  });

  it('rate-limited', async () => {
    const { user, auth } = await atIssuesStep();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_write:1m`,
      windowStart,
      count: ME_WRITE_LIMIT,
    });
    const response = await putIssues({ issues: picks(3) }, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it('issue picks appear in no log line', async () => {
    const { auth } = await atIssuesStep();
    const chosen = picks(3);
    await expectMe(await putIssues({ issues: chosen }, { auth }));
    for (const line of testApp.logs) {
      for (const pick of chosen) {
        expect(line.raw).not.toContain(`"${pick.issueId}"`);
      }
    }
  });
});
