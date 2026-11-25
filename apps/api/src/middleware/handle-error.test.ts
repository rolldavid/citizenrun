import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { QueueMissingError } from '@citizenrun/db';
import { ApiError, ErrorEnvelopeSchema } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError, notFound } from './handle-error.ts';
import { logRequest } from './log-request.ts';
import { requestId } from './request-id.ts';
import { requestVariables } from './variables.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };

const createThing = defineRoute({
  method: 'post',
  path: '/v1/things',
  operationId: 'createThing',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ name: z.string().max(5) }) } },
      required: true,
    },
  },
  responses: { 200: { description: 'Created.' } },
  meta: { auth: 'none', rateLimit: 'clientErrors' },
  errors: ['invalid_request'],
});

function buildApp(fail: () => never) {
  const deps = createUnitDeps();
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('*', requestId());
  app.use('*', logRequest(deps));
  registerRoute(app, createThing, (c) => c.json({ ok: true }), NO_CONTEXT);
  app.get('/v1/fail', () => fail());
  app.get('/page/fail', () => fail());
  app.get('/v1/limited', (c) => {
    c.set('retryAfterSeconds', 17);
    throw new ApiError('rate_limited');
  });
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return { app, deps };
}

// Shaped as pg's DatabaseError: the message, `detail` and the key fields can hold row values.
class FixtureDatabaseError extends Error {
  override name = 'error';
  readonly length: number;
  severity = 'ERROR';
  code = '23505';
  detail: string | undefined;
  constraint = 'users_handle_key';
  table = 'users';

  constructor(message: string, detail: string) {
    super(message);
    this.length = message.length;
    this.detail = detail;
  }
}

function failWith(error: Error): () => never {
  return () => {
    throw error;
  };
}

async function bodyText(response: Response): Promise<string> {
  return response.text();
}

