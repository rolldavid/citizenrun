import { officeTypes } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, OfficeTypePageSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { asc, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-REF-02: TEST-api-REF for GET /v1/office-types.
const PATH = '/v1/office-types';
const MINUTE_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// ref.read allows 120 a minute per address, held in memory at half per replica (D-240).
const PER_REPLICA_LIMIT = 60;
const PUBLIC_FOR_AN_HOUR = 'public, max-age=3600';

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
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

async function referenceRows(): Promise<Record<string, unknown>[]> {
  return testApp.deps.db
    .select({
      id: officeTypes.id,
      name: officeTypes.name,
      level: officeTypes.level,
      illustration: officeTypes.illustration,
      electorate: officeTypes.electorate,
    })
    .from(officeTypes)
    .orderBy(asc(officeTypes.id));
}

describe('GET /v1/office-types', () => {
  it('ok', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    const body = OfficeTypePageSchema.parse(await response.json());
    const counted = await testApp.deps.db.execute<{ n: number }>(
      sql`select count(*)::int as n from office_types`,
      'objects',
    );
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items).toHaveLength(counted[0]?.n ?? -1);
    expect(body.nextCursor).toBeNull();
    const ordered = await testApp.deps.db.execute<{ id: string }>(
      sql`select id from office_types order by id`,
      'objects',
    );
    expect(body.items.map((item) => item.id)).toEqual(ordered.map((row) => row.id));
  });

  it('allows logged-out reads', async () => {
    const response = await list({ auth: null });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('the body equals the reference table', async () => {
    const raw = await (
      await list()
    ).json<{
      items: Record<string, unknown>[];
      nextCursor: null;
    }>();
    expect(raw).toEqual({ items: await referenceRows(), nextCursor: null });
    for (const item of raw.items) {
      expect(Object.keys(item).sort()).toEqual([
        'electorate',
        'id',
        'illustration',
        'level',
        'name',
      ]);
      expect(item).not.toHaveProperty('aliases');
    }
    expect(raw).not.toHaveProperty('viewer');
  });

  it('a signed-in caller gets the same body and header', async () => {
    const user = await insertUser(testApp.deps.db);
    const loggedOut = await list();
    const loggedOutBody: unknown = await loggedOut.json();
    for (const auth of [
      await signIn(testApp.deps.db, user, 'bearer'),
      await signIn(testApp.deps.db, user, 'cookie'),
    ]) {
      const response = await list({ auth });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(loggedOutBody);
      expect(response.headers.get('cache-control')).toBe(PUBLIC_FOR_AN_HOUR);
    }
  });

  it('public for an hour', async () => {
    expect((await list()).headers.get('cache-control')).toBe(PUBLIC_FOR_AN_HOUR);
  });

  it('a missing X-OS-Client answers 400', async () => {
    await expectEnvelope(await list({ client: null }), 'client_header_required');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await list({ client: null }), 'client_header_required');
    await expectEnvelope(await list({ client: 'ios/0.0.1' }), 'upgrade_required');
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.50';
    for (let n = 1; n <= PER_REPLICA_LIMIT; n += 1) {
      const allowed = await list({ ip });
      expect(allowed.status, `request ${String(n)}`).toBe(200);
    }
    const refused = await list({ ip });
    await expectEnvelope(refused, 'rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    // Another address is not limited.
    expect((await list({ ip: '203.0.113.51' })).status).toBe(200);
  });
});
