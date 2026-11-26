import { BRAND, CENSUS_TIMEOUT_MS, GEO_PROVIDER_TIMEOUT_MS } from '@citizenrun/shared';
import type { ApiEnv } from '../env.ts';

/** The fixed hosts the API calls (INV-39); the media bucket host comes from the environment. */
export const OUTBOUND_HOSTS = {
  resend: 'api.resend.com',
  apple: 'appleid.apple.com',
  google: 'www.googleapis.com',
  census: 'geocoding.geo.census.gov',
  geoapify: 'api.geoapify.com',
} as const;
/** Every outbound call settles or is abandoned within its host's time (CTL-37). */
export const OUTBOUND_TIMEOUT_MS = {
  resend: 10_000,
  bucket: 30_000,
  apple: 5_000,
  google: 5_000,
  census: CENSUS_TIMEOUT_MS,
  geoapify: GEO_PROVIDER_TIMEOUT_MS,
} as const; // CTL-37

// CTL-37: `<slug>-api/<version>`.
const USER_AGENT = `${BRAND.slug}-api/0.0.0`;

// Headers a client's request carries that never travel to an outside host (CTL-37). The rate
// limiter's address header joins them from the environment.
const CLIENT_REQUEST_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'origin',
  'referer',
  'forwarded',
  'x-forwarded-for',
  'x-real-ip',
  'x-os-client',
  'x-request-id',
];

/** A request to a host outside the API's list; thrown before any connection opens. */
export class OutboundHostNotAllowedError extends Error {
  override readonly name = 'OutboundHostNotAllowedError';

  constructor() {
    super('The host is not on the API outbound list.');
  }
}

/** The one way API code calls an outside host: a fixed host and a path starting with `/`. */
export type OutboundFetch = (host: string, path: string, init?: RequestInit) => Promise<Response>;

// The media bucket's host as the S3 client addresses it: the endpoint's host with path-style
// addressing, the bucket's virtual host otherwise.
function mediaBucketHost(env: ApiEnv): string {
  const host = new URL(env.MEDIA_ENDPOINT).host;
  return env.S3_FORCE_PATH_STYLE ? host : `${env.MEDIA_BUCKET}.${host}`;
}

/** OUTBOUND_HOSTS plus the media bucket host from MEDIA_ENDPOINT and MEDIA_BUCKET. */
export function allowedHosts(env: ApiEnv): ReadonlySet<string> {
  return new Set<string>([...Object.values(OUTBOUND_HOSTS), mediaBucketHost(env)]);
}

function timeoutFor(host: string): number {
  switch (host) {
    case OUTBOUND_HOSTS.resend:
      return OUTBOUND_TIMEOUT_MS.resend;
    case OUTBOUND_HOSTS.apple:
      return OUTBOUND_TIMEOUT_MS.apple;
    case OUTBOUND_HOSTS.google:
      return OUTBOUND_TIMEOUT_MS.google;
    case OUTBOUND_HOSTS.census:
      return OUTBOUND_TIMEOUT_MS.census;
    case OUTBOUND_HOSTS.geoapify:
      return OUTBOUND_TIMEOUT_MS.geoapify;
    default:
      return OUTBOUND_TIMEOUT_MS.bucket;
  }
}

/**
 * The API's outbound fetch (INV-39): refuses a host outside `allowedHosts(env)` and a path that
 * does not start with `/` before calling `fetchImpl`, then calls `https://<host><path>` with the
 * service `User-Agent` and the host's timeout, which applies beside the caller's own signal. It
 * drops every header of a client's request (CTL-37) and never follows a redirect: a 3xx answer
 * rejects as a network error (D-851). The only place in the API's source that calls the global
 * fetch.
 */
export function createOutboundFetch(
  env: ApiEnv,
  fetchImpl: typeof fetch = globalThis.fetch,
): OutboundFetch {
  const hosts = allowedHosts(env);
  const dropped = new Set(CLIENT_REQUEST_HEADERS);
  if (env.CLIENT_IP_HEADER !== null) {
    dropped.add(env.CLIENT_IP_HEADER);
  }
  return async (host, path, init = {}) => {
    if (!hosts.has(host)) {
      throw new OutboundHostNotAllowedError();
    }
    if (!path.startsWith('/')) {
      throw new TypeError('An outbound path must start with a slash.');
    }
    const headers = new Headers(init.headers);
    for (const name of dropped) {
      headers.delete(name);
    }
    headers.set('User-Agent', USER_AGENT);
    const timeout = AbortSignal.timeout(timeoutFor(host));
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    // `redirect` after the spread, so no caller can turn following back on (D-851).
    return fetchImpl(`https://${host}${path}`, { ...init, headers, signal, redirect: 'error' });
  };
}