describe('handleError', () => {
  it('an ApiError becomes its envelope and status', async () => {
    const { app } = buildApp(failWith(new ApiError('not_found')));
    const response = await app.request('/v1/fail');
    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).not.toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not found.', fields: {} },
    });
  });

  it('field codes pass through', async () => {
    const { app } = buildApp(
      failWith(new ApiError('invalid_request', { fields: { 'a.b': 'required' } })),
    );
    const response = await app.request('/v1/fail');
    expect(response.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await response.json())).toEqual({
      error: {
        code: 'invalid_request',
        message: 'The request is not valid.',
        fields: { 'a.b': 'required' },
      },
    });
  });

  it('malformed JSON answers 400 invalid_request', async () => {
    const { app, deps } = buildApp(failWith(new Error('unused')));
    const response = await app.request('/v1/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": ',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'The request is not valid.', fields: {} },
    });
    expect(deps.logs.some((line) => line.parsed['event'] === 'request.error')).toBe(false);
    // A body that parses and fails its schema gets the field codes of the validation hook.
    const invalid = await app.request('/v1/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'far too long' }),
    });
    expect(await invalid.json()).toMatchObject({
      error: { code: 'invalid_request', fields: { name: 'too_long' } },
    });
  });

  it('a thrown plain Error answers 500 internal with the fixed message and logs its class only', async () => {
    const value = marker();
    const { app, deps } = buildApp(failWith(new Error(`failure holding ${value}`)));
    const response = await app.request('/v1/fail');
    expect(response.status).toBe(500);
    const text = await bodyText(response);
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
    expect(text).not.toContain(value);
    const errorLines = deps.logs.filter((line) => line.parsed['event'] === 'request.error');
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]?.parsed).toMatchObject({ level: 'error', errorClass: 'Error' });
    for (const line of deps.logs) {
      expect(line.raw).not.toContain(value);
    }
    expect(deps.logs.at(-1)?.parsed).toMatchObject({
      event: 'request.done',
      status: 500,
      errorCode: 'internal',
    });
  });

  it('an error whose fields throw when read still answers 500 and logs request.error', async () => {
    const error = new Error('fixture-private-text');
    for (const field of ['name', 'message', 'stack']) {
      Object.defineProperty(error, field, {
        get(): never {
          throw new Error('fixture getter failure');
        },
      });
    }
    const { app, deps } = buildApp(failWith(error));
    const response = await app.request('/v1/fail');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
    const errorLines = deps.logs.filter((line) => line.parsed['event'] === 'request.error');
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]?.parsed).toMatchObject({
      errorClass: 'Error',
      error: {
        errorClass: 'Error',
        message: '(message withheld)',
        stack: 'Error: (message withheld)',
      },
    });
    expect(deps.logs.at(-1)?.parsed).toMatchObject({ event: 'request.done', status: 500 });
  });

  it("a database error's text never reaches the response or the log", async () => {
    const value = marker();
    const error = new FixtureDatabaseError(
      `duplicate key value violates unique constraint ${value}`,
      `Key (handle)=(${value}) already exists.`,
    );
    const { app, deps } = buildApp(failWith(error));
    const response = await app.request('/v1/fail');
    expect(response.status).toBe(500);
    const text = await bodyText(response);
    expect(text).not.toContain(value);
    expect(text).not.toContain('already exists');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
    expect(deps.logs.some((line) => line.parsed['event'] === 'request.error')).toBe(true);
    for (const line of deps.logs) {
      expect(line.raw).not.toContain(value);
      expect(line.raw).not.toContain('already exists');
    }
  });

  it('a missing queue answers 503 unavailable and logs queue.missing with the queue name', async () => {
    const { app, deps } = buildApp(failWith(new QueueMissingError('ops.heartbeat')));
    const response = await app.request('/v1/fail');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'unavailable', message: 'A dependency is unavailable.', fields: {} },
    });
    const lines = deps.logs.filter((line) => line.parsed['event'] === 'queue.missing');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.parsed).toMatchObject({ level: 'warn', queue: 'ops.heartbeat' });
    expect(deps.logs.some((line) => line.parsed['event'] === 'request.error')).toBe(false);
  });

  it('rate_limited carries Retry-After', async () => {
    const { app } = buildApp(failWith(new Error('unused')));
    const response = await app.request('/v1/limited');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(await response.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests.', fields: {} },
    });
  });

  it('unknown /v1 paths and OPTIONS answer the not_found envelope', async () => {
    const { app, deps } = buildApp(failWith(new Error('unused')));
    for (const init of [{}, { method: 'OPTIONS' }, { method: 'DELETE' }]) {
      const response = await app.request('/v1/nothing/here', init);
      expect(response.status).toBe(404);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.json()).toEqual({
        error: { code: 'not_found', message: 'Not found.', fields: {} },
      });
    }
    const options = await app.request('/v1/things', { method: 'OPTIONS' });
    expect(options.status).toBe(404);
    expect(deps.logs.at(-1)?.parsed).toMatchObject({ status: 404, errorCode: 'not_found' });
  });

  it('the envelope carries the JSON charset', async () => {
    const { app } = buildApp(failWith(new Error('unused')));
    const response = await app.request('/v1/nothing');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('unknown paths outside /v1 answer plain-text 404', async () => {
    const { app, deps } = buildApp(failWith(new ApiError('payload_too_large')));
    const response = await app.request('/no/such/page', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Not found');
    expect(deps.logs.at(-1)?.parsed).toMatchObject({ status: 404, errorCode: 'not_found' });

    // An error outside /v1 is a fixed plain-text body with the code's status.
    const failed = await app.request('/page/fail');
    expect(failed.status).toBe(413);
    expect(await failed.text()).toBe('Payload too large');
  });

  it('an unknown error code does not compile', () => {
    const make = (): ApiError =>
      // @ts-expect-error: unknown codes are refused by ERROR_CODES (TEST-api-conventions)
      new ApiError('not_a_code');
    expect(typeof make).toBe('function');
  });
});
