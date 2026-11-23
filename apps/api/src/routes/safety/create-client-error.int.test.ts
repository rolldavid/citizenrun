import { clientErrors } from '@citizenrun/db';
import { getTestDb } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, newId } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

const PATH = '/v1/client-errors';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BODY_LIMIT_BYTES = 4096;
const OVERSIZED_BYTES = 5000;
// clientErrors allows 20 a minute per address, held in memory at half per replica (D-240).
const PER_REPLICA_LIMIT = 10;
// The one address of the rate-limit case; no other case of this file uses it.
const RATE_LIMIT_IP = '203.0.113.200';

// Every request outside the rate-limit case comes from its own address, so no case nears the
// per-replica limit whatever order the cases run in.
let nextHost = 100;
function freshIp(): string {
  const ip = `203.0.113.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

function validReport(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: '/office/[slug]',
    component: 'OfficeScreen',
    appVersion: '1.4.0',
    platform: 'ios',
    frames: [{ file: 'src/features/office/office-screen.tsx', line: 42, column: 7 }],
    requestId: newId(),
  };
}

function post(testApp: TestApp, body: unknown, options: TestRequestOptions = {}) {
  return testApp.request.post(PATH, { ip: freshIp(), ...options, body });
}

// A request whose body text is sent as given (malformed or oversized JSON).
async function postRaw(
  testApp: TestApp,
  text: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return testApp.app.request(new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OS-Client': 'ios/1.4.0',
      'x-real-ip': freshIp(),
      ...headers,
    },
    body: text,
  });
}

/** Asserts the exact envelope of `code` with an `X-Request-Id`, and returns its `fields`. */
async function expectEnvelope(
  response: TestResponse | Response,
  code: ErrorCode,
): Promise<Record<string, string>> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body: unknown = JSON.parse(await response.text());
  expect(body).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
  return ErrorEnvelopeSchema.parse(body).error.fields;
}

async function storedRows() {
  return getTestDb().select().from(clientErrors);
}

async function storedText(): Promise<string> {
  const rows = await getTestDb().execute<{ text: string }>(
    sql`select coalesce(string_agg(t::text, ''), '') as text from client_errors t`,
    'objects',
  );
  return rows[0]?.text ?? '';
}

describe('POST /v1/client-errors', () => {
  it('ok', async () => {
    const testApp = await createTestApp();
    const report = validReport();
    const response = await post(testApp, report);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'TypeError',
      code: 'render.failed',
      route: '/office/[slug]',
      component: 'OfficeScreen',
      appVersion: '1.4.0',
      platform: 'ios',
      frames: [{ file: 'src/features/office/office-screen.tsx', line: 42, column: 7 }],
      requestId: report['requestId'],
    });
    expect(rows[0]?.id).toMatch(UUID_PATTERN);
    const columns = await getTestDb().execute<{ name: string }>(
      sql`select column_name as name from information_schema.columns
          where table_schema = 'public' and table_name = 'client_errors' order by column_name`,
      'objects',
    );
    expect(columns.map((column) => column.name)).toEqual([
      'app_version',
      'code',
      'component',
      'created_at',
      'frames',
      'id',
      'name',
      'platform',
      'request_id',
      'route',
    ]);
  });

  it('logged out works', async () => {
    const testApp = await createTestApp();
    const response = await post(
      testApp,
      { ...validReport(), route: null, component: null },
      {
        auth: null,
      },
    );
    expect(response.status).toBe(204);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: null, component: null });
  });

  it('rejects invalid input', async () => {
    const testApp = await createTestApp();
    const frame = { file: 'src/app.ts', line: 1, column: 1 };
    const withoutName = validReport();
    delete withoutName['name'];
    const cases: readonly { field: string; body: unknown }[] = [
      { field: 'name', body: withoutName },
      { field: 'name', body: { ...validReport(), name: 'Type Error' } },
      { field: 'name', body: { ...validReport(), name: 'A'.repeat(101) } },
      { field: 'name', body: { ...validReport(), name: '' } },
      { field: 'name', body: { ...validReport(), name: 42 } },
      { field: 'code', body: { ...validReport(), code: 'Render.failed' } },
      { field: 'code', body: { ...validReport(), code: `a${'b'.repeat(64)}` } },
      { field: 'route', body: { ...validReport(), route: '/search?q=fixture' } },
      { field: 'route', body: { ...validReport(), route: 'office/[slug]' } },
      { field: 'route', body: { ...validReport(), route: `/${'a'.repeat(200)}` } },
      { field: 'component', body: { ...validReport(), component: 'Office Screen' } },
      { field: 'appVersion', body: { ...validReport(), appVersion: '1.0' } },
      { field: 'platform', body: { ...validReport(), platform: 'desktop' } },
      {
        field: 'frames',
        body: { ...validReport(), frames: Array.from({ length: 21 }, () => frame) },
      },
      { field: 'frames.0.line', body: { ...validReport(), frames: [{ ...frame, line: -1 }] } },
      {
        field: 'frames.0.line',
        body: { ...validReport(), frames: [{ ...frame, line: 10_000_001 }] },
      },
      {
        field: 'frames.0.file',
        body: { ...validReport(), frames: [{ ...frame, file: 'a b.ts' }] },
      },
      { field: 'requestId', body: { ...validReport(), requestId: 'abc' } },
    ];
    for (const { field, body } of cases) {
      const response = await post(testApp, body);
      const fields = await expectEnvelope(response, 'invalid_request');
      expect(Object.keys(fields)).toContain(field);
    }
    const malformed = await postRaw(testApp, '{"name": "TypeError",');
    await expectEnvelope(malformed, 'invalid_request');
    expect(await storedRows()).toHaveLength(0);
  });

  it('an unknown key is dropped and not stored', async () => {
    const testApp = await createTestApp();
    const response = await post(testApp, {
      ...validReport(),
      message: marker(),
      stack: marker(),
    });
    expect(response.status).toBe(204);
    expect(await storedRows()).toHaveLength(1);
    const text = await storedText();
    expect(text).not.toContain(marker());
    expect(text).not.toContain('message');
    expect(text).not.toContain('stack');
  });

  it('a 5 KB body answers 413', async () => {
    const testApp = await createTestApp();
    const base = JSON.stringify(validReport());
    const padded = JSON.stringify({
      ...validReport(),
      pad: 'x'.repeat(OVERSIZED_BYTES - base.length - ',"pad":""'.length),
    });
    expect(Buffer.byteLength(padded)).toBe(OVERSIZED_BYTES);
    expect(OVERSIZED_BYTES).toBeGreaterThan(BODY_LIMIT_BYTES);
    const declared = await postRaw(testApp, padded, { 'Content-Length': String(OVERSIZED_BYTES) });
    await expectEnvelope(declared, 'payload_too_large');
    const streamed = await postRaw(testApp, padded);
    await expectEnvelope(streamed, 'payload_too_large');
    expect(await storedRows()).toHaveLength(0);
  });

  it('rate-limited', async () => {
    const testApp = await createTestApp();
    testApp.deps.clock.set('2026-11-23T12:00:15.000Z');
    for (let index = 0; index < PER_REPLICA_LIMIT; index += 1) {
      const allowed = await post(testApp, validReport(), { ip: RATE_LIMIT_IP });
      expect(allowed.status).toBe(204);
    }
    const refused = await post(testApp, validReport(), { ip: RATE_LIMIT_IP });
    await expectEnvelope(refused, 'rate_limited');
    expect(refused.headers.get('retry-after')).toBe('45');
    expect(await storedRows()).toHaveLength(PER_REPLICA_LIMIT);
  });

  it('a marker in code never reaches a log line', async () => {
    const testApp = await createTestApp();
    const response = await post(testApp, { ...validReport(), code: marker() });
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).not.toContain(marker());
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'invalid_request', fields: { code: 'invalid_format' } },
    });
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
    }
    expect(await storedRows()).toHaveLength(0);
  });

  it('the client header is required and old builds get 426', async () => {
    const testApp = await createTestApp();
    const missing = await post(testApp, validReport(), { client: null });
    await expectEnvelope(missing, 'client_header_required');
    const old = await post(testApp, validReport(), { client: 'ios/0.9.0' });
    await expectEnvelope(old, 'upgrade_required');
    const bareWeb = await post(testApp, validReport(), { client: 'web' });
    expect(bareWeb.status).toBe(204);
    expect(await storedRows()).toHaveLength(1);
  });

  it('envelope on every error', async () => {
    const testApp = await createTestApp();
    // The 429 envelope is asserted by the rate-limit case through the same helper.
    await expectEnvelope(
      await post(testApp, { ...validReport(), platform: 'desktop' }),
      'invalid_request',
    );
    await expectEnvelope(await postRaw(testApp, 'not json'), 'invalid_request');
    await expectEnvelope(
      await post(testApp, validReport(), { client: null }),
      'client_header_required',
    );
    await expectEnvelope(
      await postRaw(testApp, 'x'.repeat(BODY_LIMIT_BYTES + 1)),
      'payload_too_large',
    );
    await expectEnvelope(
      await post(testApp, validReport(), { client: 'android/0.0.1' }),
      'upgrade_required',
    );
  });

  it('the request line holds the route pattern', async () => {
    const testApp = await createTestApp();
    const response = await post(testApp, validReport());
    expect(response.status).toBe(204);
    const lines = testApp.logs.filter((line) => line.parsed['event'] === 'request.done');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.parsed).toMatchObject({ method: 'POST', route: PATH, status: 204 });
    expect(lines[0]?.raw).not.toContain('render.failed');
    expect(lines[0]?.raw).not.toContain('office-screen');
  });
});
