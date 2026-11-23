import type { MiddlewareHandler } from 'hono';
import { ApiError } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { isV1Path } from './route-meta.ts';

const PLAIN_TEXT = 'text/plain; charset=utf-8';

/**
 * CTL-01: on a deployed environment a request the edge received over `http` is sent to `https`.
 * `GET` and `HEAD` answer 308 to the same path and query on `PUBLIC_URL`'s origin (never the `Host`
 * header); every other method answers 400 `invalid_request`.
 */
export function httpsRedirect(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const proto = c.req.header('X-Forwarded-Proto');
    if (!deps.env.redirectHttp || proto?.trim().toLowerCase() !== 'http') {
      await next();
      return;
    }
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD') {
      const url = new URL(c.req.url);
      const location = `${new URL(deps.env.PUBLIC_URL).origin}${url.pathname}${url.search}`;
      return c.redirect(location, 308);
    }
    if (isV1Path(c.req.path)) {
      throw new ApiError('invalid_request');
    }
    c.set('errorCode', 'invalid_request');
    return c.text('Bad request', 400, { 'Content-Type': PLAIN_TEXT });
  };
}
