import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../deps.ts';
import { createRouter } from '../router.ts';
import type { ApiEnv, RouteContext } from '../router.ts';
import { registerHealthRoutes } from './health/index.ts';
import { registerMetaRoutes } from './meta/index.ts';
import { registerSafetyRoutes } from './safety/index.ts';

/**
 * The route registry. Groups are attached in the order D-163 fixes: `/v1`, `/og`, `/m`, tiles and
 * map style, `/.well-known`, sitemap, robots, health and legal, static files, then the catch-all.
 * Registration reads no member of `deps`.
 */
export function registerRoutes(app: OpenAPIHono<ApiEnv>, deps: Deps, ctx: RouteContext): void {
  // D-163 row 1: the /v1 routers.
  const v1 = createRouter();
  registerMetaRoutes(v1, deps, ctx);
  registerSafetyRoutes(v1, deps, ctx);
  app.route('/v1', v1);

  // D-163 row 8: /healthz and /readyz.
  registerHealthRoutes(app, deps);
}
