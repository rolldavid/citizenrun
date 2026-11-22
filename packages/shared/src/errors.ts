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
export function assertNever(value: never): never {
  void value;
  throw new Error('Unexpected value');
}
