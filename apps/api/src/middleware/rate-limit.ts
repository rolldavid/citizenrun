import { createHmac, randomBytes } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from '@citizenrun/shared';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import type { RateLimitPolicyName, RateLimitRule } from '../config/rate-limits.ts';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import type { RouteMetaIndex } from './route-meta.ts';

/** The policy of a `/v1` request that no route's metadata matches; every table given to `rateLimitV1` holds it. */
export const UNMATCHED_V1_POLICY = 'v1.unmatched' satisfies RateLimitPolicyName; // D-854

/** The most keys one replica's memory store holds. */
export const MEMORY_STORE_MAX_KEYS = 100_000; // D-422

type Window = RateLimitRule['window'];

/** Per-replica counts for the current window of each key (L-rate-limit-memory). */
export type MemoryStore = {
  hit(key: string, window: Window, now: Date): { count: number; windowEnd: Date } | 'full';
};

/** A policy table in the rule format of L-rate-limit-memory: the API's own, or another server's. */
export type RateLimitPolicyTable = Readonly<Record<string, readonly RateLimitRule[]>>;

type CheckInput = { policy: string; userId: string | null; addrHash: string | null; now: Date };
type CheckResult = { ok: true } | { ok: false; retryAfterSeconds: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS: Readonly<Record<Window, number>> = {
  '1m': MINUTE_MS,
  '1h': HOUR_MS,
  '1d': DAY_MS,
};
// The address-hash key: 32 random bytes per dependencies object, held in memory only.
const HASH_KEY_BYTES = 32;
// The key segment of requests with no usable address, which therefore share one bucket.
const NO_ADDRESS = 'none';
const PLAIN_TEXT = 'text/plain; charset=utf-8';

// Windows are fixed and aligned to UTC: the start of the minute, the hour or the day.
function windowStartMs(window: Window, now: Date): number {
  const ms = now.getTime();
  return ms - (((ms % WINDOW_MS[window]) + WINDOW_MS[window]) % WINDOW_MS[window]);
}

/**
 * A memory store of at most `maxKeys` keys; when full it drops past windows, then refuses new keys.
 * It keeps the earliest window end it holds, so a full store walks its keys only once a window has
 * ended since the last walk, not on every new key (CTL-39).
 */
export function createMemoryStore(maxKeys: number = MEMORY_STORE_MAX_KEYS): MemoryStore {
  const entries = new Map<string, { windowStart: number; windowEnd: number; count: number }>();
  // No entry ends before this instant: an entry's end only moves later, and a walk recomputes it.
  let earliestEnd = Number.POSITIVE_INFINITY;
  return {
    hit(key, window, now) {
      const windowStart = windowStartMs(window, now);
      const windowEnd = windowStart + WINDOW_MS[window];
      const entry = entries.get(key);
      if (entry !== undefined && entry.windowStart === windowStart) {
        entry.count += 1;
        return { count: entry.count, windowEnd: new Date(windowEnd) };
      }
      if (entry === undefined && entries.size >= maxKeys) {
        const nowMs = now.getTime();
        if (nowMs < earliestEnd) {
          return 'full';
        }
        earliestEnd = Number.POSITIVE_INFINITY;
        for (const [other, value] of entries) {
          if (value.windowEnd <= nowMs) {
            entries.delete(other);
          } else {
            earliestEnd = Math.min(earliestEnd, value.windowEnd);
          }
        }
        if (entries.size >= maxKeys) {
          return 'full';
        }
      }
      entries.set(key, { windowStart, windowEnd, count: 1 });
      earliestEnd = Math.min(earliestEnd, windowEnd);
      return { count: 1, windowEnd: new Date(windowEnd) };
    },
  };
}

// One memory store and one address-hash key per dependencies object (each app, each replica),
// made on first use.
type LimiterState = { store: MemoryStore; hashKey: Buffer };
const stateByDeps = new WeakMap<Deps, LimiterState>();

function stateFor(deps: Deps): LimiterState {
  let state = stateByDeps.get(deps);
  if (state === undefined) {
    state = { store: createMemoryStore(), hashKey: randomBytes(HASH_KEY_BYTES) };
    stateByDeps.set(deps, state);
  }
  return state;
}

// The eight 16-bit groups of an IPv6 address that node:net accepts, an IPv4 tail included.
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    if (!isIPv4(last)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = last.split('.').map(Number);
    tail.push(a * 256 + b, c * 256 + d);
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) {
      text = text.slice(0, -1);
    }
  }
  const parts = text.split('::');
  if (parts.length > 2) {
    return null;
  }
  const parse = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((group) => parseInt(group, 16));
  const head = parse(parts[0]);
  const rest = parse(parts[1]);
  let groups = head;
  if (parts.length === 2) {
    const missing = 8 - tail.length - head.length - rest.length;
    if (missing < 0) {
      return null;
    }
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  }
  groups = [...groups, ...tail];
  return groups.length === 8 ? groups : null;
}

/**
 * The interim address normaliser (CTL-07's rule for IP addresses): trimmed, one pair of `[ ]` and
 * any `%zone` removed; IPv4 as dotted decimal; an IPv4-mapped IPv6 address as its IPv4 form; any
 * other IPv6 address as its /64 prefix (`<four groups>::/64`). Anything else gives null.
 */
