import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { Db } from '@citizenrun/db';
import { getTestDb } from '@citizenrun/db/testing';
import { CreateClientErrorBodySchema, ERROR_CODES, newId } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE } from './scripts/gen-openapi.ts';
import { createTestApp } from './testing/app.ts';
import type { TestApp } from './testing/app.ts';
import type { TestResponse } from './testing/request.ts';

// TEST-privacy-logscan's API suite. The always-on scan of the harness runs after every case as well.

/** One operation that takes text a user typed or a secret, and how to run it three ways. */
type SensitiveInput = {
  path: string;
  /** The body fields, as dot paths, that get the marker. */
  fields: readonly string[];
  /** A valid body without any marker. */
  validBody: () => Record<string, unknown>;
  /** Whether a body is valid, so the marker goes only into values the schema admits. */
  isValid: (body: unknown) => boolean;
  successStatus: number;
  /** The text of every stored row the success path writes. */
  storedText: () => Promise<string>;
  /** A database whose write rejects with an error whose message holds the marker. */
  failingDb: () => Db;
};

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Every request comes from its own address, so no case nears a per-replica limit.
let nextHost = 100;
function freshIp(): string {
  const ip = `203.0.113.${String(nextHost)}`;
  nextHost += 1;
  return ip;
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

/** Every operation with a string field in its body or query that gets the marker. */
const SENSITIVE_INPUTS: Readonly<Record<string, SensitiveInput>> = {
  createClientError: {
    path: '/v1/client-errors',
    fields: ['name', 'code', 'route', 'component', 'appVersion', 'frames.0.file', 'requestId'],
    validBody: clientErrorBody,
    isValid: (body) => CreateClientErrorBodySchema.safeParse(body).success,
    successStatus: 204,
    storedText: async () => {
      const rows = await getTestDb().execute<{ text: string }>(
        sql`select coalesce(string_agg(t::text, ''), '') as text from client_errors t`,
        'objects',
      );
      return rows[0]?.text ?? '';
    },
    failingDb: insertRejectingDb,
  },
};

/** Operations with a string field that a user never types, each with its reason. */
const NO_USER_TEXT: Readonly<Record<string, string>> = {};

function setAt(body: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let target: unknown = body;
  for (const key of keys.slice(0, -1)) {
    target = (target as Record<string, unknown>)[key]; // walks a body this file built
  }
  (target as Record<string, unknown>)[keys.at(-1) ?? ''] = value; // the parent found above
}

function markedForms(): string[] {
  const value = marker();
  return [value, encodeURIComponent(value), Buffer.from(value, 'utf8').toString('base64')];
}

function expectNoMarkerIn(text: string): void {
  for (const form of markedForms()) {
    expect(text).not.toContain(form);
  }
}

function expectNoMarkerInLogs(testApp: TestApp): void {
  expect(testApp.logs.length).toBeGreaterThan(0);
  for (const line of testApp.logs) {
    expectNoMarkerIn(line.raw);
  }
}

async function send(testApp: TestApp, input: SensitiveInput, body: unknown): Promise<TestResponse> {
  return testApp.request.post(input.path, { client: 'web', ip: freshIp(), body });
}

async function expectEnvelope(response: TestResponse, code: 'invalid_request' | 'internal') {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const text = await response.text();
  expectNoMarkerIn(text);
  expect(JSON.parse(text)).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
}

/** Success: the marker goes only into keys the schema drops; the row is stored without it. */
async function runSuccess(input: SensitiveInput): Promise<void> {
  const testApp = await createTestApp();
  const response = await send(testApp, input, {
    ...input.validBody(),
    message: marker(),
    stack: `Error: ${marker()}\n    at fixture (src/app.ts:1:1)`,
  });
  expect(response.status).toBe(input.successStatus);
  const stored = await input.storedText();
  expect(stored).not.toBe('');
  expectNoMarkerIn(stored);
  expectNoMarkerInLogs(testApp);
}

/** Validation failure: each field in turn holds an invalid marked value. */
async function runValidationFailures(input: SensitiveInput): Promise<void> {
  const testApp = await createTestApp();
  for (const field of input.fields) {
    const body = structuredClone(input.validBody());
    setAt(body, field, `Bad ${marker()}`);
    expect(input.isValid(body), field).toBe(false);
    await expectEnvelope(await send(testApp, input, body), 'invalid_request');
  }
  expectNoMarkerInLogs(testApp);
}

/** Inner failure: valid fields carry the marker where the schema admits it, and the write throws. */
async function runInnerFailure(input: SensitiveInput): Promise<void> {
  const testApp = await createTestApp({ db: input.failingDb() });
  const body = structuredClone(input.validBody());
  let marked = 0;
  for (const field of input.fields) {
    for (const candidate of [marker(), `/${marker()}`]) {
      const tried = structuredClone(body);
      setAt(tried, field, candidate);
      if (input.isValid(tried)) {
        setAt(body, field, candidate);
        marked += 1;
        break;
      }
    }
  }
  expect(marked).toBeGreaterThan(0);
  await expectEnvelope(await send(testApp, input, body), 'internal');
  const errorLines = testApp.logs.filter((line) => line.parsed['event'] === 'request.error');
  expect(errorLines).toHaveLength(1);
  expectNoMarkerInLogs(testApp);
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
    expectNoMarkerInLogs(refusing);

    await runInnerFailure(input);
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
