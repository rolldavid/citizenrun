import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ApiError, ErrorEnvelopeSchema } from '@citizenrun/shared';
import { handleError } from './middleware/handle-error.ts';
import { createRouter, defineRoute, fieldCodesOf, registerRoute } from './router.ts';
import type { RouteContext } from './router.ts';
import { createUnitDeps } from './testing/unit-deps.ts';

const BodySchema = z.object({
  name: z.string().min(2).max(5),
  tags: z.array(z.string()).min(1).max(2),
  age: z.number().int().min(1).max(9),
  email: z.email(),
  kind: z.enum(['a', 'b']),
  code: z.string().refine(() => false, { params: { code: 'not_allowed' } }),
});

// Every key valid except `code`, whose refinement always fails; each case breaks one more key.
const VALID = { name: 'abc', tags: ['t'], age: 5, email: 'a@example.test', kind: 'a', code: 'x' };

function fieldsFor(input: Record<string, unknown>): Record<string, string> {
  const result = BodySchema.safeParse(input);
  if (result.success) {
    throw new Error('expected the input to fail');
  }
  return fieldCodesOf(result.error.issues, input);
}

function without(key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== key));
}

const NO_CONTEXT: RouteContext = {
  routeMiddleware: [],
  getOpenApiDocument: () => ({}),
};

describe('fieldCodesOf', () => {
  it('maps zod issues to field codes', () => {
    expect(fieldsFor(without('name'))).toEqual({ name: 'required', code: 'not_allowed' });
    expect(fieldsFor({ ...VALID, name: 3 })).toEqual({ name: 'invalid_type', code: 'not_allowed' });
    expect(fieldsFor({ ...VALID, name: 'a' })).toEqual({ name: 'too_short', code: 'not_allowed' });
    expect(fieldsFor({ ...VALID, name: 'abcdef' })).toEqual({
      name: 'too_long',
      code: 'not_allowed',
    });
    expect(fieldsFor({ ...VALID, tags: [] })).toEqual({ tags: 'too_few', code: 'not_allowed' });
    expect(fieldsFor({ ...VALID, tags: ['a', 'b', 'c'] })).toEqual({
      tags: 'too_many',
      code: 'not_allowed',
    });
    expect(fieldsFor({ ...VALID, age: 10 })).toEqual({ age: 'out_of_range', code: 'not_allowed' });
    expect(fieldsFor({ ...VALID, age: 0 })).toEqual({ age: 'out_of_range', code: 'not_allowed' });
    expect(fieldsFor({ ...VALID, email: 'x' })).toEqual({
      email: 'invalid_format',
      code: 'not_allowed',
    });
    expect(fieldsFor({ ...VALID, kind: 'c' })).toEqual({
      kind: 'invalid_value',
      code: 'not_allowed',
    });
    expect(fieldsFor({ ...VALID })).toEqual({ code: 'not_allowed' });
  });

  it('gives a refinement its own field code when it is one of the codes', () => {
    const schema = z.object({
      handle: z.string().refine(() => false, { params: { code: 'too_short' } }),
      other: z.string().refine(() => false, { params: { code: 'made_up' } }),
      bare: z.string().refine(() => false),
    });
    const input = { handle: 'x', other: 'y', bare: 'z' };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(fieldCodesOf(result.error?.issues ?? [], input)).toEqual({
      handle: 'too_short',
      other: 'not_allowed',
      bare: 'not_allowed',
    });
  });

  it('nested paths use dots', () => {
    const schema = z.object({
      issues: z.array(z.object({ issueId: z.string() })).max(5),
    });
    const input = { issues: [{ issueId: 'a' }, { issueId: 'b' }, {}] };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(fieldCodesOf(result.error?.issues ?? [], input)).toEqual({
      'issues.2.issueId': 'required',
    });
  });

  it('keeps the first issue of a path', () => {
    const schema = z.object({
      name: z
        .string()
        .min(2)
        .regex(/^[a-z]+$/),
    });
    const input = { name: '1' };
    const result = schema.safeParse(input);
    expect(result.error?.issues.length).toBe(2);
    expect(fieldCodesOf(result.error?.issues ?? [], input)).toEqual({ name: 'too_short' });
  });

  it('gives invalid_type to an issue the table does not name', () => {
    const schema = z.object({ count: z.number().multipleOf(5) });
    const input = { count: 3 };
    const result = schema.safeParse(input);
    expect(fieldCodesOf(result.error?.issues ?? [], input)).toEqual({ count: 'invalid_type' });
  });
});

