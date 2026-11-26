import type { OpenAPIHono } from '@hono/zod-openapi';
import { RATE_LIMIT_POLICIES } from './config/rate-limits.ts';
import type { Deps } from './deps.ts';
import { bodyLimit } from './middleware/body-limit.ts';
import { cacheHeaders } from './middleware/cache-headers.ts';
import { clientVersion } from './middleware/client-version.ts';
import { handleError, notFound } from './middleware/handle-error.ts';
import { httpsRedirect } from './middleware/https-redirect.ts';
import { gatesMiddleware } from './middleware/gates.ts';
import { logRequest } from './middleware/log-request.ts';
import { originCheckMiddleware } from './middleware/origin-check.ts';
import { addressHash, rateLimitV1 } from './middleware/rate-limit.ts';
import { requestId } from './middleware/request-id.ts';
import { createRouteMetaIndex } from './middleware/route-meta.ts';
import { secureHeaders } from './middleware/secure-headers.ts';
import { sessionMiddleware } from './middleware/session.ts';
import { requestVariables } from './middleware/variables.ts';
import { documentFor } from './openapi.ts';
import type { OpenApiDocument } from './openapi.ts';
import { createRouter } from './router.ts';
import type { ApiEnv as RouterEnv } from './router.ts';
import { registerRoutes } from './routes/index.ts';

/** Options of `createApp`; every member is optional. */
export type AppOptions = {
  /** Mounts test routes after the route registry; they never enter the served document. */
  extraRoutes?: (app: OpenAPIHono<RouterEnv>) => void;
  /** Attaches the development mailbox's router (E-AUTH-11); false when absent. */
  readonly devMailbox?: boolean;
};

// The session cookie's wire name on HTTPS origins, as the document's `cookie` security scheme names it (D-231).
const SESSION_COOKIE_WIRE_NAME = '__Host-os_session';

/**
 * Builds the API app over `deps` with the middleware chain of L-middleware-chain (D-163). Building
 * it reads nothing from `deps`, opens no connection and starts no timer, so the OpenAPI document can
 * be built from it alone; every middleware reads `deps` per request.
 */
export function createApp(deps: Deps, options: AppOptions = {}): OpenAPIHono<RouterEnv> {
  const app = createRouter();
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'cookie', {
    type: 'apiKey',
    in: 'cookie',
    name: SESSION_COOKIE_WIRE_NAME,
  });

  const index = createRouteMetaIndex();
  app.use('*', requestVariables(deps));
  app.use('*', requestId());
  app.use('*', logRequest(deps));
  app.use('*', addressHash(deps));
  app.use('*', secureHeaders(deps));
  app.use('*', httpsRedirect(deps));
  app.use('/v1/*', clientVersion(deps, index));
  app.use('/v1/*', bodyLimit(deps, index));
  app.use('/v1/*', sessionMiddleware(deps, index));
  app.use('/v1/*', originCheckMiddleware(deps, index));
  app.use('/v1/*', gatesMiddleware(deps, index));
  app.use('/v1/*', rateLimitV1(deps, index, RATE_LIMIT_POLICIES));
  app.use('/v1/*', cacheHeaders(index));

  let document: OpenApiDocument | null = null;
  const getOpenApiDocument = (): OpenApiDocument => {
    if (document === null) {
      throw new Error('The OpenAPI document was read before the app was built');
    }
    return document;
  };
  registerRoutes(
    app,
    deps,
    { routeMiddleware: [], getOpenApiDocument },
    { devMailbox: options.devMailbox ?? false },
  );
  document = documentFor(app);
  options.extraRoutes?.(app);

  index.load(app);
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return app;
}
