import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from '@citizenrun/shared';
import { keyedHash } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import type { RateLimitPolicyName, RateLimitRule } from '../config/rate-limits.ts';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import {
  addrKey,
  countWindow,
  retryAfterSeconds,
  userKey,
  windowEnd,
  windowStart,
} from './rate-limit-store.ts';
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

// The key segment of a check made with no address hash, which therefore shares one bucket.
const NO_ADDRESS = 'none';
// The address of a request with no configured header and no socket (an in-process request).
const UNKNOWN_ADDRESS = 'unknown';
const PLAIN_TEXT = 'text/plain; charset=utf-8';

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
      const start = windowStart(window, now).getTime();
      const end = windowEnd(window, now).getTime();
      const entry = entries.get(key);
      if (entry !== undefined && entry.windowStart === start) {
        entry.count += 1;
        return { count: entry.count, windowEnd: new Date(end) };
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
      entries.set(key, { windowStart: start, windowEnd: end, count: 1 });
      earliestEnd = Math.min(earliestEnd, end);
      return { count: 1, windowEnd: new Date(end) };
    },
  };
}

// One memory store per dependencies object (each app, each replica), made on first use.
const storeByDeps = new WeakMap<Deps, MemoryStore>();

function storeFor(deps: Deps): MemoryStore {
  let store = storeByDeps.get(deps);
  if (store === undefined) {
    store = createMemoryStore();
    storeByDeps.set(deps, store);
  }
  return store;
}

/** The daily-salted keyed hash of the client address (CTL-07): `keyedHash(ring, { kind: 'addr', addr, now })`. */
export function addressHashOf(ring: KeyRing, addr: string, now: Date): string {
  return keyedHash(ring, { kind: 'addr', addr, now });
}

/**
 * The client address: the last comma-separated element of the `headerName` header when it is set
 * and present, else the socket's remote address, else `unknown`. Read here and nowhere else; it
 * never leaves this file except as its hash (CTL-39).
 */
export function clientAddress(c: Context, headerName: string | null): string {
  if (headerName !== null) {
    const value = c.req.header(headerName);
    if (value !== undefined) {
      const last = value.split(',').at(-1)?.trim() ?? '';
      if (last !== '') {
        return last;
      }
    }
  }
  try {
    return getConnInfo(c).remote.address ?? UNKNOWN_ADDRESS;
  } catch {
    // A request made in process has no socket.
    return UNKNOWN_ADDRESS;
  }
}

/** Puts the address hash on the context as `addrHash` for every request (D-441). */
export function addressHash(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const now = deps.clock.now();
    c.set(
      'addrHash',
      addressHashOf(deps.keyRing, clientAddress(c, deps.env.CLIENT_IP_HEADER), now),
    );
    await next();
  };
}

/**
 * The verdict over every rule's count (L-rate-limit-db): refused when any count is over its limit,
 * with the largest wait of the refusing rules.
 */
export function decideRateLimit(
  results: readonly { count: number; limit: number; retryAfter: number }[],
): { refused: boolean; retryAfter: number } {
  let refused = false;
  let retryAfter = 0;
  for (const result of results) {
    if (result.count > result.limit) {
      refused = true;
      retryAfter = Math.max(retryAfter, result.retryAfter);
    }
  }
  return { refused, retryAfter };
}

/**
 * Checks every rule of the named policy of `policies` in order; every request counts, refused ones
 * included, and no rule is skipped once another refuses. A `db` rule counts in `rate_limits` with
 * one upsert (D-240); a `memory` rule allows half its limit, rounded down, per replica. A `user` rule
 * applies only with a viewer, a `logged_out` rule only without one. When rules refuse,
 * `retryAfterSeconds` is the largest of their waits.
 */
export async function checkRateLimitPolicyIn(
  deps: Deps,
  policies: RateLimitPolicyTable,
  input: CheckInput,
): Promise<CheckResult> {
  const rules = Object.hasOwn(policies, input.policy) ? policies[input.policy] : undefined;
  if (rules === undefined) {
    throw new Error(`unknown rate-limit policy ${input.policy}`);
  }
  const results: { count: number; limit: number; retryAfter: number }[] = [];
  for (const rule of rules) {
    if (rule.subject === 'user' && input.userId === null) {
      continue;
    }
    if (rule.when === 'logged_out' && input.userId !== null) {
      continue;
    }
    const key =
      rule.subject === 'user' && input.userId !== null
        ? userKey(input.userId, rule.action, rule.window)
        : addrKey(input.addrHash ?? NO_ADDRESS, rule.action, rule.window);
    const retryAfter = retryAfterSeconds(rule.window, input.now);
    if (rule.store === 'db') {
      const count = await countWindow(deps.db, key, rule.window, input.now);
      results.push({ count, limit: rule.limit, retryAfter });
      continue;
    }
    const limit = Math.floor(rule.limit / 2);
    const hit = storeFor(deps).hit(key, rule.window, input.now);
    // A full store refuses a new key until a window ends (CTL-39).
    results.push({ count: hit === 'full' ? limit + 1 : hit.count, limit, retryAfter });
  }
  const decision = decideRateLimit(results);
  return decision.refused ? { ok: false, retryAfterSeconds: decision.retryAfter } : { ok: true };
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
 * `v1.unmatched` when no route's metadata matched (D-854), counted for the viewer and the address
 * hash, refused with 429 `rate_limited` and `Retry-After`.
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
      userId: c.get('viewer')?.userId ?? null,
      addrHash: c.get('addrHash'),
      now: deps.clock.now(),
    });
    if (!result.ok) {
      throw new ApiError('rate_limited', { retryAfterSeconds: result.retryAfterSeconds });
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
