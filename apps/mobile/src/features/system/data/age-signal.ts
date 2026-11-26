import { assertNever, MeSchema } from '@citizenrun/shared';
import type { Me } from '@citizenrun/shared';
import { recordAgeSignal } from '@citizenrun/shared/api';
import type { QueryClient } from '@tanstack/react-query';

import { clearRememberedNext } from '@/lib/navigation';
import { setSessionPresence } from '@/lib/session-state';
import { attempt } from '@/lib/view-models/query';
import { ageAssurance } from '@/platform/age-assurance';
import type { AgeOutcome } from '@/platform/age-assurance';
import { session } from '@/platform/session';

import { writeMeToCache } from './me';
import { setMinorEnded } from './system-state';

export type ColdStartAgeAction =
  | { kind: 'none' }
  | {
      kind: 'post';
      body: { result: 'adult' | 'under_18' | 'under_13'; sourceTier: 'confirmed' | 'declared' };
    };

const NONE: ColdStartAgeAction = { kind: 'none' };
const UNAVAILABLE: AgeOutcome = { kind: 'unavailable' };

let asked = false;

// D-531, CTL-75
export function coldStartAgeAction(outcome: AgeOutcome, me: Me): ColdStartAgeAction {
  switch (outcome.kind) {
    case 'minor':
      return {
        kind: 'post',
        body: { result: outcome.under13 ? 'under_13' : 'under_18', sourceTier: outcome.tier },
      };
    case 'adult':
      return me.age?.method === 'self_declared'
        ? { kind: 'post', body: { result: 'adult', sourceTier: outcome.tier } }
        : NONE;
    case 'unavailable':
      return NONE;
    default:
      return assertNever(outcome);
  }
}

/** The cold-start rule of PM-age-assurance, at most once per process; E-ME-12 carries the two fields only (D-350). */
export async function runColdStartAgeCheck(
  me: Me,
  client: QueryClient,
): Promise<'none' | 'adult_recorded' | 'minor_ended' | 'failed'> {
  if (asked) return 'none';
  asked = true;
  if (!ageAssurance.storeSignalSupported) return 'none';
  const outcome = await ageAssurance.requestStoreSignal().catch(() => UNAVAILABLE);
  const action = coldStartAgeAction(outcome, me);
  if (action.kind === 'none') return 'none';
  const sent = await attempt(() => recordAgeSignal(action.body));
  if (!sent.ok) return 'failed';
  if (action.body.result === 'adult') {
    const parsed = MeSchema.safeParse(sent.value);
    if (parsed.success) {
      writeMeToCache(client, parsed.data);
    }
    return 'adult_recorded';
  }
  setMinorEnded(true);
  setSessionPresence('absent');
  clearRememberedNext();
  await session.endLocal('account_minor');
  return 'minor_ended';
}

/** Allows the next run. Called by tests. */
export function resetColdStartAgeCheck(): void {
  asked = false;
}
