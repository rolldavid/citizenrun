import type { OpenAPIHono } from '@hono/zod-openapi';
import { compress } from 'hono/compress';
import type { Deps } from '../deps.ts';
import { limit } from '../middleware/rate-limit.ts';
import { createRouter } from '../router.ts';
import type { ApiEnv, RouteContext } from '../router.ts';
import { shellHandler } from '../web/catch-all.ts';
import { robotsHandler } from '../web/robots.ts';
import { staticFiles } from '../web/static.ts';
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

  // D-163
  app.get('/robots.txt', limit(deps, 'web_seo'), robotsHandler(deps));

  // D-163 row 8: /healthz and /readyz.
  registerHealthRoutes(app, deps);

  // D-163
  app.use('*', staticFiles(deps));

  // D-163
  app.get('*', limit(deps, 'web_page'), compress({ encoding: 'gzip' }), shellHandler(deps));
}
