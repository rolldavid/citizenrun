import { authChallenges } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { APPLE_STATE_TTL_S, NONCE_TTL_MS, newId } from '@citizenrun/shared';
import type { NonceResult } from '@citizenrun/shared';
import { randomToken, sha256Hex, signToken } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';

const NONCE_KIND = 'nonce';

/**
 * Issues a single-use sign-in nonce (E-AUTH-03, D-241): stores only its SHA-256 with 10 minutes to
 * live and returns the raw nonce once, its hash for the provider and the signed Apple state.
 */
export async function issueNonce(
  db: Db,
  input: { platform: Platform; ring: KeyRing; now: Date },
): Promise<NonceResult> {
  const nonce = randomToken();
  const nonceHash = sha256Hex(nonce);
  const expiresAt = new Date(input.now.getTime() + NONCE_TTL_MS);
  await db.insert(authChallenges).values({
    id: newId(),
    kind: NONCE_KIND,
    secretHash: nonceHash,
    platform: input.platform,
    expiresAt,
  });
  // Named appleState, never state (D-450).
  const appleState = signToken(
    input.ring,
    'apple_state',
    { n: nonceHash },
    APPLE_STATE_TTL_S,
    input.now,
  );
  return { nonce, nonceHash, state: appleState, expiresAt: expiresAt.toISOString() };
}

/** A nonce challenge that can still be consumed: its hash and the platform that asked for it. */
export type UsableNonce = { secretHash: string; platform: Platform | null };

function platformOf(value: string | null): Platform | null {
  return value === 'ios' || value === 'android' || value === 'web' ? value : null;
}

/** The nonce challenge of a raw nonce when it exists, is unused and unexpired; reads only. */
export async function findUsableNonce(db: Db | Tx, rawNonce: string): Promise<UsableNonce | null> {
  // index: auth_challenges_secret_hash_key
  const [row] = await db
    .select({ secretHash: authChallenges.secretHash, platform: authChallenges.platform })
    .from(authChallenges)
    .where(
      and(
        eq(authChallenges.secretHash, sha256Hex(rawNonce)),
        eq(authChallenges.kind, NONCE_KIND),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, sql`now()`),
      ),
    );
  return row === undefined
    ? null
    : { secretHash: row.secretHash, platform: platformOf(row.platform) };
}

/**
 * T-auth_challenges' single-statement consume; true when this call consumed the row. The `where`
 * holds every condition, so a replayed nonce never passes a read-then-update race.
 */
export async function consumeNonce(tx: Tx, secretHash: string): Promise<boolean> {
  // index: auth_challenges_secret_hash_key
  const consumed = await tx
    .update(authChallenges)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(authChallenges.secretHash, secretHash),
        eq(authChallenges.kind, NONCE_KIND),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: authChallenges.id });
  return consumed.length > 0;
}
