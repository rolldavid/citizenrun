// The pipeline's one way out to the network (PIPE-fetch). Every rule of the crawl policy (D-331)
// is applied here, in one request path shared by fetch() and download().
import { Readable } from 'node:stream';
import type { Logger } from '@citizenrun/shared';
import type { DataBucket } from '../bucket.ts';
import { storeRawBody } from './cache.ts';
import { isChallenge } from './challenge.ts';
import type { Clock } from './clock.ts';
import { HostLock } from './host-lock.ts';
import { FALLBACK_ZONE, isElectionNight } from './hours.ts';
import { HostRegistry, hostIsOrUnder, isForbiddenHost, queueForLocalFetch } from './hosts.ts';
import type { BlockReason, SourceHostRules } from './hosts.ts';
import { DailyCapError, HostLimiter } from './rate.ts';
import { ROBOTS_MAX_BYTES, RobotsCache, robotsDecision, robotsDecisionForUrl } from './robots.ts';
import type { RobotsRecord, RobotsVerdict } from './robots.ts';
import type { Transport, TransportResponse } from './transport.ts';
import type { FetchClass, FetchRequest, FetchResult, Fetcher } from './types.ts';
import { assertFetcherMayStart, productToken } from './user-agent.ts';

/** Default body limit of fetch() (PIPE-fetch). */
export const PAGE_MAX_BYTES = 20_000_000;
/** Default body limit of download() (PIPE-fetch). */
export const DOWNLOAD_MAX_BYTES = 200_000_000;
/** Until the response headers arrive (D-331). */
export const HEADERS_TIMEOUT_MS = 15_000;
/** A whole fetch() request (D-331). */
export const PAGE_TIMEOUT_MS = 120_000;
/** A download() with no new bytes for this long stops (D-331). */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
/** Redirects followed for one request (D-331). */
export const MAX_REDIRECTS = 5;
/** Retries after a 429 or 503 (D-326). */
export const MAX_RETRIES = 3;
/** The back-off unit: 2^attempt times this (D-326). */
export const BACKOFF_BASE_MS = 2000;
/** The longest Retry-After honoured (D-326). */
export const RETRY_AFTER_CAP_MS = 3_600_000;
/** A crawl request told to wait longer than this defers its host instead of sleeping (D-884). */
export const CRAWL_DEFER_AFTER_MS = 60_000;
/** The bytes of a 403, 429 or 503 body read for the challenge scan. */
export const CHALLENGE_SCAN_BYTES = 65_536;
/** The only hosts an Authorization header may go to: those of the api.data.gov key (PIPE-fetch). */
export const AUTHORIZATION_HOSTS: readonly string[] = ['api.data.gov', 'api.congress.gov'];

/** A request the fetcher will not make because the caller asked for something it never does. */
export class FetchRequestError extends Error {
  override readonly name = 'FetchRequestError';
}

/** A request to a forbidden host (D-331): a bug in the caller, never a result. */
export class ForbiddenHostError extends Error {
  override readonly name = 'ForbiddenHostError';
  readonly host: string;

  constructor(host: string) {
    super(`forbidden host ${host}`);
    this.host = host;
  }
}

export type FetcherDeps = {
  transport: Transport;
  clock: Clock;
  bucket: DataBucket;
  log: Logger;
  isCi: boolean;
  userAgent: string;
  repoRoot: string;
  hostRules: SourceHostRules;
  zoneForState: (state: string) => string | null;
  electionDatesForState: (state: string) => readonly string[];
  stateDir: string;
};

export type ChallengeEntry = {
  url: string;
  class: FetchClass;
  state: string | null;
  purpose: string;
};

export interface PipelineFetcher extends Fetcher {
  robotsFor(
    url: string,
  ): Promise<{ verdict: RobotsVerdict; decision: 'allowed' | 'disallowed' | 'absent' }>;
  acquireHostSlot(host: string): Promise<() => void>;
  isForbidden(host: string): boolean;
  reportChallenge(host: string, status: number, entry: ChallengeEntry): Promise<void>;
  readonly userAgent: string;
  readonly origin: 'owner_machine' | 'github_runner';
  stoppedHosts(): readonly string[];
}

type Target = { url: URL; upgraded: boolean };

type Mode =
  { kind: 'fetch'; maxBytes: number } | { kind: 'download'; key: string; maxBytes: number };

