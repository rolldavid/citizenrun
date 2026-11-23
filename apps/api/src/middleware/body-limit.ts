import type { MiddlewareHandler } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import { ApiError } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import type { RouteMetaIndex } from './route-meta.ts';

/** The body limit of a `/v1` route that states none. */
export const DEFAULT_BODY_LIMIT_BYTES = 65_536; // L-body-limit

const LIMITED_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * L-body-limit for `/v1`: a write to a matched operation may carry at most its `bodyLimitBytes`
 * (default 65,536), checked from `Content-Length` and while reading; over it is 413
 * `payload_too_large`.
 */
export function bodyLimit(_deps: Deps, index: RouteMetaIndex): MiddlewareHandler<RouterEnv> {
  const byLimit = new Map<number, MiddlewareHandler<RouterEnv>>();
  const limiterFor = (maxSize: number): MiddlewareHandler<RouterEnv> => {
    let limiter = byLimit.get(maxSize);
    if (limiter === undefined) {
      limiter = honoBodyLimit({
        maxSize,
        onError: () => {
          throw new ApiError('payload_too_large');
        },
      });
      byLimit.set(maxSize, limiter);
    }
    return limiter;
  };
  return async (c, next) => {
    if (!LIMITED_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    const meta = index.match(c);
    if (meta === null) {
      await next();
      return;
    }
    return limiterFor(meta.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES)(c, next);
  };
}
