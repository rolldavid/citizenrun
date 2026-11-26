import type { ErrorCode } from '@citizenrun/shared';

import type { SettingsT } from './settings-translation';

/**
 * The sentence of an error code. A failure with no code of its own, and the one code whose
 * sentence holds a date these screens do not have, read the generic sentence.
 */
export function errorText(code: ErrorCode | 'generic', t: SettingsT): string {
  return code === 'generic' || code === 'handle_change_too_soon'
    ? t('errors:generic')
    : t(`errors:${code}`);
}
