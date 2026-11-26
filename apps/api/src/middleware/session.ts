import type { MiddlewareHandler } from 'hono';
import { sessions, users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { ApiError, OnboardingStepSchema, SESSION_ABSOLUTE_MAX_MS } from '@citizenrun/shared';
import { sha256Hex } from '@citizenrun/shared/crypto';
import { and, eq, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { sessionExtension } from '../services/auth/sessions.ts';
import type { RouteMetaIndex } from './route-meta.ts';
import {
  SESSION_COOKIE_BASE,
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
} from './session-cookie.ts';
import type { SessionOptions } from './session-cookie.ts';

export type { SessionOptions } from './session-cookie.ts';

/** A client platform, as `X-OS-Client` and `sessions.platform` name it. */
export type Platform = 'ios' | 'android' | 'web';

/** The signed-in user of a request (L-session-middleware). */
export type Viewer = {
  userId: string;
  sessionId: string;
  platform: Platform; // sessions.platform
  role: 'user' | 'admin';
  email: string | null;
  status: 'active' | 'suspended';
  onboardingStep: 'photo' | 'handle' | 'issues' | 'location' | 'done';
  createdAt: Date; // users.created_at
  authenticatedAt: Date;
};

/** A valid session with the columns the extension reads. */
export type ResolvedSession = {
  viewer: Viewer;
  expiresAt: Date;
  sessionCreatedAt: Date;
  lastSeenAt: Date | null;
};

/** The shape of a session token: 32 random bytes, base64url without padding (L-session-middleware). */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The public API's cookie name, `SameSite` and bearer rule; its cookie origin is `PUBLIC_URL` (D-801). */
export const PUBLIC_SESSION_OPTIONS = {
  cookieBase: SESSION_COOKIE_BASE,
  sameSite: 'Lax',
  acceptBearer: true,
} as const satisfies Omit<SessionOptions, 'cookieOrigin'>;

/** The public API's session options over its `PUBLIC_URL`, the default of `sessionMiddleware`. */
export function publicSessionOptions(publicUrl: string): SessionOptions {
  return { ...PUBLIC_SESSION_OPTIONS, cookieOrigin: publicUrl };
}

const BEARER_PREFIX = 'Bearer ';

// The joined row, narrowed: a value outside these sets is not a session this API can serve.
const SessionRowSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  authenticatedAt: z.date(),
  lastSeenAt: z.date().nullable(),
  expiresAt: z.date(),
  sessionCreatedAt: z.date(),
  role: z.enum(['user', 'admin']),
  email: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  onboardingStep: OnboardingStepSchema,
  userCreatedAt: z.date(),
});

/**
 * Looks the token up; makes no write. Null when the token is malformed or unknown, the session has
 * expired or is past one year, or its user is deleting (L-session-middleware).
 */
export async function lookupSession(
  db: Db,
  token: string,
  now: Date,
): Promise<ResolvedSession | null> {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    return null;
  }
  const oldestCreatedAt = new Date(now.getTime() - SESSION_ABSOLUTE_MAX_MS);
  // index: sessions_token_hash_key
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      platform: sessions.platform,
      authenticatedAt: sessions.authenticatedAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      role: users.role,
      email: users.email,
      status: users.status,
      onboardingStep: users.onboardingStep,
      userCreatedAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256Hex(token)),
        gt(sessions.expiresAt, now),
        gt(sessions.createdAt, oldestCreatedAt),
        ne(users.status, 'deleting'),
      ),
    );
  const parsed = SessionRowSchema.safeParse(rows[0]);
  if (!parsed.success) {
    return null;
  }
  const row = parsed.data;
  return {
    viewer: {
      userId: row.userId,
      sessionId: row.sessionId,
      platform: row.platform,
      role: row.role,
      email: row.email,
      status: row.status,
      onboardingStep: row.onboardingStep,
      createdAt: row.userCreatedAt,
      authenticatedAt: row.authenticatedAt,
    },
    expiresAt: row.expiresAt,
    sessionCreatedAt: row.sessionCreatedAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * The one session lookup (L-session-middleware, D-461): used by the session middleware, the
 * socket upgrade and the web shell. Makes no write.
 */
export async function resolveSession(db: Db, token: string, now: Date): Promise<Viewer | null> {
  return (await lookupSession(db, token, now))?.viewer ?? null;
}

/**
 * L-session-middleware for `/v1`: resolves the viewer from a bearer token (a failing one is 401,
 * never a fallback to the cookie) or else from the session cookie (a failing one gives no viewer
 * and is cleared), then extends the session at most once a day and its last-seen time at most once
 * an hour in one statement. A route of level `none`, and a request no route's metadata matches,
 * reads no session.
 */
export function sessionMiddleware(
  deps: Deps,
  index: RouteMetaIndex,
  options?: SessionOptions,
): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    c.set('viewer', null);
    c.set('session', null);
    const meta = index.match(c);
    if (meta === null || meta.auth === 'none') {
      await next();
      return;
    }
    const sessionOptions = options ?? publicSessionOptions(deps.env.PUBLIC_URL);
    const now = deps.clock.now();

    let resolved: ResolvedSession | null = null;
    let token: string | null = null;
    let source: 'bearer' | 'cookie' = 'bearer';
    const authorization = c.req.header('Authorization');
    if (authorization !== undefined) {
      if (!sessionOptions.acceptBearer || !authorization.startsWith(BEARER_PREFIX)) {
        throw new ApiError('unauthenticated');
      }
      token = authorization.slice(BEARER_PREFIX.length);
      resolved = await lookupSession(deps.db, token, now);
      if (resolved === null) {
        throw new ApiError('unauthenticated');
      }
    } else {
      const cookie = readSessionCookie(c, sessionOptions);
      if (cookie !== undefined) {
        token = cookie;
        source = 'cookie';
        resolved = await lookupSession(deps.db, cookie, now);
        if (resolved === null) {
          clearSessionCookie(c, sessionOptions);
        }
      }
    }

    if (resolved !== null && token !== null) {
      const { viewer } = resolved;
      let expiresAt = resolved.expiresAt;
      const change = sessionExtension({
        expiresAt,
        sessionCreatedAt: resolved.sessionCreatedAt,
        lastSeenAt: resolved.lastSeenAt,
        now,
      });
      if (change.expiresAt !== null || change.lastSeenAt !== null) {
        // One statement, outside any transaction (L-session-middleware).
        await deps.db
          .update(sessions)
          .set({
            ...(change.expiresAt === null ? {} : { expiresAt: change.expiresAt }),
            ...(change.lastSeenAt === null ? {} : { lastSeenAt: change.lastSeenAt }),
          })
          .where(eq(sessions.id, viewer.sessionId));
        if (change.expiresAt !== null) {
          expiresAt = change.expiresAt;
          if (source === 'cookie') {
            writeSessionCookie(c, sessionOptions, token, expiresAt, now);
          }
        }
      }
      c.set('viewer', viewer);
      c.set('session', { id: viewer.sessionId, expiresAt, source });
    }
    await next();
  };
}
