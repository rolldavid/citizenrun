import type { MiddlewareHandler } from 'hono';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { parseClientValue } from './client-version.ts';
import { routePattern } from './route-meta.ts';

// The length of the address hash in a log line (D-441).
const LOGGED_ADDR_HASH_LENGTH = 16;
const CLIENT_HEADER = 'X-OS-Client';

/**
 * L-request-log: times the request from receipt until the inner chain has its response (error
 * responses included), sets `Server-Timing: app;dur=<ms>` and writes one `request.done` line with
 * the route pattern and the documented fields only: never the raw path, query, body or address.
 */
export function logRequest(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - start);
    c.header('Server-Timing', `app;dur=${String(durationMs)}`);

    const status = c.res.status;
    const fields: Record<string, unknown> = {
      requestId: c.get('requestId'),
      method: c.req.method,
      route: routePattern(c),
      status,
      durationMs,
    };
    const client = c.req.header(CLIENT_HEADER);
    if (client !== undefined && parseClientValue(client) !== null) {
      fields['client'] = client;
    }
    const addrHash = c.get('addrHash');
    if (typeof addrHash === 'string') {
      fields['addrHash'] = addrHash.slice(0, LOGGED_ADDR_HASH_LENGTH);
    }
    const errorCode = c.get('errorCode');
    if ((status < 200 || status > 299) && typeof errorCode === 'string') {
      fields['errorCode'] = errorCode;
    }
    if (status >= 500) {
      deps.logger.error('request.done', fields);
    } else {
      deps.logger.info('request.done', fields);
    }
  };
}
