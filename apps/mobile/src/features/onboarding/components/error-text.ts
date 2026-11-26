import type { ErrorCode } from '@citizenrun/shared';

import type { StepT } from './step-translation';

/**
 * The sentence of an error code. The one code whose sentence holds a date reads the generic
 * sentence here: the step that knows the date words it itself.
 */
export function errorText(code: ErrorCode, t: StepT): string {
  return code === 'handle_change_too_soon' ? t('errors:generic') : t(`errors:${code}`);
}
