import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';

/** Attaches the account routes (E-ME) to the `/v1` router. Registration reads nothing from `deps`. */
export const registerMeRoutes: (
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
) => void = () => {
  // No operation yet: the sign-in and account packages register theirs here.
};
