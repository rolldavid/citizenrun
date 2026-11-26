import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { listIssuesHandler, listIssuesRoute } from './list-issues.ts';

/** Attaches the reference routes (E-REF) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerReferenceRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, listIssuesRoute, listIssuesHandler(deps), ctx);
}
