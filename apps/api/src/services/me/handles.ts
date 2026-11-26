import { reservedHandles, users } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import {
  ApiError,
  HANDLE_HOLD_DAYS,
  assertNever,
  canChangeHandle,
  validateHandle,
} from '@citizenrun/shared';
import type { HandleError } from '@citizenrun/shared';
import { keyedHash, keyedHashCandidates } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';
import { isUniqueViolation } from '../auth/resolve-identity.ts';
import { advanceOnboarding } from './onboarding.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What E-ME-07 answers for one typed handle (L-handle-service). */
export type HandleAvailability = {
  handle: string;
  available: boolean;
  reason: 'invalid' | 'reserved' | 'taken' | null;
};

/** Trim, drop one leading '@', lower-case: the form HandleCheck.handle reports even for an invalid input. */
export function normalizeHandleInput(raw: string): string {
  const trimmed = raw.trim();
  return (trimmed.startsWith('@') ? trimmed.slice(1) : trimmed).toLowerCase();
}

/** The answer of PUT /v1/me/handle for a refused handle (L-handle-service). */
export function handleErrorToApiError(error: HandleError): ApiError {
  switch (error) {
    case 'reserved':
      return new ApiError('handle_reserved');
    case 'too_short':
    case 'too_long':
      return new ApiError('invalid_request', { fields: { handle: error } });
    case 'invalid_characters':
    case 'edge_dot':
    case 'double_dot':
    case 'no_letter_or_digit':
      return new ApiError('invalid_request', { fields: { handle: 'invalid_format' } });
    default:
      return assertNever(error);
  }
}

// Held: a released or deleted handle whose hold has not ended, matched under every key of the ring
// so a hash made before a rotation still matches (CTL-07).
async function isHeld(db: Db | Tx, ring: KeyRing, handle: string, now: Date): Promise<boolean> {
  const candidates = keyedHashCandidates(ring, { kind: 'handle', handle });
  // index: reserved_handles_pkey
  const [held] = await db
    .select({ one: sql<number>`1` })
    .from(reservedHandles)
    .where(
      and(inArray(reservedHandles.handleHash, candidates), gt(reservedHandles.reservedUntil, now)),
    )
    .limit(1);
  return held !== undefined;
}

/**
 * E-ME-07's availability order (L-handle-service): invalid, reserved word, the caller's own handle,
 * a held hash, taken by another user, otherwise available. The typed value is never logged.
 */
export async function checkHandleAvailability(
  db: Db | Tx,
  input: { userId: string; raw: string; now: Date },
  ring: KeyRing,
): Promise<HandleAvailability> {
  const validated = validateHandle(input.raw);
  if (!validated.ok) {
    return {
      handle: normalizeHandleInput(input.raw),
      available: false,
      reason: validated.error === 'reserved' ? 'reserved' : 'invalid',
    };
  }
  const { handle } = validated;
  const [own] = await db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, input.userId));
  if (own?.handle?.toLowerCase() === handle) {
    return { handle, available: true, reason: null };
  }
  if (await isHeld(db, ring, handle, input.now)) {
    return { handle, available: false, reason: 'reserved' };
  }
  // index: users_handle_key
  const [taken] = await db
    .select({ one: sql<number>`1` })
    .from(users)
    .where(and(eq(users.handle, handle), ne(users.id, input.userId)))
    .limit(1);
  if (taken !== undefined) {
    return { handle, available: false, reason: 'taken' };
  }
  return { handle, available: true, reason: null };
}

/**
 * E-ME-08 (L-handle-service): sets or changes the handle and advances onboarding from `handle`.
 * The first set leaves `handle_changed_at` null; a change needs 30 days since the last one and holds
 * the old handle for 90 days as a keyed hash. A lost race on `users_handle_key` answers
 * `handle_taken`; the database error's text is never logged or answered.
 */
export async function setHandle(
  db: Db,
  input: { userId: string; raw: string; now: Date; platform: Platform },
  ring: KeyRing,
): Promise<void> {
  const validated = validateHandle(input.raw);
  if (!validated.ok) {
    throw handleErrorToApiError(validated.error);
  }
  const { handle } = validated;
  const advance = (tx: Tx) =>
    advanceOnboarding(tx, {
      userId: input.userId,
      from: 'handle',
      outcome: 'completed',
      platform: input.platform,
      now: input.now,
    });
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ handle: users.handle, handleChangedAt: users.handleChangedAt })
        .from(users)
        .where(eq(users.id, input.userId))
        .for('update');
      if (current === undefined) {
        throw new ApiError('unauthenticated');
      }
      const old = current.handle === null ? null : current.handle.toLowerCase();
      if (old === handle) {
        await advance(tx);
        return;
      }
      if (await isHeld(tx, ring, handle, input.now)) {
        throw new ApiError('handle_reserved');
      }
      if (old !== null && !canChangeHandle(current.handleChangedAt, input.now)) {
        throw new ApiError('handle_change_too_soon');
      }
      await tx
        .update(users)
        .set({ handle, handleChangedAt: old === null ? null : input.now })
        .where(eq(users.id, input.userId));
      if (old !== null) {
        await tx
          .insert(reservedHandles)
          .values({
            handleHash: keyedHash(ring, { kind: 'handle', handle: old }),
            reason: 'released',
            reservedUntil: new Date(input.now.getTime() + HANDLE_HOLD_DAYS * DAY_MS),
          })
          .onConflictDoUpdate({
            target: reservedHandles.handleHash,
            set: {
              reservedUntil: sql`greatest("reserved_handles"."reserved_until", excluded."reserved_until")`,
            },
          });
      }
      await advance(tx);
    });
  } catch (error) {
    // Caught after the rollback, because the violation aborted the transaction.
    if (isUniqueViolation(error, 'users_handle_key')) {
      throw new ApiError('handle_taken');
    }
    throw error;
  }
}
