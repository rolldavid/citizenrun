import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { bookmarkOfficeHandler, bookmarkOfficeRoute } from './bookmark-office.ts';
import { followOfficeHandler, followOfficeRoute } from './follow-office.ts';
import { getOfficeHandler, getOfficeRoute } from './get-office.ts';
import {
  listOfficeCandidatesHandler,
  listOfficeCandidatesRoute,
} from './list-office-candidates.ts';
import { unbookmarkOfficeHandler, unbookmarkOfficeRoute } from './unbookmark-office.ts';
import { unfollowOfficeHandler, unfollowOfficeRoute } from './unfollow-office.ts';

/** Attaches the office routes (E-OFF) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerOfficeRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, getOfficeRoute, getOfficeHandler(deps), ctx);
  registerRoute(router, listOfficeCandidatesRoute, listOfficeCandidatesHandler(deps), ctx);
  registerRoute(router, followOfficeRoute, followOfficeHandler(deps), ctx);
  registerRoute(router, unfollowOfficeRoute, unfollowOfficeHandler(deps), ctx);
  registerRoute(router, bookmarkOfficeRoute, bookmarkOfficeHandler(deps), ctx);
  registerRoute(router, unbookmarkOfficeRoute, unbookmarkOfficeHandler(deps), ctx);
}