/** What one request to one URL came to, decided while the host's slot was held. */
type Attempt =
  | { kind: 'final'; result: FetchResult; bytes?: number; cached?: boolean }
  | { kind: 'body'; status: number; headers: Headers; body: Uint8Array }
  | { kind: 'redirect'; status: number; location: string }
  | { kind: 'retry'; status: number; retryAfterMs: number | null; waitMs: number | null }
  | { kind: 'block'; status: number; reason: BlockReason };

/** What the fetch.done line reports. */
type Trace = {
  host: string | null;
  status: number | null;
  robots: 'allowed' | 'disallowed' | 'absent' | 'excepted' | null;
  bytes: number;
  cached: boolean;
};

class TooLargeError extends Error {
  override readonly name = 'TooLargeError';
}

function parseTarget(raw: string): Target {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRequestError('not a URL');
  }
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return { url, upgraded: true };
  }
  if (url.protocol !== 'https:') {
    throw new FetchRequestError('only https URLs are fetched');
  }
  return { url, upgraded: false };
}

function checkHeaders(headers: Readonly<Record<string, string>>, host: string): void {
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'cookie') {
      throw new FetchRequestError('a request never sends a cookie');
    }
    if (lower === 'authorization' && !AUTHORIZATION_HOSTS.includes(host)) {
      throw new FetchRequestError('an Authorization header goes only to the api.data.gov hosts');
    }
  }
}

/** Retry-After as seconds or an HTTP date, in milliseconds, capped at one hour. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  const ms = retryAfterWait(value, nowMs);
  return ms === null ? null : Math.min(ms, RETRY_AFTER_CAP_MS);
}

/** Retry-After as seconds or an HTTP date, in milliseconds, uncapped. */
function retryAfterWait(value: string | null, nowMs: number): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  let ms: number;
  if (/^\d+$/u.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) {
      return null;
    }
    ms = Math.max(0, at - nowMs);
  }
  return ms;
}

