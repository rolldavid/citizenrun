import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { createAuthNonceHandler, createAuthNonceRoute } from './create-auth-nonce.ts';
import { logoutHandler, logoutRoute } from './logout.ts';
import { startEmailSignInHandler, startEmailSignInRoute } from './start-email-sign-in.ts';
import { verifyEmailSignInHandler, verifyEmailSignInRoute } from './verify-email-sign-in.ts';

/** Attaches the sign-in routes (E-AUTH) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerAuthRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, startEmailSignInRoute, startEmailSignInHandler(deps), ctx);
  registerRoute(router, verifyEmailSignInRoute, verifyEmailSignInHandler(deps), ctx);
  registerRoute(router, createAuthNonceRoute, createAuthNonceHandler(deps), ctx);
  registerRoute(router, logoutRoute, logoutHandler(deps), ctx);
}
