import { LEGAL_VERSIONS } from '@citizenrun/shared';
import type { ConsentState, Me } from '@citizenrun/shared';
import { recordConsent } from '@citizenrun/shared/api';
import type { QueryClient } from '@tanstack/react-query';

import { attempt } from '@/lib/view-models/query';
import type { Outcome } from '@/lib/view-models/query';

import { writeConsentsToCache } from './me';

export type ConsentDocument = 'terms' | 'content_policy' | 'privacy_policy';

const CONSENT_FIELD = {
  terms: 'terms',
  content_policy: 'contentPolicy',
  privacy_policy: 'privacyPolicy',
} as const satisfies Record<ConsentDocument, keyof ConsentState>;

/**
 * E-ME-11, once per document in order, each with its current version; stops at the first failure, so a
 * retry sends only the documents not yet recorded.
 */
export async function recordAgreements(
  needed: readonly ConsentDocument[],
  me: Me,
  client: QueryClient,
): Promise<Outcome<void>> {
  for (const kind of needed) {
    const version = me.consents[CONSENT_FIELD[kind]].currentVersion;
    const outcome = await attempt(() => recordConsent({ kind, version, granted: true }));
    if (!outcome.ok) {
      return { ok: false, failure: outcome.failure };
    }
    writeConsentsToCache(client, outcome.value);
  }
  return { ok: true, value: undefined };
}

/** E-ME-11 for the AI-screening answer (03a section 3.10). */
export async function recordAiScreening(
  granted: boolean,
  client: QueryClient,
): Promise<Outcome<ConsentState>> {
  const outcome = await attempt(() =>
    recordConsent({ kind: 'ai_screening', version: LEGAL_VERSIONS.ai_screening, granted }),
  );
  if (outcome.ok) {
    writeConsentsToCache(client, outcome.value);
  }
  return outcome;
}
