import type { MiddlewareHandler } from 'hono';
import { newId } from '@citizenrun/shared';
import type { ApiEnv as RouterEnv } from '../router.ts';

const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * L-request-id: one new id per request, on the context and as `X-Request-Id` on every response,
 * success or error. An id the caller sends is ignored.
 */
export function requestId(): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const id = newId();
    c.set('requestId', id);
    c.header(REQUEST_ID_HEADER, id);
    await next();
    // Again after the chain, so a response the error handler built carries it too.
    c.header(REQUEST_ID_HEADER, id);
  };
}
