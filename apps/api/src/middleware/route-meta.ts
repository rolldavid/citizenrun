import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { AuthLevel, RouteMeta } from '@citizenrun/shared';
import type { ApiEnv as RouterEnv } from '../router.ts';

/** A route's `x-route` metadata with its operation id. */
export type ResolvedRouteMeta = RouteMeta & { operationId: string };

/** One lookup from a request to its route's metadata, built once per app (L-route-meta). */
export type RouteMetaIndex = {
  /** Reads every registered OpenAPI operation; called after every route is registered. */
  load(app: OpenAPIHono<RouterEnv>): void;
  /** The metadata of the operation that answers this request, or null when none matched. */
  match(c: Context<RouterEnv>): ResolvedRouteMeta | null;
  all(): readonly { method: string; path: string; meta: ResolvedRouteMeta }[];
};

// Hono's method name of a route registered with `use`, which matches every method.
const ANY_METHOD = 'ALL';

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
    },
    match(c) {
      const endpoint = endpointOf(c);
      if (endpoint === null) {
        return null;
      }
      // A HEAD request is routed to the GET handlers, so its endpoint is already the GET route.
      const method = endpoint.method === 'HEAD' ? 'GET' : endpoint.method;
      return byKey.get(`${method} ${endpoint.path}`)?.meta ?? null;
    },
    all() {
      return [...byKey.values()];
    },
  };
}
