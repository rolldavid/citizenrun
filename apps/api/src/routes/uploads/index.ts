import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { createUploadHandler, createUploadRoute } from './create-upload.ts';

/** Attaches the upload route (E-UPL) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerUploadRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, createUploadRoute, createUploadHandler(deps), ctx);
}
