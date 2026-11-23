import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { limit } from '../../middleware/rate-limit.ts';
import { createRouter } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { getHealthzHandler, getHealthzRoute } from './get-healthz.ts';
import { getReadyzHandler, getReadyzRoute } from './get-readyz.ts';

/**
 * Attaches E-WEB-01 and E-WEB-02 at the root, outside `/v1`, each behind its limiter: the `/v1`
 * chain does not reach these paths. Registration reads nothing from `deps`.
 */
export function registerHealthRoutes(app: OpenAPIHono<RouterEnv>, deps: Deps): void {
  app.use('/healthz', limit(deps, 'web_health'));
  app.use('/readyz', limit(deps, 'web_health'));
  const router = createRouter();
  router.openapi(getHealthzRoute, getHealthzHandler());
  router.openapi(getReadyzRoute, getReadyzHandler(deps));
  app.route('/', router);
}
