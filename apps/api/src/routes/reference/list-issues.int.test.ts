import { issues } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, IssuePageSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-REF-01: TEST-api-REF for GET /v1/issues.
const PATH = '/v1/issues';
const MINUTE_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// ref.read allows 120 a minute per address, held in memory at half per replica (D-240).
const PER_REPLICA_LIMIT = 60;
const ISSUE_COUNT = 19;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Early in a minute, so a burst of requests shares one window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS + 5_000));
});

function list(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(PATH, options);
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

async function referenceRows(): Promise<
  { id: string; name: string; icon: string; sort: number }[]
> {
  return testApp.deps.db
    .select({ id: issues.id, name: issues.name, icon: issues.icon, sort: issues.sort })
    .from(issues)
    .orderBy(asc(issues.sort));
}

describe('GET /v1/issues', () => {
  it('logged out answers the 19 issues in sort order with nextCursor null', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    const body = IssuePageSchema.parse(await response.json());
    expect(body.items).toHaveLength(ISSUE_COUNT);
    expect(body.nextCursor).toBeNull();
    const sorts = body.items.map((item) => item.sort);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
  });

  it('a signed-in caller gets the same body', async () => {
    const user = await insertUser(testApp.deps.db);
    const bearer = await signIn(testApp.deps.db, user, 'bearer');
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    const loggedOut: unknown = await (await list()).json();
    const withBearer = await list({ auth: bearer });
    const withCookie = await list({ auth: cookie });
    expect(withBearer.status).toBe(200);
    expect(withCookie.status).toBe(200);
    expect(await withBearer.json()).toEqual(loggedOut);
    expect(await withCookie.json()).toEqual(loggedOut);
  });

  it('the bodies equal the reference table', async () => {
    const response = await list();
    const raw = await response.json<{ items: Record<string, unknown>[]; nextCursor: null }>();
    expect(raw).toEqual({ items: await referenceRows(), nextCursor: null });
    for (const item of raw.items) {
      expect(Object.keys(item).sort()).toEqual(['icon', 'id', 'name', 'sort']);
      expect(item).not.toHaveProperty('color_light');
      expect(item).not.toHaveProperty('color_dark');
      expect(item).not.toHaveProperty('colorLight');
      expect(item).not.toHaveProperty('colorDark');
    }
    expect(raw).not.toHaveProperty('viewer');
  });

  it('the response is cached for an hour', async () => {
    expect((await list()).headers.get('cache-control')).toBe('public, max-age=3600');
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    expect((await list({ auth })).headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('a missing X-OS-Client answers client_header_required', async () => {
    const response = await list({ client: null });
    await expectEnvelope(response, 'client_header_required');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('allows logged-out reads', async () => {
    const response = await list({ auth: null });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('an invalid session answers as logged out', async () => {
    const response = await list({ auth: { kind: 'cookie', token: 'A'.repeat(43) } });
    expect(response.status).toBe(200);
    expect(IssuePageSchema.parse(await response.json()).items).toHaveLength(ISSUE_COUNT);
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await list({ client: null }), 'client_header_required');
    await expectEnvelope(await list({ client: 'ios/0.0.1' }), 'upgrade_required');
    const ip = '203.0.113.41';
    let refused: TestResponse | null = null;
    for (let n = 0; n <= PER_REPLICA_LIMIT; n += 1) {
      refused = await list({ ip });
    }
    if (refused === null) {
      throw new Error('No request was sent.');
    }
    const envelope = await expectEnvelope(refused, 'rate_limited');
    expect(envelope.error.fields).toEqual({});
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.40';
    for (let n = 1; n <= PER_REPLICA_LIMIT; n += 1) {
      const allowed = await list({ ip });
      expect(allowed.status, `request ${String(n)}`).toBe(200);
    }
    const refused = await list({ ip });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(refused.headers.get('cache-control')).toBe('no-store');
    // Another address is not limited.
    expect((await list({ ip: '203.0.113.42' })).status).toBe(200);
  });
});
