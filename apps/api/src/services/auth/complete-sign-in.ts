import type { Context } from 'hono';
import type { Tx } from '@citizenrun/db';
import { SessionInfoSchema } from '@citizenrun/shared';
import type { SessionInfo } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import type { AdminEmails } from '../../middleware/gates.ts';
import { writeSessionCookie } from '../../middleware/session-cookie.ts';
import { publicSessionOptions } from '../../middleware/session.ts';
import type { Platform } from '../../middleware/session.ts';
import { respond } from '../../respond.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { loadMe } from '../me/load-me.ts';
import { applyAdminElevation } from './admin-elevation.ts';
import { createSession, deleteSession } from './sessions.ts';
import type { NewSession } from './sessions.ts';

/**
 * The session part of every sign-in, inside its transaction: admin elevation (L-admin-elevation),
 * then Replace (the session the request carried is deleted) and Create (L-session).
 */
export async function finishSignIn(
  tx: Tx,
  input: {
    userId: string;
    carriedSessionId: string | null;
    platform: Platform;
    now: Date;
    adminEmails: AdminEmails;
  },
): Promise<{ session: NewSession; promoted: boolean }> {
  const promoted = await applyAdminElevation(tx, {
    userId: input.userId,
    adminEmails: input.adminEmails,
  });
  if (input.carriedSessionId !== null) {
    await deleteSession(tx, input.carriedSessionId);
  }
  const session = await createSession(tx, {
    userId: input.userId,
    platform: input.platform,
    now: input.now,
  });
  return { session, promoted };
}

/** The `SessionInfo` answer: the token for phones only, never for the web, and the user's `Me`. */
export async function buildSessionInfo(
  deps: Deps,
  input: {
    userId: string;
    sessionId: string;
    token: string | null;
    expiresAt: Date;
    created: boolean;
    platform: Platform;
    now: Date;
    adminEmails: AdminEmails;
  },
): Promise<SessionInfo> {
  return {
    token: input.platform === 'web' ? null : input.token,
    expiresAt: input.expiresAt.toISOString(),
    created: input.created,
    me: await loadMe(deps, { userId: input.userId, sessionId: input.sessionId, now: input.now }),
  };
}

/**
 * Answers a finished sign-in: a new session's cookie on the web, then `SessionInfo`. A kept
 * session (E-AUTH-02 `add_email`) writes no cookie and sends no token.
 */
export async function answerSignIn(
  c: Context<RouterEnv>,
  deps: Deps,
  input: {
    userId: string;
    session: NewSession | null;
    keptSession: { id: string; expiresAt: Date } | null;
    created: boolean;
    platform: Platform;
    now: Date;
    adminEmails: AdminEmails;
    publicUrl: string;
  },
): Promise<Response> {
  const { session, keptSession } = input;
  let current: { id: string; token: string | null; expiresAt: Date };
  if (session !== null) {
    if (input.platform === 'web') {
      writeSessionCookie(
        c,
        publicSessionOptions(input.publicUrl),
        session.token,
        session.expiresAt,
        input.now,
      );
    }
    current = { id: session.sessionId, token: session.token, expiresAt: session.expiresAt };
  } else if (keptSession !== null) {
    current = { id: keptSession.id, token: null, expiresAt: keptSession.expiresAt };
  } else {
    throw new Error('A sign-in answer needs a session.');
  }
  const info = await buildSessionInfo(deps, {
    userId: input.userId,
    sessionId: current.id,
    token: current.token,
    expiresAt: current.expiresAt,
    created: input.created,
    platform: input.platform,
    now: input.now,
    adminEmails: input.adminEmails,
  });
  return respond(c, SessionInfoSchema, info);
}
