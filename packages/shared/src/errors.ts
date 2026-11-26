/**
 * The error-code registry (L-error-registry): each code has one HTTP status and one fixed developer
 * message. Messages are never shown to users and never hold input; clients show `errors:<code>`.
 */
export const ERROR_CODES = {
  invalid_request: { status: 400, message: 'The request is not valid.' },
  invalid_cursor: { status: 400, message: 'The cursor is not valid.' },
  client_header_required: {
    status: 400,
    message: 'The X-OS-Client header is missing or malformed.',
  },
  not_found: { status: 404, message: 'Not found.' },
  payload_too_large: { status: 413, message: 'The request body is too large.' },
  upgrade_required: { status: 426, message: 'This client version is no longer supported.' },
  rate_limited: { status: 429, message: 'Too many requests.' },
  internal: { status: 500, message: 'Internal error.' },
  unavailable: { status: 503, message: 'A dependency is unavailable.' },
  signature_invalid: { status: 400, message: 'Signature or token does not verify.' },
  unauthenticated: { status: 401, message: 'Sign-in required.' },
  forbidden: { status: 403, message: 'Not allowed.' },
  origin_rejected: { status: 403, message: 'Origin check failed.' },
  account_suspended: { status: 403, message: 'Account is suspended.' },
  recent_sign_in_required: { status: 403, message: 'A recent sign-in is required.' },
  onboarding_incomplete: { status: 403, message: 'Onboarding is not finished.' },
  daily_limit_reached: { status: 429, message: 'Daily limit reached.' },
  email_undeliverable: { status: 422, message: 'Email to this address is not deliverable.' },
  email_signin_paused: { status: 503, message: 'Email sign-in is paused for today.' },
  code_invalid: { status: 422, message: 'Code is not valid.' },
  code_expired: { status: 422, message: 'Code has expired.' },
  code_attempts_exhausted: { status: 422, message: 'Too many code attempts.' },
  identity_token_invalid: { status: 422, message: 'Identity token is not valid.' },
  nonce_invalid: { status: 422, message: 'Nonce is not valid.' },
  handoff_invalid: { status: 422, message: 'Hand-off code is not valid.' },
  provider_not_configured: { status: 503, message: 'Sign-in provider is not configured.' },
  signup_details_required: { status: 422, message: 'Sign-up details are required.' },
  consent_version_outdated: { status: 422, message: 'Agreement version is not current.' },
  signup_limit_reached: { status: 429, message: 'Sign-up limit for this address reached.' },
  account_deleting: { status: 403, message: 'Account is being deleted.' },
  reauth_mismatch: { status: 409, message: 'Re-authentication resolved to another account.' },
  email_already_set: { status: 409, message: 'Account already has an email.' },
  email_in_use: { status: 409, message: 'Email belongs to another account.' },
  handle_taken: { status: 409, message: 'Handle is already in use.' },
  handle_reserved: { status: 409, message: 'Handle is reserved.' },
  handle_change_too_soon: { status: 422, message: 'Handle changed too recently.' },
  ai_consent_required: { status: 422, message: 'AI screening answer is required.' },
  unknown_issue: { status: 422, message: 'Unknown issue id.' },
  upload_invalid: { status: 422, message: 'Upload cannot be used.' },
  onboarding_step_mismatch: { status: 409, message: 'Onboarding step not reached.' },
  export_not_ready: { status: 409, message: 'Export is not ready.' },
  unavailable_in_state: { status: 403, message: 'Not available in this state.' },
  age_signal_required: { status: 422, message: 'Store age signal is required.' },
  upload_too_large: { status: 422, message: 'Upload is larger than allowed.' },
  bundle_busy: { status: 409, message: 'Another bundle action is in progress.' },
  bundle_not_reloadable: { status: 409, message: 'The bundle cannot be reloaded.' },
  bundle_not_held: { status: 409, message: 'The bundle is not held.' },
  bundle_not_revertable: { status: 409, message: 'The bundle cannot be reverted.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Field-level codes in the `fields` map of an error envelope (ErrorEnvelope). */
export const FIELD_CODES = [
  'required',
  'invalid_type',
  'too_short',
  'too_long',
  'too_few',
  'too_many',
  'out_of_range',
  'invalid_format',
  'invalid_value',
  'not_allowed',
] as const;

export type FieldCode = (typeof FIELD_CODES)[number];

/** An error a handler or service throws; one middleware turns it into the error envelope. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Readonly<Record<string, FieldCode>>;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ErrorCode,
    options?: { fields?: Readonly<Record<string, FieldCode>>; retryAfterSeconds?: number },
  ) {
    super(ERROR_CODES[code].message);
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.fields = options?.fields ?? {};
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

/** Ends an exhaustive switch; throws without the value, which may come from input. */
export function assertNever(value: never): never;
export function assertNever(): never {
  throw new Error('Unexpected value');
}
