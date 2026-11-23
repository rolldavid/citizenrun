import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { createClientErrorHandler, createClientErrorRoute } from './create-client-error.ts';

/** Attaches the safety routes (E-SAFE-02) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerSafetyRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, createClientErrorRoute, createClientErrorHandler(deps), ctx);
}
