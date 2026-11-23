import type { MiddlewareHandler } from 'hono';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import type { ClientValue } from './client-version.ts';

// The request variables the middleware chain adds to the router's context type (L-middleware-chain).
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    addrHash: string | null;
    client: { value: ClientValue; raw: string } | null;
    errorCode: string | null;
    retryAfterSeconds: number | null;
  }
}

/**
 * The chain's first middleware: on every request it sets the response mode from the environment
 * (strict under the test runtime, stripping otherwise) and starts the nullable variables at null.
 */
export function requestVariables(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    c.set('respondMode', deps.env.strictResponses ? 'strict' : 'strip');
    c.set('addrHash', null);
    c.set('client', null);
    c.set('errorCode', null);
    c.set('retryAfterSeconds', null);
    await next();
  };
}
