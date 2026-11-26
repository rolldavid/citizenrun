import type { MiddlewareHandler } from 'hono';
import { ApiError } from '@citizenrun/shared';
import type { RouteMeta } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import type { ApiEnv } from '../env.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { parseClientValue } from './client-version.ts';
import type { RouteMetaIndex } from './route-meta.ts';
import { readSessionCookie } from './session-cookie.ts';
import type { SessionOptions } from './session-cookie.ts';
import { publicSessionOptions } from './session.ts';

// The methods the check never applies to (L-origin-check).
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const WEB_CLIENT = 'web';
const WEB_CLIENT_PREFIX = 'web/';

/** The origins a cookie or browser write may come from: `PUBLIC_URL` alone (D-801). */
export function webOrigins(env: Pick<ApiEnv, 'PUBLIC_URL'>): readonly string[] {
  return [env.PUBLIC_URL];
}

function namesWeb(client: string | null): boolean {
  return client !== null && (client === WEB_CLIENT || client.startsWith(WEB_CLIENT_PREFIX));
}

/**
 * L-origin-check (CTL-10), in its order: a read, an exempt route and a bearer request pass. A
 * request with the session cookie, an `Origin`, or an `X-OS-Client` that is missing, unparseable or
 * names `web` passes only when `Origin` is exactly one of `origins` and the client names `web`. A
 * phone's call with neither cookie nor `Origin` passes.
 */
export function originAllowed(input: {
  method: string;
  meta: RouteMeta;
  hasAuthorization: boolean;
  hasSessionCookie: boolean;
  origin: string | null;
  client: string | null;
  origins: readonly string[];
}): boolean {
  if (READ_METHODS.has(input.method)) {
    return true;
  }
  if (input.meta.originCheck === 'exempt') {
    return true;
  }
  if (input.hasAuthorization) {
    return true;
  }
  const parsed = parseClientValue(input.client);
  const browserLike =
    input.hasSessionCookie ||
    input.origin !== null ||
    parsed === null ||
    parsed.platform === WEB_CLIENT;
  if (!browserLike) {
    return true;
  }
  return input.origin !== null && input.origins.includes(input.origin) && namesWeb(input.client);
}

/**
 * The request-forgery check for `/v1` (L-origin-check, D-231): refuses a write that fails
 * `originAllowed` with 403 `origin_rejected` before the gates and the handler. `origins` defaults to
 * `webOrigins(env)` and `session` to the public cookie; another service passes its own (D-801). A
 * request no route's metadata matches is passed on (D-854).
 */
export function originCheckMiddleware(
  deps: Deps,
  index: RouteMetaIndex,
  origins?: readonly string[],
  session?: SessionOptions,
): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const meta = index.match(c);
    if (meta !== null) {
      const allowed = originAllowed({
        method: c.req.method,
        meta,
        hasAuthorization: c.req.header('Authorization') !== undefined,
        hasSessionCookie:
          readSessionCookie(c, session ?? publicSessionOptions(deps.env.PUBLIC_URL)) !== undefined,
        origin: c.req.header('Origin') ?? null,
        client: c.req.header('X-OS-Client') ?? null,
        origins: origins ?? webOrigins(deps.env),
      });
      if (!allowed) {
        throw new ApiError('origin_rejected');
      }
    }
    await next();
  };
}
