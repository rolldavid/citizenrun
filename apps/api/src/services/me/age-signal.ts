import { users } from '@citizenrun/db';
import { ApiError } from '@citizenrun/shared';
import type { AccountDeletionView, Logger, RecordAgeSignalBody } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { enqueueOf } from '../../deps.ts';
import type { Platform } from '../../middleware/session.ts';
import { startAccountDeletion } from './delete-account.ts';

/** What a store age signal did: an adult record, or a minor's suspension and deletion. */
export type AgeSignalOutcome = { kind: 'adult' } | { kind: 'minor'; deletion: AccountDeletionView };

/**
 * E-ME-12 (CTL-71, D-492): records a store age signal. A web client answers 400 (a browser has no
 * store signal). `adult` replaces the age record with the store's. `under_18` and `under_13`
 * suspend the account with the reason `under_18`, mark it deleting and enqueue account.delete in one
 * transaction (`skipDeferral` only for `under_13`), then log `account.age_minor` with the band. Nothing
 * else of the signal is stored or logged (D-350).
 */
export async function recordAgeSignal(
  deps: Deps,
  input: {
    userId: string;
    body: RecordAgeSignalBody;
    platform: Platform;
    now: Date;
    logger: Logger;
  },
): Promise<AgeSignalOutcome> {
  const { userId, body, platform, now, logger } = input;
  if (platform === 'web') {
    throw new ApiError('invalid_request', { fields: { result: 'not_allowed' } });
  }

  if (body.result === 'adult') {
    // A record with no signal is replaced by the store's.
    await deps.db
      .update(users)
      .set({
        ageMethod: 'store_signal',
        ageResult: 'adult',
        ageSourceTier: body.sourceTier,
        ageCheckedAt: now,
      })
      .where(eq(users.id, userId));
    return { kind: 'adult' };
  }

  const band = body.result;
  const enqueue = enqueueOf(deps);
  const deletion = await deps.db.transaction(async (tx) => {
    // Set before the deletion mark: the deletion job reads suspended_at.
    await tx
      .update(users)
      .set({ suspendedAt: now, suspendedReason: 'under_18' })
      .where(eq(users.id, userId));
    return startAccountDeletion(tx, enqueue, { userId, skipDeferral: band === 'under_13' });
  });
  logger.warn('account.age_minor', { userId, band });
  return { kind: 'minor', deletion };
}
