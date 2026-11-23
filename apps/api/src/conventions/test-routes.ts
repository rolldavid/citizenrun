import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Handler } from 'hono';
import { z } from 'zod';
import { ErrorEnvelopeSchema } from '@citizenrun/shared';
import { decodeCursor } from '../lib/cursor.ts';
import { respond } from '../respond.ts';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { ApiEnv as RouterEnv, ApiRouteMeta, RouteContext } from '../router.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };
const META: ApiRouteMeta = { auth: 'none', rateLimit: 'clientErrors' };
const ERRORS = [
  'invalid_request',
  'invalid_cursor',
  'client_header_required',
  'payload_too_large',
  'upgrade_required',
  'rate_limited',
  'internal',
] as const;
const RESPONSES = {
  400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
  413: { description: 'The body is over the limit.', content: ERROR_RESPONSE },
  426: { description: 'The build is too old.', content: ERROR_RESPONSE },
  429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  500: { description: 'The fixture failed.', content: ERROR_RESPONSE },
};

const EchoBodySchema = z.object({ pad: z.string().max(70_000) });
const CursorQuerySchema = z.object({ cursor: z.string().max(600) });
const CursorValueSchema = z.object({ s: z.array(z.string()), i: z.uuid() });
// The test sends its privacy marker as the failure text: test helpers are imported only by tests.
const ThrowBodySchema = z.object({ text: z.string().max(200) });

const echoRoute = defineRoute({
  method: 'post',
  path: '/__conventions/echo',
  operationId: 'conventionsEcho',
  request: {
    body: { required: true, content: { 'application/json': { schema: EchoBodySchema } } },
  },
  responses: { 204: { description: 'Accepted.' }, ...RESPONSES },
  meta: META,
  errors: ERRORS,
});

const cursorRoute = defineRoute({
  method: 'get',
  path: '/__conventions/cursor',
  operationId: 'conventionsCursor',
  request: { query: CursorQuerySchema },
  responses: {
    200: {
      description: 'The decoded cursor.',
      content: { 'application/json': { schema: CursorValueSchema } },
    },
    ...RESPONSES,
  },
  meta: META,
  errors: ERRORS,
});

const throwRoute = defineRoute({
  method: 'post',
  path: '/__conventions/throw',
  operationId: 'conventionsThrow',
  request: {
    body: { required: true, content: { 'application/json': { schema: ThrowBodySchema } } },
  },
  responses: { 204: { description: 'Never sent.' }, ...RESPONSES },
  meta: META,
  errors: ERRORS,
});

type CursorInput = {
  in: { query: Record<string, string> };
  out: { query: z.infer<typeof CursorQuerySchema> };
};

const echoHandler: Handler<RouterEnv> = (c) => c.body(null, 204);

const cursorHandler: Handler<RouterEnv, string, CursorInput> = (c) => {
  const value = decodeCursor(CursorValueSchema, c.req.valid('query').cursor);
  return respond(c, CursorValueSchema, value);
};

type ThrowInput = {
  in: { json: unknown };
  out: { json: z.infer<typeof ThrowBodySchema> };
};

const throwHandler: Handler<RouterEnv, string, ThrowInput> = (c) => {
  throw new Error('fixture failure ' + c.req.valid('json').text);
};

// The test routes are never part of the served document, which is built before they are mounted.
const NO_DOCUMENT: RouteContext = {
  routeMiddleware: [],
  getOpenApiDocument: () => {
    throw new Error('the convention test routes read no document');
  },
};

/**
 * Mounts the three convention test routes on a `/v1` router from the router factory. Used only
 * through `createApp(deps, { extraRoutes })` by the convention suites; the server never mounts it.
 */
export function mountConventionTestRoutes(app: OpenAPIHono<RouterEnv>): void {
  const v1 = createRouter();
  registerRoute(v1, echoRoute, echoHandler, NO_DOCUMENT);
  registerRoute(v1, cursorRoute, cursorHandler, NO_DOCUMENT);
  registerRoute(v1, throwRoute, throwHandler, NO_DOCUMENT);
  app.route('/v1', v1);
}
