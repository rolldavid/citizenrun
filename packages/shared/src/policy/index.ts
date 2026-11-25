export { FIRST_DAY_HOURS, NEW_ACCOUNT_DAYS, isFirstDay, isNewAccount } from './account-age.ts';
export {
  HANDLE_CHANGE_DAYS,
  HANDLE_HOLD_DAYS,
  HANDLE_MAX,
  HANDLE_MIN,
  RESERVED_HANDLE_WORDS,
  canChangeHandle,
  validateHandle,
} from './handle.ts';
export type { HandleError } from './handle.ts';
export { DISPLAY_NAME_MAX, normalizeDisplayName } from './display-name.ts';
export { LIMITS } from './limits.ts';
export {
  LINK_REL,
  SAFE_URL_MAX,
  SOURCE_URL_MAX,
  containsLink,
  linkify,
  parseSafeUrl,
} from './links.ts';
export type { TextSegment } from './links.ts';
