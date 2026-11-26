import { userConsents } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { ApiError, LEGAL_VERSIONS, newId } from '@citizenrun/shared';
import type { ConsentState, RecordConsentBody } from '@citizenrun/shared';
import type { Platform } from '../../middleware/session.ts';
import { loadConsentState } from './load-me.ts';

/**
 * E-ME-11 (L-age-consent): appends one agreement or AI-screening answer at the current version and
 * answers the recomputed ConsentState. A version other than LEGAL_VERSIONS[kind] answers 422
 * `consent_version_outdated`. The answer and the version are never logged.
 */
export async function recordConsent(
  db: Db,
  input: { userId: string; body: RecordConsentBody; platform: Platform; now: Date },
): Promise<ConsentState> {
  const { userId, body, platform } = input;
  if (body.version !== LEGAL_VERSIONS[body.kind]) {
    throw new ApiError('consent_version_outdated');
  }
  // Append-only: the newest row per kind is the answer.
  await db.insert(userConsents).values({
    id: newId(),
    userId,
    kind: body.kind,
    version: body.version,
    granted: body.granted,
    platform,
  });
  return loadConsentState(db, userId);
}
