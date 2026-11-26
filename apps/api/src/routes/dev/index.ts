import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';

/**
 * Whether the local development mailbox (E-AUTH-11) is registered: only when the env module's
 * `devRoutes` and `captureMail` are both true, so no deployed process has it.
 */
export function devMailboxEnabled(env: { devRoutes: boolean; captureMail: boolean }): boolean {
  return env.devRoutes && env.captureMail;
}

/**
 * Attaches the development routes (E-AUTH-11) to the `/v1` router; the registry calls it only when
 * `devMailboxEnabled` is true. Registration reads nothing from `deps`.
 */
export const registerDevRoutes: (
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
) => void = () => {
  // No operation yet: the development mailbox is registered here, hidden from the document.
};
