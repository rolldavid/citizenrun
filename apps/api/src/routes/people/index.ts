import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { getPersonHandler, getPersonRoute } from './get-person.ts';

/** Attaches the people routes (E-PPL) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerPeopleRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, getPersonRoute, getPersonHandler(deps), ctx);
}
