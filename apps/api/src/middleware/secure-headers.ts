import type { MiddlewareHandler } from 'hono';
import { secureHeaders as honoSecureHeaders } from 'hono/secure-headers';
import { V1_CSP } from '../config/csp.ts';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { isV1Path } from './route-meta.ts';

const HSTS = 'max-age=31536000; includeSubDomains'; // CTL-01
const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()';
// The paths whose responses other sites may embed (L-security-headers).
const CROSS_ORIGIN_PREFIXES: readonly string[] = ['/og/', '/m/', '/.well-known/'];
const WS_PATH = '/v1/ws';

// Hono's headers middleware with exactly the values of L-security-headers and every other default
// off, built once per dependencies object on its first request.
const honoHeadersByDeps = new WeakMap<Deps, MiddlewareHandler>();

function honoHeadersFor(deps: Deps): MiddlewareHandler {
  let headers = honoHeadersByDeps.get(deps);
  if (headers === undefined) {
    const https = new URL(deps.env.PUBLIC_URL).protocol === 'https:';
    headers = honoSecureHeaders({
      strictTransportSecurity: https ? HSTS : false,
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'strict-origin-when-cross-origin', // never no-referrer (INV-59)
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
      originAgentCluster: '?1',
      xDnsPrefetchControl: 'off',
      xDownloadOptions: 'noopen',
      xPermittedCrossDomainPolicies: 'none',
      xXssProtection: '0',
      // Set below per path, or never set here.
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
      permissionsPolicy: {},
      removePoweredBy: true,
    });
    honoHeadersByDeps.set(deps, headers);
  }
  return headers;
}

function isCrossOriginPath(path: string): boolean {
  return CROSS_ORIGIN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * L-security-headers (CTL-01, CTL-02, INV-59) on every response except `/v1/ws`: the fixed headers,
 * `Cross-Origin-Resource-Policy` by path, the restrictive policy on `/v1` responses, the permissions
 * policy on HTML, and `X-Robots-Tag: noindex` where the environment is not indexable. A policy a
 * handler set itself is kept, and no other response gets one here.
 */
export function secureHeaders(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const path = c.req.path;
    if (path === WS_PATH) {
      await next();
      return;
    }
    await honoHeadersFor(deps)(c, next);

    const headers = c.res.headers;
    headers.set(
      'Cross-Origin-Resource-Policy',
      isCrossOriginPath(path) ? 'cross-origin' : 'same-origin',
    );
    if (isV1Path(path) && !headers.has('Content-Security-Policy')) {
      headers.set('Content-Security-Policy', V1_CSP);
    }
    if ((headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html')) {
      headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    }
    if (!deps.env.isIndexable) {
      headers.set('X-Robots-Tag', 'noindex');
    }
  };
}
