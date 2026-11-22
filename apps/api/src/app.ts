import type { OpenAPIHono } from '@hono/zod-openapi';
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { ApiError, ERROR_CODES } from '@citizenrun/shared';
import type { ErrorCode, ErrorEnvelope, FieldCode } from '@citizenrun/shared';
import type { Deps } from './deps.ts';
import { documentFor } from './openapi.ts';
import type { OpenApiDocument } from './openapi.ts';
import { JSON_CONTENT_TYPE } from './respond.ts';
import { createRouter } from './router.ts';
import type { ApiEnv } from './router.ts';
import { registerRoutes } from './routes/index.ts';

/** Options of `createApp`; every member is optional. */
export type AppOptions = { strictResponses?: boolean };

// The session cookie's wire name on HTTPS origins, as the document's `cookie` security scheme names it (D-231).
const SESSION_COOKIE_WIRE_NAME = '__Host-os_session';

function envelope(code: ErrorCode, fields: Readonly<Record<string, FieldCode>>): ErrorEnvelope {
  return { error: { code, message: ERROR_CODES[code].message, fields: { ...fields } } };
}

/** Answers an `ApiError` with its registry status and envelope; anything else is 500 `internal`. */
export const apiErrorHandler: ErrorHandler<ApiEnv> = (err, c) => {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = { 'Content-Type': JSON_CONTENT_TYPE };
    if (err.retryAfterSeconds !== null) {
      headers['Retry-After'] = String(err.retryAfterSeconds);
    }
    return c.json(envelope(err.code, err.fields), ERROR_CODES[err.code].status, headers);
  }
  return c.json(envelope('internal', {}), ERROR_CODES.internal.status, {
    'Content-Type': JSON_CONTENT_TYPE,
  });
};

/** Answers a path no route matches with 404 `not_found`. */
export const notFoundHandler: NotFoundHandler<ApiEnv> = (c) =>
  c.json(envelope('not_found', {}), ERROR_CODES.not_found.status, {
    'Content-Type': JSON_CONTENT_TYPE,
  });

/**
 * Builds the API app over `deps`. Building it reads nothing from `deps`, opens no connection and
 * starts no timer, so the OpenAPI document can be built from it alone.
 */
export function createApp(deps: Deps, options: AppOptions = {}): OpenAPIHono<ApiEnv> {
  const root = createRouter();
  root.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
  });
  root.openAPIRegistry.registerComponent('securitySchemes', 'cookie', {
    type: 'apiKey',
    in: 'cookie',
    name: SESSION_COOKIE_WIRE_NAME,
  });

  const respondMode = options.strictResponses === true ? 'strict' : 'strip';
  root.use(async (c, next) => {
    c.set('respondMode', respondMode);
    await next();
  });

  let document: OpenApiDocument | null = null;
  const getOpenApiDocument = (): OpenApiDocument => {
    if (document === null) {
      throw new Error('The OpenAPI document was read before the app was built');
    }
    return document;
  };
  registerRoutes(root, deps, { routeMiddleware: [], getOpenApiDocument });

  root.onError(apiErrorHandler);
  root.notFound(notFoundHandler);
  document = documentFor(root);
  return root;
}
