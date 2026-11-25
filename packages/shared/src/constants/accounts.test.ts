import { describe, expect, it } from 'vitest';
import * as accounts from './accounts.ts';

// Every value written out by hand from the account constants table (L-account-constants).
const EXPECTED: Record<string, number> = {
  EMAIL_CODE_DIGITS: 6,
  EMAIL_CODE_TTL_MS: 600_000,
  EMAIL_CODE_MAX_ATTEMPTS: 5,
  EMAIL_CODES_PER_EMAIL_PER_HOUR: 3,
  EMAIL_CODES_PER_ADDRESS_PER_HOUR: 10,
  EMAIL_CODE_RESEND_MIN_MS: 30_000,
  SIGNIN_EMAIL_DAILY_CEILING: 2000,
  SIGNIN_EMAIL_ALERT_AT: 1000,
  SESSION_TTL_MS: 7_776_000_000,
  SESSION_ABSOLUTE_MAX_MS: 31_536_000_000,
  SESSION_EXTEND_STEP_MS: 86_400_000,
  SESSION_LAST_SEEN_STEP_MS: 3_600_000,
  ADMIN_RECENT_SIGNIN_MS: 43_200_000,
  SENSITIVE_RECENT_SIGNIN_MS: 900_000,
  NONCE_TTL_MS: 600_000,
  APPLE_HANDOFF_TTL_MS: 60_000,
  APPLE_STATE_TTL_S: 600,
  ISSUES_MIN: 3,
  ISSUES_MAX: 10,
  STARRED_MAX: 3,
  BIO_MAX: 160,
  SIGNUPS_PER_ADDRESS_PER_DAY: 5,
  EXPORTS_PER_DAY: 1,
  EXPORT_FILE_TTL_MS: 86_400_000,
  EXPORT_LINK_TTL_S: 300,
  DELETION_COMPLETES_MS: 86_400_000,
  SESSIONS_PER_USER_MAX: 20,
  UNREAD_NOTIFICATIONS_CAP: 1000,
};

describe('account constants', () => {
  it('values equal the account constants table', () => {
    expect({ ...accounts }).toEqual(EXPECTED);
  });

  it('repeats no constant another rule owns', () => {
    for (const name of [
      'HANDLE_MIN',
      'HANDLE_MAX',
      'DISPLAY_NAME_MAX',
      'NEW_ACCOUNT_DAYS',
      'AVATAR_UPLOADS_PER_DAY',
    ]) {
      expect(Object.hasOwn(accounts, name)).toBe(false);
    }
  });
});