describe('createRouter', () => {
  it('the default hook answers 400 invalid_request', async () => {
    const router = createRouter();
    const route = defineRoute({
      method: 'post',
      path: '/v1/things',
      operationId: 'createThing',
      request: {
        body: { content: { 'application/json': { schema: BodySchema } }, required: true },
      },
      responses: {
        200: { description: 'Created.' },
        400: {
          description: 'Not valid.',
          content: { 'application/json': { schema: ErrorEnvelopeSchema } },
        },
      },
      meta: { auth: 'none', rateLimit: 'ref.openapi' },
      errors: ['invalid_request'],
    });
    registerRoute(router, route, (c) => c.body(null, 200), NO_CONTEXT);
    router.onError(handleError(createUnitDeps()));

    const response = await router.request('/v1/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID, name: 'a', tags: [] }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = ErrorEnvelopeSchema.parse(await response.json());
    expect(body).toEqual({
      error: {
        code: 'invalid_request',
        message: 'The request is not valid.',
        fields: { name: 'too_short', tags: 'too_few', code: 'not_allowed' },
      },
    });
  });

  it('puts the route metadata on the context before the route middleware runs', async () => {
    const router = createRouter();
    const route = defineRoute({
      method: 'get',
      path: '/meta',
      operationId: 'readMeta',
      responses: { 200: { description: 'The metadata.' } },
      meta: { auth: 'none', rateLimit: 'ref.openapi', public: true },
      errors: [],
    });
    const seen: unknown[] = [];
    registerRoute(router, route, (c) => c.body(null, 204), {
      ...NO_CONTEXT,
      routeMiddleware: [
        async (c, next) => {
          seen.push(c.get('routeMeta'));
          await next();
        },
      ],
    });

    const response = await router.request('/meta');

    expect(response.status).toBe(204);
    expect(seen).toEqual([{ auth: 'none', rateLimit: 'ref.openapi', public: true }]);
  });
});

describe('defineRoute', () => {
  const base = {
    method: 'get' as const,
    path: '/x',
    responses: { 200: { description: 'Ok.' } },
    errors: [] as const,
  };

  it('lists no security for auth none', () => {
    const route = defineRoute({ ...base, meta: { auth: 'none', rateLimit: 'ref.openapi' } });
    expect('security' in route).toBe(false);
    expect(route['x-route']).toEqual({ auth: 'none', rateLimit: 'ref.openapi' });
    expect(route['x-errors']).toEqual([]);
  });

  it('lists bearer, cookie and no credential for auth optional', () => {
    const route = defineRoute({ ...base, meta: { auth: 'optional', rateLimit: 'ref.openapi' } });
    expect(route.security).toEqual([{ bearer: [] }, { cookie: [] }, {}]);
  });

  it('lists bearer or cookie for the signed-in levels', () => {
    for (const auth of ['user', 'onboarded', 'admin'] as const) {
      const route = defineRoute({ ...base, meta: { auth, rateLimit: 'ref.openapi' } });
      expect(route.security).toEqual([{ bearer: [] }, { cookie: [] }]);
    }
  });

  it('keeps meta and errors out of the operation itself', () => {
    const route = defineRoute({ ...base, meta: { auth: 'none', rateLimit: 'ref.openapi' } });
    expect('meta' in route).toBe(false);
    expect('errors' in route).toBe(false);
  });
});

describe('handleError', () => {
  function routerThrowing(error: unknown) {
    const router = createRouter();
    router.get('/v1/boom', () => {
      throw error;
    });
    router.onError(handleError(createUnitDeps()));
    return router;
  }

  it('answers an ApiError with its status, envelope and Retry-After', async () => {
    const response = await routerThrowing(
      new ApiError('rate_limited', { retryAfterSeconds: 12 }),
    ).request('/v1/boom');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests.', fields: {} },
    });
  });

  it('sends no Retry-After when the error has none', async () => {
    const response = await routerThrowing(new ApiError('not_found')).request('/v1/boom');
    expect(response.status).toBe(404);
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('answers anything else with 500 internal and the fixed message', async () => {
    const response = await routerThrowing(new Error('db said MARKER_ERR_91c2')).request('/v1/boom');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('MARKER_ERR_91c2');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
  });
});
