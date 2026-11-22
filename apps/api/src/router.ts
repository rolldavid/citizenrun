import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { RouteConfig } from '@hono/zod-openapi';
import type { Handler, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { ApiError, FIELD_CODES, assertNever } from '@citizenrun/shared';
import type {
  AuthLevel,
  ErrorCode,
  FieldCode,
  OpenApiDocument,
  RouteMeta,
} from '@citizenrun/shared';
import type { RateLimitPolicyName } from './config/rate-limits.ts';

/** The route metadata of every API route; a policy name outside the policies object does not compile. */
export type ApiRouteMeta = RouteMeta<RateLimitPolicyName>;

/** The context variables every request of the API carries. */
export type ApiEnv = {
  Variables: { respondMode: 'strict' | 'strip'; routeMeta: ApiRouteMeta };
};

type ZodIssue = z.core.$ZodIssue;

const FIELD_CODE_SET: ReadonlySet<string> = new Set(FIELD_CODES);

function isFieldCode(value: unknown): value is FieldCode {
  return typeof value === 'string' && FIELD_CODE_SET.has(value);
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[key]; // an object of unknown shape, read by the issue's own path
  }
  return current;
}

function fieldCodeOf(issue: ZodIssue, input: unknown): FieldCode {
  switch (issue.code) {
    case 'invalid_type':
      return valueAt(input, issue.path) === undefined ? 'required' : 'invalid_type';
    case 'too_small':
    case 'too_big': {
      const small = issue.code === 'too_small';
      switch (issue.origin) {
        case 'string':
          return small ? 'too_short' : 'too_long';
        case 'array':
          return small ? 'too_few' : 'too_many';
        case 'number':
        case 'int':
        case 'bigint':
          return 'out_of_range';
        case 'date':
        case 'set':
        case 'file':
        default:
          return 'invalid_type';
      }
    }
    case 'invalid_format':
      return 'invalid_format';
    case 'invalid_value':
      return 'invalid_value';
    case 'custom': {
      const code: unknown = issue.params?.['code'];
      return isFieldCode(code) ? code : 'not_allowed';
    }
    case 'not_multiple_of':
    case 'unrecognized_keys':
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
    default:
      return 'invalid_type';
  }
}

/**
 * Maps zod issues to the field codes of an `invalid_request` error, keyed by the issue's dot path;
 * the first issue of a path wins.
 */
export function fieldCodesOf(
  issues: readonly ZodIssue[],
  input: unknown,
): Record<string, FieldCode> {
  const fields: Record<string, FieldCode> = {};
  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join('.');
    if (!(key in fields)) {
      fields[key] = fieldCodeOf(issue, input);
    }
  }
  return fields;
}

/** Every router of the API: an `OpenAPIHono` whose validation failures become `invalid_request` (D-230). */
export function createRouter(): OpenAPIHono<ApiEnv> {
  return new OpenAPIHono<ApiEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const input = 'data' in result ? result.data : undefined;
        throw new ApiError('invalid_request', {
          fields: fieldCodesOf(result.error.issues, input),
        });
      }
    },
  });
}

type SecurityRequirement = Record<string, string[]>;

function securityFor(auth: AuthLevel): SecurityRequirement[] | null {
  switch (auth) {
    case 'none':
      return null;
    case 'optional':
      return [{ bearer: [] }, { cookie: [] }, {}];
    case 'user':
    case 'onboarded':
    case 'admin':
      return [{ bearer: [] }, { cookie: [] }];
    default:
      return assertNever(auth);
  }
}

/** A route definition of the API, carrying its metadata and error codes as `x-route` and `x-errors`. */
export type ApiRoute = RouteConfig & {
  'x-route': ApiRouteMeta;
  'x-errors': readonly ErrorCode[];
};

/** Makes a route definition with its `x-route` metadata, its `x-errors` list and its security (L-openapi). */
export function defineRoute(
  config: RouteConfig & { meta: ApiRouteMeta; errors: readonly ErrorCode[] },
): ApiRoute {
  const { meta, errors, ...route } = config;
  const security = securityFor(meta.auth);
  return createRoute({
    ...route,
    'x-route': meta,
    'x-errors': errors,
    ...(security === null ? {} : { security }),
  });
}

/** What registration hands each route: the per-route middleware chain and the built document. */
export type RouteContext = {
  routeMiddleware: readonly MiddlewareHandler<ApiEnv>[];
  getOpenApiDocument: () => OpenApiDocument;
};

/**
 * Registers a route on a router; its own middleware first puts the route's metadata on the context,
 * then runs the route middleware of `ctx` in order, ahead of validation and the handler.
 */
export function registerRoute(
  router: OpenAPIHono<ApiEnv>,
  route: ApiRoute,
  handler: Handler<ApiEnv>,
  ctx: RouteContext,
): void {
  const meta = route['x-route'];
  const setRouteMeta: MiddlewareHandler<ApiEnv> = async (c, next) => {
    c.set('routeMeta', meta);
    await next();
  };
  router.openapi({ ...route, middleware: [setRouteMeta, ...ctx.routeMiddleware] }, handler);
}
