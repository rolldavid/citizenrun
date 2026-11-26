import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { listOfficesHandler, listOfficesRoute } from './list-offices.ts';

/** Attaches the explore routes (E-EXP) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerExploreRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, listOfficesRoute, listOfficesHandler(deps), ctx);
}
