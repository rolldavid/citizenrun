import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { readDevMailboxHandler, readDevMailboxRoute } from './read-dev-mailbox.ts';

/**
 * Whether the local development mailbox (E-AUTH-11) is registered: only when the env module's
 * `devRoutes` and `captureMail` are both true, so no deployed process has it.
 */
export function devMailboxEnabled(env: { devRoutes: boolean; captureMail: boolean }): boolean {
  return env.devRoutes && env.captureMail;
}

/**
 * Attaches the development routes (E-AUTH-11) to the `/v1` router; the registry calls it only when
 * `devMailboxEnabled` is true. The mailbox is hidden from the document and still declares its
 * metadata through `registerRoute` (D-854). Registration reads nothing from `deps`.
 */
export function registerDevRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, readDevMailboxRoute, readDevMailboxHandler(deps), ctx);
}
