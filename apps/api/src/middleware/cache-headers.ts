import type { MiddlewareHandler } from 'hono';
import { CACHE_CONTROL_BY_OPERATION } from '../config/cache-headers.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import type { RouteMetaIndex } from './route-meta.ts';

const NO_STORE = 'no-store';

/**
 * L-cache-headers for `/v1`, first matching row: an error is `no-store`; an operation with its own
 * row gets that value; a response that already has `Cache-Control` keeps it; anything else is
 * `no-store`.
 */
export function cacheHeaders(index: RouteMetaIndex): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    await next();
    if (c.res.status >= 400) {
      c.header('Cache-Control', NO_STORE);
      return;
    }
    const operationId = index.match(c)?.operationId;
    const own = operationId === undefined ? undefined : CACHE_CONTROL_BY_OPERATION[operationId];
    if (own !== undefined) {
      c.header('Cache-Control', own);
      return;
    }
    if (c.res.headers.has('Cache-Control')) {
      return;
    }
    c.header('Cache-Control', NO_STORE);
  };
}
