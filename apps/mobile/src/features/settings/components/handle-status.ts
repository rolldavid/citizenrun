import { assertNever } from '@citizenrun/shared';

import type { OnboardingHandleViewModel } from '@/features/onboarding';
import type { HandleFieldProps } from '@/ui/components/handle-field';

import type { SettingsT } from './settings-translation';

type Check = OnboardingHandleViewModel['check'];
type InvalidReason = OnboardingHandleViewModel['invalidReason'];

/** What the handle field shows: the state of its line and the sentence in it. */
export type HandleStatus = { check: HandleFieldProps['check']; statusText: string | null };

/** The sentence for the rule a handle breaks; none where no rule names it. */
function reasonText(reason: InvalidReason, t: SettingsT): string | null {
  switch (reason) {
    case 'too_short':
      return t('onboarding:handle.tooShort');
    case 'too_long':
      return t('onboarding:handle.tooLong');
    case 'characters':
      return t('onboarding:handle.characters');
    case 'dots':
      return t('onboarding:handle.dots');
    case 'no_letter':
      return t('onboarding:handle.noLetter');
    case 'not_allowed':
    case null:
      return null;
    default:
      return assertNever(reason);
  }
}

/** The rule a refused save names for the handle; null for a code that is none of them. */
function reasonOfCode(code: string): InvalidReason {
  switch (code) {
    case 'too_short':
    case 'too_long':
    case 'characters':
    case 'dots':
    case 'no_letter':
      return code;
    default:
      return null;
  }
}

/** What the check of a handle found, in the field's own line. */
function checkText(check: Check, reason: InvalidReason, t: SettingsT): string | null {
  switch (check) {
    case 'idle':
      return null;
    case 'checking':
      return t('common:ui.handle.checking');
    case 'free':
      return t('onboarding:handle.free');
    case 'taken':
      return t('onboarding:handle.taken');
    case 'reserved':
      return t('onboarding:handle.reserved');
    case 'failed':
      return t('onboarding:handle.checkFailed');
    case 'invalid':
      return reasonText(reason, t);
    default:
      return assertNever(check);
  }
}

/**
 * The handle field's line on the profile screen: what a refused save said about the handle, and
 * otherwise what the check found. A check that could not run reads as an error in the field.
 */
export function handleStatus(
  handle: { check: Check; invalidReason: InvalidReason },
  refusedCode: string | undefined,
  t: SettingsT,
): HandleStatus {
  if (refusedCode !== undefined) {
    return {
      check: 'invalid',
      statusText: reasonText(reasonOfCode(refusedCode), t) ?? t('errors:invalid_request'),
    };
  }
  return {
    check: handle.check === 'failed' ? 'invalid' : handle.check,
    statusText: checkText(handle.check, handle.invalidReason, t),
  };
}
