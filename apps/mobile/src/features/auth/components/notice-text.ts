import type { ErrorCode } from '@citizenrun/shared';

import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';

import type { AuthT } from './auth-translation';

/** What a sign-in notice says, and whether it is a refusal or a plain fact. */
export type SignInNoticeText = { kind: 'error' | 'info'; text: string };

/**
 * The sentence of an error code. The one code whose sentence holds a date cannot arise while
 * signing in, and reads the generic sentence here.
 */
export function errorSentence(code: ErrorCode, t: AuthT): string {
  return code === 'handle_change_too_soon' ? t('errors:generic') : t(`errors:${code}`);
}

/** The words of the notice the sign-in options stand under (D-530). */
export function signInNoticeText(
  notice: NonNullable<SignInViewModel['notice']>,
  t: AuthT,
): SignInNoticeText {
  const { code } = notice;
  if (code === 'provider_unavailable') {
    return { kind: 'error', text: t('common:device.auth.providerUnavailable') };
  }
  if (code === 'age_signal_required') {
    // Something to do in the phone app, not a refusal.
    return { kind: 'info', text: t('errors:age_signal_required') };
  }
  if (code === 'generic') {
    return { kind: 'error', text: t('errors:generic') };
  }
  return { kind: 'error', text: errorSentence(code, t) };
}