/** Reads at most `limit` bytes; `over` is true when the body had more. The rest is cancelled. */
async function readLimited(
  body: AsyncIterable<Uint8Array> | null,
  limit: number,
): Promise<{ bytes: Uint8Array; over: boolean }> {
  if (body === null) {
    return { bytes: new Uint8Array(0), over: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let over = false;
  for await (const chunk of body) {
    if (total + chunk.byteLength > limit) {
      chunks.push(chunk.subarray(0, limit - total));
      total = limit;
      over = true;
      break;
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), over };
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** The fetcher. Refuses to start without the public crawl policy (D-331). */
export function createFetcher(deps: FetcherDeps): PipelineFetcher {
  assertFetcherMayStart(deps.repoRoot);
  const { transport, clock, bucket, log } = deps;
  const limiter = new HostLimiter(clock, new HostLock(deps.stateDir, clock));
  const token = productToken();
  const stopped = new Set<string>();
  // Hosts a crawl request may not contact before the instant a long Retry-After named (D-884).
  const deferred = new Map<string, number>();
  // Hosts that have answered a request other than robots.txt in this run.
  const contacted = new Set<string>();
  let registryLoad: Promise<HostRegistry> | null = null;

  const registry = (): Promise<HostRegistry> => {
    registryLoad ??= (async () => {
      const loaded = new HostRegistry(bucket);
      await loaded.load();
      return loaded;
    })();
    return registryLoad;
  };

  const isForbidden = (host: string): boolean => isForbiddenHost(host, deps.hostRules);

  const baseHeaders = (): Record<string, string> => ({ 'User-Agent': deps.userAgent });

  /** Marks the host in CI and queues the URL; outside CI stops the host for the run (D-087). */
  const block = async (
    host: string,
    status: number,
    reason: BlockReason,
    entry: ChallengeEntry | null,
  ): Promise<void> => {
    log.warn('fetch.host_blocked', { host, status, reason, ci: deps.isCi });
    if (!deps.isCi) {
      stopped.add(host);
      return;
    }
    const nowIso = isoAt(clock.now());
    const found = await registry();
    found.markBlocked(host, status, reason, nowIso);
    await found.save();
    if (entry !== null) {
      await queueForLocalFetch(bucket, host, { ...entry, queued_at: nowIso });
    }
  };

  /** In CI, a host tried again after its 30 days that answered without a block is ok again. */
  const liftIfBlocked = async (host: string, status: number): Promise<void> => {
    if (!deps.isCi) {
      return;
    }
    const found = await registry();
    if (found.entry(host)?.status === 'blocked_from_ci') {
      found.markOk(host, status, isoAt(clock.now()));
      await found.save();
    }
  };

  /** One GET of robots.txt through the host's slot, following up to MAX_REDIRECTS redirects. */
  const fetchRobots = async (host: string): Promise<RobotsRecord> => {
    let url = new URL(`https://${host}/robots.txt`);
    for (let hops = 0; ; hops += 1) {
      const hopHost = url.hostname.toLowerCase();
      if (isForbidden(hopHost)) {
        throw new ForbiddenHostError(hopHost);
      }
      const release = await limiter.acquire(hopHost, utcDate(clock.now()));
      let answer: { status: number | null; body: string; location: string | null };
      try {
        answer = await robotsOnce(url);
      } finally {
        release();
      }
      const fetchedAt = isoAt(clock.now());
      if (answer.location === null) {
        return { fetched_at: fetchedAt, status: answer.status, body: answer.body };
      }
      if (hops + 1 > MAX_REDIRECTS) {
        return { fetched_at: fetchedAt, status: null, body: '' };
      }
      let next: URL;
      try {
        next = new URL(answer.location, url);
      } catch {
        return { fetched_at: fetchedAt, status: null, body: '' };
      }
      if (next.protocol === 'http:') {
        next.protocol = 'https:';
      }
      if (next.protocol !== 'https:') {
        return { fetched_at: fetchedAt, status: null, body: '' };
      }
      url = next;
    }
  };

  const robotsOnce = async (
    url: URL,
  ): Promise<{ status: number | null; body: string; location: string | null }> => {
    const controller = new AbortController();
    const headersTimer = setTimeout(() => {
      controller.abort();
    }, HEADERS_TIMEOUT_MS);
    const totalTimer = setTimeout(() => {
      controller.abort();
    }, PAGE_TIMEOUT_MS);
    try {
      let response: TransportResponse;
      try {
        response = await transport.send({
          url: url.href,
          method: 'GET',
          headers: baseHeaders(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(headersTimer);
      }
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location !== null) {
        return { status: response.status, body: '', location };
      }
      // A status outside HTTP's 100 to 599 is no answer: the host's robots.txt is unavailable.
      if (response.status < 100 || response.status > 599) {
        return { status: null, body: '', location: null };
      }
      const { bytes } = await readLimited(response.body, ROBOTS_MAX_BYTES);
      return { status: response.status, body: Buffer.from(bytes).toString('utf8'), location: null };
    } catch {
      return { status: null, body: '', location: null };
    } finally {
      clearTimeout(totalTimer);
      controller.abort();
    }
  };

  const robots = new RobotsCache({ bucket, clock, fetchRobots });

  /** One request to one URL, with the host's slot held from before the send until it ends. */
  const sendOnce = async (
    target: Target,
    method: 'GET' | 'HEAD' | 'POST',
    headers: Record<string, string>,
    body: Uint8Array | undefined,
    mode: Mode,
    firstRequest: boolean,
    trace: Trace,
  ): Promise<Attempt> => {
    const controller = new AbortController();
    let timedOut = false;
    const abortForTime = () => {
      timedOut = true;
      controller.abort();
    };
    const transportFailure = (): Attempt => {
      if (target.upgraded) {
        return { kind: 'final', result: { kind: 'disallowed', reason: 'not_https' } };
      }
      return {
        kind: 'final',
        result: { kind: 'error', status: null, reason: timedOut ? 'timeout' : 'network' },
      };
    };
    const headersTimer = setTimeout(abortForTime, HEADERS_TIMEOUT_MS);
    const totalTimer = mode.kind === 'fetch' ? setTimeout(abortForTime, PAGE_TIMEOUT_MS) : null;
    try {
      let response: TransportResponse;
      try {
        response = await transport.send({
          url: target.url.href,
          method,
          headers,
          signal: controller.signal,
          ...(body === undefined ? {} : { body }),
        });
      } catch {
        return transportFailure();
      } finally {
        clearTimeout(headersTimer);
      }
      const { status } = response;
      trace.status = status;
      if (status >= 300 && status < 400 && status !== 304) {
        const location = response.headers.get('location');
        if (location !== null) {
          return { kind: 'redirect', status, location };
        }
        return { kind: 'final', result: { kind: 'error', status, reason: 'http_status' } };
      }
      if (status === 304) {
        return { kind: 'final', result: { kind: 'not_modified', finalUrl: target.url.href } };
      }
      if (status === 403 || status === 429 || status === 503) {
        let scan: Uint8Array;
        try {
          scan = (await readLimited(response.body, CHALLENGE_SCAN_BYTES)).bytes;
        } catch {
          scan = new Uint8Array(0);
        }
        if (isChallenge(status, Buffer.from(scan).toString('utf8'))) {
          return { kind: 'block', status, reason: 'challenge' };
        }
        if (status === 403) {
          return firstRequest
            ? { kind: 'block', status, reason: 'first_request_403' }
            : { kind: 'final', result: { kind: 'error', status, reason: 'http_status' } };
        }
        return {
          kind: 'retry',
          status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), clock.now()),
          waitMs: retryAfterWait(response.headers.get('retry-after'), clock.now()),
        };
      }
      if (status < 200 || status >= 300) {
        return { kind: 'final', result: { kind: 'error', status, reason: 'http_status' } };
      }
      if (mode.kind === 'fetch') {
        let read: { bytes: Uint8Array; over: boolean };
        try {
          read = await readLimited(response.body, mode.maxBytes);
        } catch {
          return transportFailure();
        }
        if (read.over) {
          return { kind: 'final', result: { kind: 'error', status, reason: 'too_large' } };
        }
        return { kind: 'body', status, headers: response.headers, body: read.bytes };
      }
      return await streamToBucket(response, mode, target, controller, abortForTime, trace, () =>
        transportFailure(),
      );
    } finally {
      if (totalTimer !== null) {
        clearTimeout(totalTimer);
      }
      controller.abort();
    }
  };

  const streamToBucket = async (
    response: TransportResponse,
    mode: Extract<Mode, { kind: 'download' }>,
    target: Target,
    controller: AbortController,
    onIdle: () => void,
    trace: Trace,
    transportFailure: () => Attempt,
  ): Promise<Attempt> => {
    const { status } = response;
    const source = response.body;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idle !== null) {
        clearTimeout(idle);
      }
      idle = setTimeout(onIdle, DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    let counted = 0;
    // Set inside the generator, read after the upload fails.
    const failure = { tooLarge: false, bodyFailed: false };
    async function* limited(): AsyncGenerator<Uint8Array> {
      resetIdle();
      try {
        if (source === null) {
          return;
        }
        for await (const chunk of source) {
          counted += chunk.byteLength;
          if (counted > mode.maxBytes) {
            failure.tooLarge = true;
            controller.abort();
            throw new TooLargeError('too_large');
          }
          resetIdle();
          yield chunk;
        }
      } catch (error) {
        if (!failure.tooLarge) {
          failure.bodyFailed = true;
        }
        throw error;
      } finally {
        if (idle !== null) {
          clearTimeout(idle);
        }
      }
    }
    const contentType = response.headers.get('content-type');
    try {
      const written = await bucket.putStream(
        mode.key,
        Readable.from(limited(), { objectMode: false }),
        contentType ?? 'application/octet-stream',
      );
      trace.bytes = written.bytes;
      return {
        kind: 'final',
        result: {
          kind: 'ok',
          finalUrl: target.url.href,
          status,
          contentType,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          sha256: written.sha256,
          bytes: written.bytes,
          cacheKey: mode.key,
        },
      };
    } catch (error) {
      if (failure.tooLarge) {
        return { kind: 'final', result: { kind: 'error', status, reason: 'too_large' } };
      }
      if (failure.bodyFailed) {
        return transportFailure();
      }
      throw error;
    }
  };

  /** Rules 1 to 11 for one request and every hop and retry it leads to. */
  const requestPath = async (req: FetchRequest, mode: Mode, trace: Trace): Promise<FetchResult> => {
    const entry: ChallengeEntry = {
      url: req.url,
      class: req.class,
      state: req.state ?? null,
      purpose: req.purpose ?? 'cache',
    };
    let target = parseTarget(req.url);
    let method = req.method ?? 'GET';
    let body = req.body;
    const extraHeaders = req.headers ?? {};
    for (let hops = 0; ;) {
      const host = target.url.hostname.toLowerCase();
      trace.host = host;
      checkHeaders(extraHeaders, host);
      if (isForbidden(host)) {
        throw new ForbiddenHostError(host);
      }
      if (stopped.has(host)) {
        return { kind: 'disallowed', reason: 'blocked_host' };
      }
      const now = clock.now();
      if (req.class === 'crawl') {
        const until = deferred.get(host);
        if (until !== undefined && now < until) {
          return { kind: 'disallowed', reason: 'retry_later' };
        }
        deferred.delete(host);
      }
      if (deps.isCi && (await registry()).isBlocked(host, now)) {
        await queueForLocalFetch(bucket, host, { ...entry, queued_at: isoAt(now) });
        return { kind: 'disallowed', reason: 'blocked_host' };
      }
      const zone = (req.state === undefined ? null : deps.zoneForState(req.state)) ?? FALLBACK_ZONE;
      if (
        req.class === 'adapter' &&
        deps.hostRules.resultsHosts.some((listed) => hostIsOrUnder(host, listed)) &&
        isElectionNight(
          now,
          zone,
          req.state === undefined ? [] : deps.electionDatesForState(req.state),
        )
      ) {
        return { kind: 'disallowed', reason: 'election_night' };
      }

      let verdict: RobotsVerdict;
      try {
        verdict = await robots.verdict(host);
      } catch (error) {
        if (error instanceof DailyCapError) {
          return { kind: 'disallowed', reason: 'daily_cap' };
        }
        throw error;
      }
      switch (verdict.kind) {
        case 'unavailable':
          return { kind: 'disallowed', reason: 'robots_unavailable' };
        case 'challenge': {
          const status = verdict.status ?? 0;
          trace.status = status;
          await block(host, status, 'challenge', entry);
          return { kind: 'challenge', status };
        }
        case 'absent':
          trace.robots = 'absent';
          break;
        case 'rules': {
          // An excepted endpoint (D-871) passes a `*`-group disallow, never one for our token.
          const decision = robotsDecisionForUrl(verdict.rules ?? { groups: [] }, token, target.url);
          trace.robots = decision;
          if (decision === 'disallowed') {
            return { kind: 'disallowed', reason: 'robots' };
          }
          break;
        }
      }

      // The user agent is always ours: a caller's User-Agent header is dropped.
      const headers: Record<string, string> = Object.fromEntries(
        Object.entries(extraHeaders).filter(([name]) => name.toLowerCase() !== 'user-agent'),
      );
      const conditional = req.conditional;
      if (conditional !== undefined && conditional.etag !== null) {
        headers['If-None-Match'] = conditional.etag;
      }
      if (conditional !== undefined && conditional.lastModified !== null) {
        headers['If-Modified-Since'] = conditional.lastModified;
      }
      Object.assign(headers, baseHeaders());

      let attempt = 0;
      let consecutive429 = 0;
      let outcome: Attempt;
      for (;;) {
        const firstRequest = !contacted.has(host);
        let release: () => void;
        try {
          release = await limiter.acquire(host, utcDate(clock.now()));
        } catch (error) {
          if (error instanceof DailyCapError) {
            return { kind: 'disallowed', reason: 'daily_cap' };
          }
          throw error;
        }
        try {
          outcome = await sendOnce(target, method, headers, body, mode, firstRequest, trace);
        } finally {
          release();
        }
        if (trace.status !== null) {
          contacted.add(host);
        }
        if (outcome.kind !== 'retry') {
          break;
        }
        if (
          req.class === 'crawl' &&
          outcome.waitMs !== null &&
          outcome.waitMs > CRAWL_DEFER_AFTER_MS
        ) {
          deferred.set(host, clock.now() + outcome.waitMs);
          return { kind: 'disallowed', reason: 'retry_later' };
        }
        if (attempt > 0) {
          consecutive429 = outcome.status === 429 ? consecutive429 + 1 : 0;
        }
        if (attempt >= MAX_RETRIES) {
          break;
        }
        attempt += 1;
        const backoff = 2 ** attempt * BACKOFF_BASE_MS;
        await clock.sleep(Math.max(outcome.retryAfterMs ?? 0, backoff));
      }

      switch (outcome.kind) {
        case 'retry':
          // The retries are spent. Three 429s in a row after back-off block the host (D-326).
          if (outcome.status === 429 && consecutive429 >= MAX_RETRIES) {
            await block(host, outcome.status, 'repeated_429', entry);
            return { kind: 'challenge', status: outcome.status };
          }
          return { kind: 'error', status: outcome.status, reason: 'http_status' };
        case 'block':
          await block(host, outcome.status, outcome.reason, entry);
          return { kind: 'challenge', status: outcome.status };
        case 'redirect': {
          await liftIfBlocked(host, outcome.status);
          hops += 1;
          if (hops > MAX_REDIRECTS) {
            return { kind: 'error', status: outcome.status, reason: 'too_many_redirects' };
          }
          let next: URL;
          try {
            next = new URL(outcome.location, target.url);
          } catch {
            return { kind: 'error', status: outcome.status, reason: 'http_status' };
          }
          let upgraded = false;
          if (next.protocol === 'http:') {
            next.protocol = 'https:';
            upgraded = true;
          }
          if (next.protocol !== 'https:') {
            return { kind: 'error', status: outcome.status, reason: 'http_status' };
          }
          if (
            outcome.status === 303 ||
            (outcome.status !== 307 && outcome.status !== 308 && method === 'POST')
          ) {
            method = method === 'HEAD' ? 'HEAD' : 'GET';
            body = undefined;
          }
          target = { url: next, upgraded };
          continue;
        }
        case 'final':
          if (trace.status !== null) {
            await liftIfBlocked(host, trace.status);
          }
          return outcome.result;
        case 'body': {
          await liftIfBlocked(host, outcome.status);
          const contentType = outcome.headers.get('content-type');
          const stored = await storeRawBody(bucket, outcome.body, contentType);
          trace.bytes = outcome.body.byteLength;
          trace.cached = stored.cached;
          return {
            kind: 'ok',
            finalUrl: target.url.href,
            status: outcome.status,
            contentType,
            etag: outcome.headers.get('etag'),
            lastModified: outcome.headers.get('last-modified'),
            sha256: stored.sha256,
            bytes: outcome.body.byteLength,
            cacheKey: stored.key,
          };
        }
      }
    }
  };

  const run = async (req: FetchRequest, mode: Mode): Promise<FetchResult> => {
    const started = clock.now();
    const trace: Trace = { host: null, status: null, robots: null, bytes: 0, cached: false };
    const result = await requestPath(req, mode, trace);
    log.info('fetch.done', {
      host: trace.host,
      class: req.class,
      status: result.kind === 'disallowed' ? null : trace.status,
      result: result.kind,
      ...(result.kind === 'disallowed' || result.kind === 'error' ? { reason: result.reason } : {}),
      ...(trace.robots === null ? {} : { robots: trace.robots }),
      bytes: trace.bytes,
      durationMs: clock.now() - started,
      cached: trace.cached,
    });
    return result;
  };

  return {
    userAgent: deps.userAgent,
    origin: deps.isCi ? 'github_runner' : 'owner_machine',
    fetch(req) {
      return run(req, { kind: 'fetch', maxBytes: req.maxBytes ?? PAGE_MAX_BYTES });
    },
    download(req, key) {
      return run(req, { kind: 'download', key, maxBytes: req.maxBytes ?? DOWNLOAD_MAX_BYTES });
    },
    async robotsFor(url) {
      const { url: parsed } = parseTarget(url);
      const host = parsed.hostname.toLowerCase();
      if (isForbidden(host)) {
        throw new ForbiddenHostError(host);
      }
      if (stopped.has(host)) {
        return {
          verdict: { status: null, kind: 'challenge', rules: null },
          decision: 'disallowed',
        };
      }
      let verdict: RobotsVerdict;
      try {
        verdict = await robots.verdict(host);
      } catch (error) {
        if (error instanceof DailyCapError) {
          return {
            verdict: { status: null, kind: 'unavailable', rules: null },
            decision: 'disallowed',
          };
        }
        throw error;
      }
      switch (verdict.kind) {
        case 'rules':
          return {
            verdict,
            decision: robotsDecision(
              verdict.rules ?? { groups: [] },
              token,
              `${parsed.pathname}${parsed.search}`,
            ),
          };
        case 'absent':
          return { verdict, decision: 'absent' };
        case 'challenge':
          await block(host, verdict.status ?? 0, 'challenge', null);
          return { verdict, decision: 'disallowed' };
        case 'unavailable':
          return { verdict, decision: 'disallowed' };
      }
    },
    acquireHostSlot(host) {
      return limiter.acquire(host.toLowerCase(), utcDate(clock.now()));
    },
    isForbidden,
    async reportChallenge(host, status, entry) {
      await block(host.toLowerCase(), status, 'challenge', entry);
    },
    stoppedHosts() {
      return [...stopped].sort();
    },
  };
}
