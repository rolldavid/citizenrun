import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../deps.ts';
import { createRouter } from '../router.ts';
import type { ApiEnv, RouteContext } from '../router.ts';
import { registerMetaRoutes } from './meta/index.ts';

/**
 * The route registry. Groups are attached in the order D-163 fixes: `/v1`, `/og`, `/m`, tiles and
 * map style, `/.well-known`, sitemap, robots, health and legal, static files, then the catch-all.
 */
export function registerRoutes(app: OpenAPIHono<ApiEnv>, deps: Deps, ctx: RouteContext): void {
  const v1 = createRouter();
  registerMetaRoutes(v1, deps, ctx);
  app.route('/v1', v1);
}
