import type { MiddlewareHandler } from 'hono';
import { ADMIN_RECENT_SIGNIN_MS, ApiError, SENSITIVE_RECENT_SIGNIN_MS } from '@citizenrun/shared';
import type { RouteMeta } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import type { RouteMetaIndex } from './route-meta.ts';
import type { Viewer } from './session.ts';

/** The addresses of `ADMIN_EMAILS`, as the env module parsed them (lower-cased, trimmed). */
export type AdminEmails = ReadonlySet<string>;

/** A gate's refusal: the error code it answers with (L-gates). */
export type GateRefusal =
  | 'unauthenticated'
  | 'forbidden'
  | 'recent_sign_in_required'
  | 'account_suspended'
  | 'onboarding_incomplete';

// The methods a suspended account may still send (L-suspension).
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * The set of the env module's parsed `ADMIN_EMAILS` list, which is already split, trimmed,
 * lower-cased and emptied of blank items; null or an empty list gives an empty set (D-611).
 */
export function parseAdminEmails(list: readonly string[] | null): AdminEmails {
  return new Set(list ?? []);
}

// Whether the sign-in is more recent than `windowMs` before `now`.
function signedInWithin(viewer: Viewer, now: Date, windowMs: number): boolean {
  return viewer.authenticatedAt.getTime() > now.getTime() - windowMs;
}

// Gate 4's role, list and status conditions (D-437).
function isAdminAccount(viewer: Viewer, adminEmails: AdminEmails): boolean {
  return (
    viewer.role === 'admin' &&
    viewer.email !== null &&
    adminEmails.has(viewer.email.toLowerCase()) &&
    viewer.status === 'active'
  );
}

/**
 * Gate 4 (L-gates, D-437, D-611): role `admin`, the email in `adminEmails`, the account active and
 * a sign-in within the last 12 hours. Reads no environment.
 */
export function isAdmin(viewer: Viewer, now: Date, adminEmails: AdminEmails): boolean {
  return isAdminAccount(viewer, adminEmails) && signedInWithin(viewer, now, ADMIN_RECENT_SIGNIN_MS);
}

/** L-gates: applies the seven gates in order and returns the first refusal, or null. */
export function evaluateGates(input: {
  meta: RouteMeta;
  method: string;
  viewer: Viewer | null;
  now: Date;
  adminEmails: AdminEmails;
}): GateRefusal | null {
  const { meta, viewer, now } = input;
  // Gate 1: no session is read and no other gate applies.
  if (meta.auth === 'none') {
    return null;
  }
  // Gate 2: an optional route allows no viewer.
  if (viewer === null) {
    return meta.auth === 'optional' ? null : 'unauthenticated';
  }
  // Gate 4.
  if (meta.auth === 'admin') {
    if (!isAdminAccount(viewer, input.adminEmails)) {
      return 'forbidden';
    }
    if (!signedInWithin(viewer, now, ADMIN_RECENT_SIGNIN_MS)) {
      return 'recent_sign_in_required';
    }
  }
  // Gate 5.
  if (meta.recentSignIn === '15m' && !signedInWithin(viewer, now, SENSITIVE_RECENT_SIGNIN_MS)) {
    return 'recent_sign_in_required';
  }
  // Gate 6 (L-suspension), on optional routes too.
  if (
    viewer.status === 'suspended' &&
    !READ_METHODS.has(input.method) &&
    meta.allowWhenSuspended !== true
  ) {
    return 'account_suspended';
  }
  // Gate 7.
  if (meta.auth === 'onboarded' && viewer.onboardingStep !== 'done') {
    return 'onboarding_incomplete';
  }
  return null;
}

/**
 * L-gates for `/v1`: refuses a request whose route's gates fail with the gate's 401 or 403. A request
 * no route's metadata matches is passed on (D-854).
 */
export function gatesMiddleware(deps: Deps, index: RouteMetaIndex): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const meta = index.match(c);
    if (meta !== null) {
      const refusal = evaluateGates({
        meta,
        method: c.req.method,
        viewer: c.get('viewer'),
        now: deps.clock.now(),
        adminEmails: parseAdminEmails(deps.env.ADMIN_EMAILS),
      });
      if (refusal !== null) {
        throw new ApiError(refusal);
      }
    }
    await next();
  };
}
