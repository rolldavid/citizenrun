import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { getMeHandler, getMeRoute } from './get-me.ts';
import { updateMeHandler, updateMeRoute } from './update-me.ts';

/** Attaches the account routes (E-ME) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerMeRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, getMeRoute, getMeHandler(deps), ctx);
  registerRoute(router, updateMeRoute, updateMeHandler(deps), ctx);
}
