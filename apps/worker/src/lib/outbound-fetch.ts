import { BRAND } from '@citizenrun/shared';
import type { WorkerEnv } from '../env.ts';
import { bucketHost } from './storage.ts';

/** The fixed hosts the worker calls (INV-39); the bucket hosts come from the environment. */
export const OUTBOUND_HOSTS = { resend: 'api.resend.com', apple: 'appleid.apple.com' } as const;
/** Every outbound call settles or is abandoned within its host's time (CTL-37). */
export const OUTBOUND_TIMEOUT_MS = {
  resend: 10_000,
  apple: 5_000, // CTL-37
  bucket: 30_000,
} as const;

// CTL-37: `<slug>-worker/<version>`.
const USER_AGENT = `${BRAND.slug}-worker/0.0.0`;

/** A request to a host outside the worker's list; thrown before any connection opens. */
export class OutboundHostNotAllowedError extends Error {
  override readonly name = 'OutboundHostNotAllowedError';

  constructor() {
    super('The host is not on the worker outbound list.');
  }
}

/** The one way a worker job calls an outside host: a fixed host and a path starting with `/`. */
export type OutboundFetch = (host: string, path: string, init?: RequestInit) => Promise<Response>;

/** OUTBOUND_HOSTS plus the host of every bucket the worker holds keys for (`BACKUPS_*`, `MEDIA_*`). */
export function allowedHosts(env: WorkerEnv): ReadonlySet<string> {
  return new Set<string>([
    ...Object.values(OUTBOUND_HOSTS),
    bucketHost({
      bucket: env.BACKUPS_BUCKET,
      endpoint: env.BACKUPS_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
    bucketHost({
      bucket: env.MEDIA_BUCKET,
      endpoint: env.MEDIA_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
  ]);
}

function timeoutFor(host: string): number {
  switch (host) {
    case OUTBOUND_HOSTS.resend:
      return OUTBOUND_TIMEOUT_MS.resend;
    case OUTBOUND_HOSTS.apple:
      return OUTBOUND_TIMEOUT_MS.apple;
    default:
      return OUTBOUND_TIMEOUT_MS.bucket;
  }
}

/**
 * The worker's outbound fetch (INV-39): refuses a host outside `allowedHosts(env)` and a
 * path that does not start with `/` before calling `fetchImpl`, then calls `https://<host><path>`
 * with the service `User-Agent` and the host's timeout, which applies beside the caller's own
 * signal. It never follows a redirect: a 3xx answer rejects as a network error (D-851). It adds no
 * header it was not given. The only place in the worker's source that calls the global fetch.
 */
export function createOutboundFetch(
  env: WorkerEnv,
  fetchImpl: typeof fetch = globalThis.fetch,
): OutboundFetch {
  const hosts = allowedHosts(env);
  return async (host, path, init = {}) => {
    if (!hosts.has(host)) {
      throw new OutboundHostNotAllowedError();
    }
    if (!path.startsWith('/')) {
      throw new TypeError('An outbound path must start with a slash.');
    }
    const headers = new Headers(init.headers);
    headers.set('User-Agent', USER_AGENT);
    const timeout = AbortSignal.timeout(timeoutFor(host));
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    // `redirect` after the spread, so no caller can turn following back on (D-851).
    return fetchImpl(`https://${host}${path}`, { ...init, headers, signal, redirect: 'error' });
  };
}
