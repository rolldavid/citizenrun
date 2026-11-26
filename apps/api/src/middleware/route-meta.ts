import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { AuthLevel, RouteMeta } from '@citizenrun/shared';
import { hiddenRouteMetaOf } from '../router.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';

/** A route's `x-route` metadata with its operation id. */
export type ResolvedRouteMeta = RouteMeta & { operationId: string };

/** One lookup from a request to its route's metadata, built once per app (L-route-meta). */
export type RouteMetaIndex = {
  /**
   * Reads every registered OpenAPI operation and every route registered with `hide: true` (D-854);
   * called after every route is registered.
   */
  load(app: OpenAPIHono<RouterEnv>): void;
  /**
   * The metadata of the route that answers this request, or null when no route's metadata matched.
   * A `/v1` request with null still gets the default body limit and the `v1.unmatched` policy.
   */
  match(c: Context<RouterEnv>): ResolvedRouteMeta | null;
  all(): readonly { method: string; path: string; meta: ResolvedRouteMeta }[];
};

// Hono's method name of a route registered with `use`, which matches every method.
const ANY_METHOD = 'ALL';
// Where Hono keeps the original handler when it wraps a mounted router's handler in that router's
// own error handler.
const COMPOSED_HANDLER = '__COMPOSED_HANDLER';

const AUTH_LEVELS: ReadonlySet<string> = new Set<AuthLevel>([
  'none',
  'optional',
  'user',
  'onboarded',
  'admin',
]);

/** Whether a path is under `/v1`. */
export function isV1Path(path: string): boolean {
  return path === '/v1' || path.startsWith('/v1/');
}

// The first route matched for a specific method: the endpoint that answers. Middleware added with
// `use` matches every method and comes before it; a later catch-all comes after it.
function endpointOf(c: Context<RouterEnv>): { method: string; path: string } | null {
  for (const route of matchedRoutes(c)) {
    if (route.method !== ANY_METHOD) {
      return { method: route.method, path: route.path };
    }
  }
  return null;
}

/**
 * The registered pattern of the route that answers the request, never its raw path: the matched
 * endpoint's pattern, or for an unmatched path the last matched middleware pattern (such as `/v1/*`).
 */
export function routePattern(c: Context<RouterEnv>): string {
  const endpoint = endpointOf(c);
  if (endpoint !== null) {
    return endpoint.path;
  }
  return matchedRoutes(c).at(-1)?.path ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The `x-route` of a registered operation; every route of the API is made by defineRoute.
function routeMetaOf(value: unknown, key: string): RouteMeta {
  if (
    !isRecord(value) ||
    typeof value['auth'] !== 'string' ||
    !AUTH_LEVELS.has(value['auth']) ||
    typeof value['rateLimit'] !== 'string'
  ) {
    throw new Error(`route ${key} has no x-route with auth and rateLimit`);
  }
  return value as RouteMeta; // auth and rateLimit are checked above; the optional members are defineRoute's
}

// The handler a mounted route was registered with, under any wrapper Hono put around it.
function originalHandler(handler: unknown): unknown {
  let current = handler;
  while (typeof current === 'function' && COMPOSED_HANDLER in current) {
    current = (current as unknown as Record<string, unknown>)[COMPOSED_HANDLER]; // Hono's own marker, set on the wrapping function
  }
  return current;
}

/** Hono's form of an OpenAPI path: `{id}` becomes `:id`, as `@hono/zod-openapi` registers it. */
function honoPath(openApiPath: string): string {
  return openApiPath.replaceAll(/\/{(.+?)}/g, '/:$1');
}

export function createRouteMetaIndex(): RouteMetaIndex {
  const byKey = new Map<string, { method: string; path: string; meta: ResolvedRouteMeta }>();
  return {
    load(app) {
      for (const definition of app.openAPIRegistry.definitions) {
        if (definition.type !== 'route') {
          continue;
        }
        const method = definition.route.method.toUpperCase();
        const path = honoPath(definition.route.path);
        const key = `${method} ${path}`;
        if (byKey.has(key)) {
          throw new Error(`route ${key} is registered twice`);
        }
        const meta = routeMetaOf(definition.route['x-route'], key);
        const operationId = definition.route.operationId ?? '';
        byKey.set(key, { method, path, meta: { ...meta, operationId } });
      }
      // A hidden route is in no registry; its first handler carries its metadata (D-854).
      for (const route of app.routes) {
        const hidden = hiddenRouteMetaOf(originalHandler(route.handler));
        if (route.method === ANY_METHOD || hidden === undefined) {
          continue;
        }
        const key = `${route.method} ${route.path}`;
        if (byKey.has(key)) {
          throw new Error(`route ${key} is registered twice`);
        }
        const meta = routeMetaOf(hidden.meta, key);
        byKey.set(key, {
          method: route.method,
          path: route.path,
          meta: { ...meta, operationId: hidden.operationId },
        });
      }
    },
    match(c) {
      // The first matched route that declared metadata: a catch-all registered earlier, such as the
      // shell's, passes `/v1` on to the route behind it (D-854).
      for (const route of matchedRoutes(c)) {
        if (route.method === ANY_METHOD) {
          continue;
        }
        // A HEAD request is routed to the GET handlers, so its routes are already the GET routes.
        const method = route.method === 'HEAD' ? 'GET' : route.method;
        const found = byKey.get(`${method} ${route.path}`);
        if (found !== undefined) {
          return found.meta;
        }
      }
      return null;
    },
    all() {
      return [...byKey.values()];
    },
  };
}
