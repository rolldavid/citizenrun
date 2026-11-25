// The account constants (L-account-constants). Handle, display-name, link and new-account limits are
// the shared rules' own constants and are not repeated here (D-473, D-475); the avatar upload limit
// is AVATAR_UPLOADS_PER_DAY in uploads.ts.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Digits in an email sign-in code (L-account-constants). */
export const EMAIL_CODE_DIGITS = 6;

/** Milliseconds an email sign-in code stays valid after its last send (L-account-constants). */
export const EMAIL_CODE_TTL_MS = 10 * MINUTE_MS;

/** Wrong tries one email sign-in challenge allows before it is deleted (L-account-constants). */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

/** Code emails one address receives in an hour (L-account-constants, D-400). */
export const EMAIL_CODES_PER_EMAIL_PER_HOUR = 3;

/** Email sign-in starts one network address may make in an hour (L-account-constants). */
export const EMAIL_CODES_PER_ADDRESS_PER_HOUR = 10;

/** Milliseconds between two sends of one challenge's code (L-account-constants). */
export const EMAIL_CODE_RESEND_MIN_MS = 30 * SECOND_MS;

/** Sign-in code emails sent in one UTC day before email sign-in pauses (L-account-constants). */
export const SIGNIN_EMAIL_DAILY_CEILING = 2000;

/** The day's sign-in email count that raises the cost alert (L-account-constants). */
export const SIGNIN_EMAIL_ALERT_AT = 1000;

/** Milliseconds a session lives from its last extension (L-account-constants). */
export const SESSION_TTL_MS = 90 * DAY_MS;

/** Milliseconds after its creation that a session ends, however often it was extended (L-account-constants). */
export const SESSION_ABSOLUTE_MAX_MS = 365 * DAY_MS;

/** Milliseconds between two extensions of one session's expiry (L-account-constants, D-231). */
export const SESSION_EXTEND_STEP_MS = DAY_MS;

/** Milliseconds between two writes of one session's last-seen time (L-account-constants). */
export const SESSION_LAST_SEEN_STEP_MS = HOUR_MS;

/** Milliseconds a sign-in counts as recent for admin routes (L-account-constants). */
export const ADMIN_RECENT_SIGNIN_MS = 12 * HOUR_MS;

/** Milliseconds a sign-in counts as recent for export, export download and deletion (L-account-constants). */
export const SENSITIVE_RECENT_SIGNIN_MS = 15 * MINUTE_MS;

/** Milliseconds a sign-in nonce stays usable (L-account-constants, D-241). */
export const NONCE_TTL_MS = 10 * MINUTE_MS;

/** Milliseconds an Apple hand-off code stays usable (L-account-constants, D-169). */
export const APPLE_HANDOFF_TTL_MS = MINUTE_MS;

/** Seconds a signed Apple state token stays valid, equal to the nonce's life (L-account-constants). */
export const APPLE_STATE_TTL_S = 600;

/** Fewest issues a user picks (L-account-constants). */
export const ISSUES_MIN = 3;

/** Most issues a user picks (L-account-constants). */
export const ISSUES_MAX = 10;

/** Most picked issues a user stars (L-account-constants). */
export const STARRED_MAX = 3;

/** Most code points in a bio after normalisation (L-account-constants). */
export const BIO_MAX = 160;

/** Accounts one network address may create in a day (L-account-constants). */
export const SIGNUPS_PER_ADDRESS_PER_DAY = 5;

/** Data exports a user may request in a day (L-account-constants). */
export const EXPORTS_PER_DAY = 1;

/** Milliseconds an export file is kept after it is ready (L-account-constants). */
export const EXPORT_FILE_TTL_MS = 24 * HOUR_MS;

/** Seconds a signed export download link stays valid (L-account-constants). */
export const EXPORT_LINK_TTL_S = 300;

/** Milliseconds after a deletion request by which the account is deleted (L-account-constants). */
export const DELETION_COMPLETES_MS = 24 * HOUR_MS;

/** Sessions one user may hold; creating another ends the oldest (L-account-constants, D-461). */
export const SESSIONS_PER_USER_MAX = 20;

/** The highest unread notification count the API reports (L-account-constants, D-435). */
export const UNREAD_NOTIFICATIONS_CAP = 1000;
