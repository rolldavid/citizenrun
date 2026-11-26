import {
  authChallenges,
  authIdentities,
  emailCodes,
  reservedHandles,
  sessions,
  users,
} from '@citizenrun/db';
import type {
  AuthChallengeRow,
  AuthIdentityRow,
  Db,
  EmailCodeRow,
  NewAuthIdentityRow,
  ReservedHandleRow,
  SessionRow,
} from '@citizenrun/db';
import { newId } from '@citizenrun/shared';
import { emailCodeHash, keyedHash, randomToken, sha256Hex } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { eq, sql } from 'drizzle-orm';

// Time defaults are the database's own clock, so no factory reads one.
const TEN_MINUTES_AHEAD = sql`now() + interval '10 minutes'`;
const NINETY_DAYS_AHEAD = sql`now() + interval '90 days'`;

type Platform = 'ios' | 'android' | 'web';

function first<T>(rows: T[], table: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`The ${table} insert returned no row.`);
  }
  return row;
}

/** The input of the Identity factory. */
export type IdentityInput = {
  userId: string;
  provider?: 'email' | 'apple' | 'google';
  subject?: string;
  email?: string | null;
  emailVerified?: boolean | null;
  isPrivateEmail?: boolean | null;
  clientId?: string | null;
  refreshTokenEnc?: Uint8Array | null;
};

/**
 * An `auth_identities` row as the sign-in service writes it: provider `email`, the email
 * defaulting to the subject, verified; the Apple columns null unless given. The subject is the
 * caller's (insertIdentity reads the user's email for it).
 */
export function makeIdentity(input: IdentityInput & { subject: string }): NewAuthIdentityRow {
  const provider = input.provider ?? 'email';
  return {
    userId: input.userId,
    provider,
    subject: input.subject,
    email: input.email === undefined ? input.subject : input.email,
    emailVerified: input.emailVerified ?? true,
    isPrivateEmail: input.isPrivateEmail ?? null,
    clientId: input.clientId ?? null,
    refreshTokenEnc: input.refreshTokenEnc ?? null,
  };
}

/**
 * Writes an identity for `input.userId`; the subject and email default to the user's
 * `users.email` lower-cased (one read). Returns the stored row.
 */
export async function insertIdentity(db: Db, input: IdentityInput): Promise<AuthIdentityRow> {
  let subject = input.subject;
  let email = input.email;
  if (subject === undefined || email === undefined) {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, input.userId));
    const userEmail = user?.email?.toLowerCase() ?? null;
    if (subject === undefined) {
      if (userEmail === null) {
        throw new Error('insertIdentity needs a subject for a user with no email.');
      }
      subject = userEmail;
    }
    email ??= userEmail;
  }
  return first(
    await db
      .insert(authIdentities)
      .values(makeIdentity({ ...input, subject, email }))
      .returning(),
    'auth_identities',
  );
}

/** The input of the EmailCode factory: the code is the test's own. */
export type EmailCodeInput = {
  email: string;
  code: string;
  pendingToken?: string;
  expiresAt?: Date;
  attempts?: number;
  sendCount?: number;
  lastSentAt?: Date;
};

/**
 * Writes an `email_codes` challenge as E-AUTH-01 does: the code's keyed hash over the lower-cased
 * email, the pending token's SHA-256, 10 minutes to live. Returns the row and the raw pending token.
 */
export async function insertEmailCode(
  db: Db,
  ring: KeyRing,
  input: EmailCodeInput,
): Promise<{ row: EmailCodeRow; pendingToken: string }> {
  const pendingToken = input.pendingToken ?? randomToken();
  const row = first(
    await db
      .insert(emailCodes)
      .values({
        id: newId(),
        email: input.email,
        pendingTokenHash: sha256Hex(pendingToken),
        codeHash: emailCodeHash(ring, input.email.toLowerCase(), input.code),
        expiresAt: input.expiresAt ?? TEN_MINUTES_AHEAD,
        attempts: input.attempts ?? 0,
        sendCount: input.sendCount ?? 1,
        lastSentAt: input.lastSentAt ?? sql`now()`,
      })
      .returning(),
    'email_codes',
  );
  return { row, pendingToken };
}

/** The input of the Challenge factory. */
export type ChallengeInput = {
  kind: 'nonce' | 'apple_handoff' | 'ws_ticket';
  secret?: string;
  secretHash?: string;
  userId?: string | null;
  platform?: Platform | null;
  expiresAt?: Date;
  usedAt?: Date | null;
};

/**
 * Writes an `auth_challenges` row: the secret's SHA-256 (or the given hash), 10 minutes to live.
 * Returns the row and the raw secret, null when only a hash was given.
 */
export async function insertChallenge(
  db: Db,
  input: ChallengeInput,
): Promise<{ row: AuthChallengeRow; secret: string | null }> {
  const secret = input.secret ?? (input.secretHash === undefined ? randomToken() : null);
  const secretHash = input.secretHash ?? sha256Hex(secret ?? '');
  const row = first(
    await db
      .insert(authChallenges)
      .values({
        id: newId(),
        kind: input.kind,
        secretHash,
        userId: input.userId ?? null,
        platform: input.platform ?? null,
        expiresAt: input.expiresAt ?? TEN_MINUTES_AHEAD,
        usedAt: input.usedAt ?? null,
      })
      .returning(),
    'auth_challenges',
  );
  return { row, secret };
}

/** The input of the Session factory. */
export type SessionInput = {
  userId: string;
  platform?: Platform;
  authenticatedAt?: Date;
  expiresAt?: Date;
  createdAt?: Date;
  lastSeenAt?: Date | null;
};

/**
 * Writes a `sessions` row for a new random token, storing only its SHA-256 (T-sessions):
 * platform `ios`, signed in and seen now, 90 days to live. Returns the row and the raw token.
 */
export async function insertSession(
  db: Db,
  input: SessionInput,
): Promise<{ row: SessionRow; token: string }> {
  const token = randomToken();
  const row = first(
    await db
      .insert(sessions)
      .values({
        id: newId(),
        userId: input.userId,
        tokenHash: sha256Hex(token),
        platform: input.platform ?? 'ios',
        authenticatedAt: input.authenticatedAt ?? sql`now()`,
        lastSeenAt: input.lastSeenAt === undefined ? sql`now()` : input.lastSeenAt,
        expiresAt: input.expiresAt ?? NINETY_DAYS_AHEAD,
        createdAt: input.createdAt ?? sql`now()`,
      })
      .returning(),
    'sessions',
  );
  return { row, token };
}

/** The input of the ReservedHandle factory. */
export type ReservedHandleInput = {
  handle: string;
  reason?: 'released' | 'deleted';
  reservedUntil?: Date;
};

/** Writes a `reserved_handles` row under the handle's keyed hash, reason `deleted`, held 90 days. */
export async function insertReservedHandle(
  db: Db,
  ring: KeyRing,
  input: ReservedHandleInput,
): Promise<ReservedHandleRow> {
  return first(
    await db
      .insert(reservedHandles)
      .values({
        handleHash: keyedHash(ring, { kind: 'handle', handle: input.handle }),
        reason: input.reason ?? 'deleted',
        reservedUntil: input.reservedUntil ?? NINETY_DAYS_AHEAD,
      })
      .returning(),
    'reserved_handles',
  );
}