export function normaliseAddress(raw: string): string | null {
  let text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1);
  }
  const zone = text.indexOf('%');
  if (zone !== -1) {
    text = text.slice(0, zone);
  }
  if (isIPv4(text)) {
    return text
      .split('.')
      .map((octet) => String(Number(octet)))
      .join('.');
  }
  if (!isIPv6(text)) {
    return null;
  }
  const groups = ipv6Groups(text);
  if (groups === null || groups.some((group) => !Number.isInteger(group))) {
    return null;
  }
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

// The caller's address: the last element of the configured header, else the socket's address.
// Read here and nowhere else; it never leaves this file.
function clientAddress(deps: Deps, c: Context<RouterEnv>): string | null {
  const headerName = deps.env.CLIENT_IP_HEADER;
  if (headerName !== null) {
    const value = c.req.header(headerName);
    if (value !== undefined) {
      return value.split(',').at(-1)?.trim() ?? null;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    // A request made in process has no socket.
    return null;
  }
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The interim address hash: HMAC-SHA256 under the per-dependencies key over CTL-07's input form
 * `addr:<UTC date>:<normalised address>`, lower-case hex; null without a usable address.
 */
function hashAddress(deps: Deps, raw: string | null, now: Date): string | null {
  if (raw === null) {
    return null;
  }
  const normalised = normaliseAddress(raw);
  if (normalised === null) {
    return null;
  }
  return createHmac('sha256', stateFor(deps).hashKey)
    .update(`addr:${utcDate(now)}:${normalised}`, 'utf8')
    .digest('hex');
}

/** Puts the address hash on the context as `addrHash` for every request (D-441). */
export function addressHash(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    c.set('addrHash', hashAddress(deps, clientAddress(deps, c), deps.clock.now()));
    await next();
  };
}

function retryAfter(windowEnd: Date, now: Date): number {
  return Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
}

/**
 * Checks every rule of the named policy of `policies` in order; every request counts, refused ones
 * included. A memory rule allows half its limit, rounded down, per replica (D-240). When rules
 * refuse, `retryAfterSeconds` is the largest of their waits.
 */
export function checkRateLimitPolicyIn(
  deps: Deps,
  policies: RateLimitPolicyTable,
  input: CheckInput,
): Promise<CheckResult> {
  const rules = Object.hasOwn(policies, input.policy) ? policies[input.policy] : undefined;
  if (rules === undefined) {
    return Promise.reject(new Error(`unknown rate-limit policy ${input.policy}`));
  }
  const { store } = stateFor(deps);
  let refusedFor = 0;
  for (const rule of rules) {
    if (rule.subject === 'user' && input.userId === null) {
      continue;
    }
    if (rule.when === 'logged_out' && input.userId !== null) {
      continue;
    }
    if (rule.store === 'db') {
      return Promise.reject(new Error('rate limit store db is not available'));
    }
    const subject =
      rule.subject === 'user' ? `u:${String(input.userId)}` : `ip:${input.addrHash ?? NO_ADDRESS}`;
    const key = `${subject}:${rule.action}:${rule.window}`;
    const limit = Math.floor(rule.limit / 2);
    const result = store.hit(key, rule.window, input.now);
    if (result === 'full') {
      const windowEnd = new Date(windowStartMs(rule.window, input.now) + WINDOW_MS[rule.window]);
      refusedFor = Math.max(refusedFor, retryAfter(windowEnd, input.now));
    } else if (result.count > limit) {
      refusedFor = Math.max(refusedFor, retryAfter(result.windowEnd, input.now));
    }
  }
  return Promise.resolve(
    refusedFor > 0 ? { ok: false, retryAfterSeconds: refusedFor } : { ok: true },
  );
}

/** Checks one of the API's own policies. */
export function checkRateLimitPolicy(
  deps: Deps,
  input: { policy: RateLimitPolicyName; userId: string | null; addrHash: string | null; now: Date },
): Promise<CheckResult> {
  return checkRateLimitPolicyIn(deps, RATE_LIMIT_POLICIES, input);
}

/**
 * The `/v1` limiter over the table it is given (D-801): the matched route's policy, or
 * `v1.unmatched` when no route's metadata matched (D-854), refused with 429 `rate_limited` and
 * `Retry-After`.
 */
export function rateLimitV1(
  deps: Deps,
  index: RouteMetaIndex,
  policies: RateLimitPolicyTable,
): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const meta = index.match(c);
    const result = await checkRateLimitPolicyIn(deps, policies, {
      policy: meta?.rateLimit ?? UNMATCHED_V1_POLICY,
      userId: null,
      addrHash: c.get('addrHash'),
      now: deps.clock.now(),
    });
    if (!result.ok) {
      c.set('retryAfterSeconds', result.retryAfterSeconds);
      throw new ApiError('rate_limited');
    }
    await next();
  };
}

/** The limiter of one web route outside `/v1`: a refusal is a plain-text 429 with `Retry-After`. */
export function limit(deps: Deps, policy: RateLimitPolicyName): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const result = await checkRateLimitPolicy(deps, {
      policy,
      userId: null,
      addrHash: c.get('addrHash'),
      now: deps.clock.now(),
    });
    if (!result.ok) {
      c.set('errorCode', 'rate_limited');
      return c.text('Too many requests', 429, {
        'Content-Type': PLAIN_TEXT,
        'Retry-After': String(result.retryAfterSeconds),
      });
    }
    await next();
  };
}
