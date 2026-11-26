import { authIdentities, users } from '@citizenrun/db';
import type { Db, Enqueue, Tx } from '@citizenrun/db';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

/** One sign-in's identity, as the provider asserted it (L-account-link). */
export type IdentityInput = {
  provider: 'email' | 'apple' | 'google';
  subject: string; // email: the lower-cased address; apple and google: the token's sub
  email: string | null; // as asserted, lower-cased
  emailVerified: boolean | null; // as asserted by the provider (stored for audit, D-245)
  emailVerifiedAuthoritative: boolean; // input V of L-account-link
  isPrivateEmail: boolean | null; // apple only
};

/** The row of L-account-link's table a sign-in takes. */
export type Resolution =
  | { kind: 'existing'; userId: string; attachedNow: boolean } // rows 2 and 5
  | { kind: 'new' } // rows 6 and 7
  | { kind: 'refused'; code: 'account_deleting' }; // rows 1 and 4

const UNIQUE_VIOLATION = '23505';

/**
 * Whether `error`, or an error it wraps, is a Postgres unique violation on `constraint`. Reads only
 * the SQLSTATE and the constraint name, never the error's text, which holds the value.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code: unknown = Reflect.get(current, 'code');
    const name: unknown = Reflect.get(current, 'constraint');
    if (code === UNIQUE_VIOLATION && name === constraint) {
      return true;
    }
    current = Reflect.get(current, 'cause');
  }
  return false;
}

// Input E is consulted only for a verified, authoritative address that is not an Apple relay
// address: a relay address never matches another identity's email (D-245, D-462).
function linksByEmail(input: IdentityInput): input is IdentityInput & { email: string } {
  return (
    input.emailVerifiedAuthoritative &&
    input.email !== null &&
    !(input.provider === 'apple' && input.isPrivateEmail === true)
  );
}

/** Decides the row of L-account-link's table; reads only. */
export async function resolveIdentity(db: Db | Tx, input: IdentityInput): Promise<Resolution> {
  // index: auth_identities_pkey
  const [identity] = await db
    .select({ userId: authIdentities.userId, status: users.status })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(eq(authIdentities.provider, input.provider), eq(authIdentities.subject, input.subject)),
    );
  if (identity !== undefined) {
    return identity.status === 'deleting'
      ? { kind: 'refused', code: 'account_deleting' }
      : { kind: 'existing', userId: identity.userId, attachedNow: false };
  }
  if (linksByEmail(input)) {
    // index: users_email_key
    const [holder] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.email, input.email));
    if (holder !== undefined) {
      return holder.status === 'deleting'
        ? { kind: 'refused', code: 'account_deleting' }
        : { kind: 'existing', userId: holder.id, attachedNow: true };
    }
  }
  return { kind: 'new' };
}

/** Writes rows 2 and 5 inside the sign-in transaction. */
export async function applyExistingIdentity(
  tx: Tx,
  input: IdentityInput,
  resolution: { userId: string; attachedNow: boolean },
  extra: { clientId: string | null; refreshTokenEnc: Uint8Array | null; enqueue: Enqueue },
): Promise<void> {
  const { userId } = resolution;
  if (resolution.attachedNow) {
    // Row 5: the identity joins the user holding the address, who is told (D-245, D-469).
    await tx
      .insert(authIdentities)
      .values({
        userId,
        provider: input.provider,
        subject: input.subject,
        email: input.email,
        emailVerified: input.emailVerified,
        isPrivateEmail: input.isPrivateEmail,
        clientId: extra.clientId,
        refreshTokenEnc: extra.refreshTokenEnc,
      })
      .onConflictDoNothing({ target: [authIdentities.provider, authIdentities.subject] });
    await extra.enqueue(
      'notify.email',
      { template: 'signin_method_added', userId, provider: input.provider },
      { tx },
    );
    return;
  }

  // Row 2: the audit columns, and the Apple refresh token with its client id when one came.
  await tx
    .update(authIdentities)
    .set({
      email: input.email,
      emailVerified: input.emailVerified,
      isPrivateEmail: input.isPrivateEmail,
      ...(extra.refreshTokenEnc === null
        ? {}
        : { refreshTokenEnc: extra.refreshTokenEnc, clientId: extra.clientId }),
    })
    .where(
      and(eq(authIdentities.provider, input.provider), eq(authIdentities.subject, input.subject)),
    );
  if (!input.emailVerifiedAuthoritative || input.email === null) {
    return;
  }
  const email = input.email;
  const other = alias(users, 'other');
  try {
    // A savepoint, so a lost race on the address leaves the sign-in's transaction usable.
    await tx.transaction(async (sp) => {
      await sp
        .update(users)
        .set({ email })
        .where(
          and(
            eq(users.id, userId),
            isNull(users.email),
            notExists(
              sp
                .select({ one: sql`1` })
                .from(other)
                .where(eq(other.email, email)),
            ),
          ),
        );
    });
  } catch (error) {
    if (!isUniqueViolation(error, 'users_email_key')) {
      throw error;
    }
  }
}
