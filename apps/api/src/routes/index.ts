import type { OpenAPIHono } from '@hono/zod-openapi';
import { compress } from 'hono/compress';
import type { Deps } from '../deps.ts';
import { limit } from '../middleware/rate-limit.ts';
import { createRouter } from '../router.ts';
import type { ApiEnv, RouteContext } from '../router.ts';
import { shellHandler, webOnly } from '../web/catch-all.ts';
import { robotsHandler } from '../web/robots.ts';
import { staticFiles } from '../web/static.ts';
import { registerAuthRoutes } from './auth/index.ts';
import { registerDevRoutes } from './dev/index.ts';
import { registerHealthRoutes } from './health/index.ts';
import { registerMeRoutes } from './me/index.ts';
import { registerMetaRoutes } from './meta/index.ts';
import { registerReferenceRoutes } from './reference/index.ts';
import { registerSafetyRoutes } from './safety/index.ts';
import { registerUploadRoutes } from './uploads/index.ts';

/** What registration takes from the environment, through `createApp`'s options and never `deps`. */
export type RegistryOptions = { devMailbox: boolean };

/**
 * The route registry. Groups are attached in the order D-163 fixes: `/v1`, `/og`, `/m`, tiles and
 * map style, `/.well-known`, sitemap, robots, health and legal, static files, then the catch-all.
 * Registration reads no member of `deps`; the development router is attached only when
 * `options.devMailbox` is true (E-AUTH-11).
 */
export function registerRoutes(
  app: OpenAPIHono<ApiEnv>,
  deps: Deps,
  ctx: RouteContext,
  options: RegistryOptions,
): void {
  // D-163 row 1: the /v1 routers.
  const v1 = createRouter();
  registerAuthRoutes(v1, deps, ctx);
  registerMeRoutes(v1, deps, ctx);
  registerUploadRoutes(v1, deps, ctx);
  registerReferenceRoutes(v1, deps, ctx);
  registerMetaRoutes(v1, deps, ctx);
  registerSafetyRoutes(v1, deps, ctx);
  if (options.devMailbox) {
    registerDevRoutes(v1, deps, ctx);
  }
  app.route('/v1', v1);

  // D-163
  app.get('/robots.txt', limit(deps, 'web_seo'), robotsHandler(deps));

  // D-163 row 8: /healthz and /readyz.
  registerHealthRoutes(app, deps);

  // D-163
  app.use('*', staticFiles(deps));

  // D-163
  app.get(
    '*',
    webOnly(limit(deps, 'web_page')),
    webOnly(compress({ encoding: 'gzip' })),
    shellHandler(deps),
  );
}
