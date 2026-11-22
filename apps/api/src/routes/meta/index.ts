import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv, RouteContext } from '../../router.ts';
import { getOpenApiDocumentHandler, getOpenApiDocumentRoute } from './get-openapi.ts';

/** Attaches the meta routes (E-REF-03) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerMetaRoutes(
  router: OpenAPIHono<ApiEnv>,
  _deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, getOpenApiDocumentRoute, getOpenApiDocumentHandler(ctx), ctx);
}
