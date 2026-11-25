import { isAbsolute } from 'node:path';
import {
  BrandValueMissingError,
  EnvError,
  brandVariant,
  mailHost,
  parseEnv,
  variantForAppEnv,
} from '@citizenrun/shared';
import type { BrandVariantName, Logger } from '@citizenrun/shared';
import { z } from 'zod';

/** One owner-input variable the API reads and the owner input that provides it (D-416). */
export type ApiOwnerInputVariable = {
  variable:
    | 'RESEND_API_KEY'
    | 'EMAIL_FROM'
    | 'ADMIN_EMAILS'
    | 'REVIEW_SIGNIN_EMAILS'
    | 'REVIEW_SIGNIN_CODE'
    | 'APPLE_TEAM_ID'
    | 'APPLE_KEY_ID'
    | 'APPLE_PRIVATE_KEY'
    | 'APPLE_BUNDLE_ID'
    | 'APPLE_SERVICES_ID'
    | 'GOOGLE_CLIENT_IDS';
  ownerInput:
    | 'OI-resend'
    | 'OI-admin-emails'
    | 'OI-store-submission'
    | 'OI-apple-identifiers'
    | 'OI-google-oauth';
};

/** The API's validated environment and the named values derived from it. */
export type ApiEnv = Readonly<{
  NODE_ENV: 'production' | 'development' | 'test';
  APP_ENV: 'local' | 'ci' | 'staging' | 'production';
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DATABASE_URL: string;
  PUBLIC_URL: string;
  WEB_DIST_DIR: string;
  ENABLE_DEV_ROUTES: boolean;
  MIN_CLIENT_VERSION_IOS: string;
  MIN_CLIENT_VERSION_ANDROID: string;
  MIN_CLIENT_VERSION_WEB: string;
  MEDIA_BUCKET: string;
  MEDIA_ENDPOINT: string;
  MEDIA_REGION: string;
  MEDIA_ACCESS_KEY_ID: string;
  MEDIA_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
  /** 64 lower-case hex characters: the root of the derived keys (D-244). */
  APP_SECRET: string;
  /** The secret in force before the last rotation, or null (no rotation). */
  APP_SECRET_PREVIOUS: string | null;
  CLIENT_IP_HEADER: string | null;
  RESEND_API_KEY: string | null;
  EMAIL_FROM: string | null;
  ADMIN_EMAILS: readonly string[] | null;
  /** The validated raw list of review sign-in addresses (L-review-signin), or null. */
  REVIEW_SIGNIN_EMAILS: string | null;
  REVIEW_SIGNIN_CODE: string | null;
  APPLE_TEAM_ID: string | null;
  APPLE_KEY_ID: string | null;
  /** The PKCS#8 PEM with its line feeds restored, or null. */
  APPLE_PRIVATE_KEY: string | null;
  APPLE_BUNDLE_ID: string | null;
  APPLE_SERVICES_ID: string | null;
  /** The validated raw list of Google client ids, or null. */
  GOOGLE_CLIENT_IDS: string | null;
  /** What loadEnv found for the owner inputs, for the start-up report. */
  ownerInputReport: Readonly<{
    missing: readonly ApiOwnerInputVariable[];
    invalid: readonly ApiOwnerInputVariable[];
  }>;
  /**
   * Named values derived from APP_ENV, NODE_ENV and PUBLIC_URL here and nowhere else.
   * SESSION_COOKIE_NAME is the session cookie's wire name (L-session-middleware, D-231).
   */
  SESSION_COOKIE_NAME: '__Host-os_session' | 'os_session';
  sessionCookieSecure: boolean;
  devRoutes: boolean;
  captureMail: boolean;
  isIndexable: boolean;
  mapUrlsFromRequestOrigin: boolean;
  redirectHttp: boolean;
  strictResponses: boolean;
  variant: BrandVariantName;
}>;

/** The owner-input variables of the API, in report order. */
export const API_OWNER_INPUTS: readonly ApiOwnerInputVariable[] = Object.freeze([
  Object.freeze({ variable: 'RESEND_API_KEY', ownerInput: 'OI-resend' } as const),
  Object.freeze({ variable: 'EMAIL_FROM', ownerInput: 'OI-resend' } as const),
  Object.freeze({ variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' } as const),
  Object.freeze({ variable: 'REVIEW_SIGNIN_EMAILS', ownerInput: 'OI-store-submission' } as const),
  Object.freeze({ variable: 'REVIEW_SIGNIN_CODE', ownerInput: 'OI-store-submission' } as const),
  Object.freeze({ variable: 'APPLE_TEAM_ID', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'APPLE_KEY_ID', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'APPLE_PRIVATE_KEY', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'APPLE_BUNDLE_ID', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'APPLE_SERVICES_ID', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'GOOGLE_CLIENT_IDS', ownerInput: 'OI-google-oauth' } as const),
]);

// The owner inputs a deployed service cannot start without (D-557); every other one is optional.
const REQUIRED_WHEN_DEPLOYED: ReadonlySet<string> = new Set([
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'ADMIN_EMAILS',
]);

type OwnerVariable = ApiOwnerInputVariable['variable'];
type Source = Readonly<Record<string, string | undefined>>;

// Variables the API must never hold: the legal bucket (INV-53) and the AI key and budget (INV-16).
const REFUSED_PREFIX = 'LEGAL_';
const REFUSED_NAMES: ReadonlySet<string> = new Set(['ANTHROPIC_API_KEY', 'AI_BUDGET_USD']);
// Refused at any value, the empty one included: with it set, the email provider's library prints
// the provider's raw error text outside the logger (D-807).
const RESEND_DEBUG = 'RESEND_DEBUG';

// Bounds on raw values: every string has a maximum length.
const MAX_URL_LENGTH = 2048;
const MAX_PATH_LENGTH = 4096;
const MAX_MEDIA_VALUE_LENGTH = 200;
const MAX_ADMIN_EMAIL_LENGTH = 254;
const MAX_ADMIN_EMAILS = 50;
// The longest list of MAX_ADMIN_EMAILS well-formed items with their commas.
const MAX_ADMIN_EMAILS_RAW_LENGTH = MAX_ADMIN_EMAILS * (MAX_ADMIN_EMAIL_LENGTH + 1);

const RESEND_API_KEY_PATTERN = /^re_[A-Za-z0-9_-]{10,200}$/;
const EMAIL_FROM_MAX_LENGTH = 320;
const EMAIL_FROM_PATTERN = /^([^<>\r\n]{1,100} <[^\s@<>]+@[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+)$/;
// L-client-version.
const CLIENT_VERSION_PATTERN = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;
const CLIENT_IP_HEADER_PATTERN = /^[a-z0-9-]{1,64}$/;
const APP_SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;
const REVIEW_SIGNIN_CODE_PATTERN = /^[0-9]{6}$/;
const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/;
const APPLE_CLIENT_ID_PATTERN = /^[A-Za-z0-9.-]{1,155}$/;
const APPLE_PRIVATE_KEY_MAX_LENGTH = 8192;
const PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
const PEM_FOOTER = '-----END PRIVATE KEY-----';
const GOOGLE_CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const GOOGLE_CLIENT_IDS_MAX_LENGTH = 4096;

const AppEnvSchema = z.object({ APP_ENV: z.enum(['local', 'ci', 'staging', 'production']) });

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const clientVersion = z.string().max(16).regex(CLIENT_VERSION_PATTERN).default('0.0.0');

function urlWithProtocol(protocols: readonly string[]): z.ZodType<string, string> {
  return z
    .string()
    .max(MAX_URL_LENGTH)
    .refine((value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    });
}

// An http or https origin: no path, no query, no fragment, no credentials and no trailing slash.
const originUrl = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch {
      return false;
    }
  });

const mediaValue = z.string().min(1).max(MAX_MEDIA_VALUE_LENGTH);

// 64 hex characters, stored lower-case.
const appSecret = z
  .string()
  .regex(APP_SECRET_PATTERN)
  .transform((value) => value.toLowerCase());

function buildApiEnvSchema(defaultWebDistDir: string) {
  return z.object({
    NODE_ENV: z.enum(['production', 'development', 'test']),
    PORT: z
      .string()
      .regex(/^[0-9]{1,5}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(65_535)),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
    PUBLIC_URL: originUrl,
    WEB_DIST_DIR: z
      .string()
      .max(MAX_PATH_LENGTH)
      .refine((value) => isAbsolute(value))
      .default(defaultWebDistDir),
    ENABLE_DEV_ROUTES: booleanFlag,
    MIN_CLIENT_VERSION_IOS: clientVersion,
    MIN_CLIENT_VERSION_ANDROID: clientVersion,
    MIN_CLIENT_VERSION_WEB: clientVersion,
    MEDIA_BUCKET: mediaValue,
    MEDIA_ENDPOINT: urlWithProtocol(['http:', 'https:']),
    MEDIA_REGION: mediaValue,
    MEDIA_ACCESS_KEY_ID: mediaValue,
    MEDIA_SECRET_ACCESS_KEY: mediaValue,
    S3_FORCE_PATH_STYLE: booleanFlag,
    APP_SECRET: appSecret,
    APP_SECRET_PREVIOUS: appSecret.optional().transform((value) => value ?? null),
    // Unset in local and ci, the rate limiter uses the socket's address; a deployed service
    // needs it (checked in loadEnv).
    CLIENT_IP_HEADER: z
      .string()
      .max(64)
      .transform((value) => value.toLowerCase())
      .pipe(z.string().regex(CLIENT_IP_HEADER_PATTERN))
      .optional()
      .transform((value) => value ?? null),
  });
}

const AdminEmailSchema = z.email().max(MAX_ADMIN_EMAIL_LENGTH);

type Parsed<T> = { kind: 'unset' } | { kind: 'invalid' } | { kind: 'ok'; value: T };

const UNSET = Object.freeze({ kind: 'unset' } as const);
const INVALID = Object.freeze({ kind: 'invalid' } as const);

// Trimmed and lower-cased items, empty items dropped; an empty result is unset.
function parseEmailList(raw: string): Parsed<readonly string[]> {
  if (raw.length > MAX_ADMIN_EMAILS_RAW_LENGTH) {
    return INVALID;
  }
  const items = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  if (items.length === 0) {
    return UNSET;
  }
  if (items.length > MAX_ADMIN_EMAILS) {
    return INVALID;
  }
  if (!items.every((item) => AdminEmailSchema.safeParse(item).success)) {
    return INVALID;
  }
  return { kind: 'ok', value: Object.freeze(items) };
}

function matching(pattern: RegExp): (raw: string) => Parsed<string> {
  return (raw) => (pattern.test(raw) ? { kind: 'ok', value: raw } : INVALID);
}

// Each two-character sequence `\n` becomes a line feed (a key pasted into a .env file); a key
// set with real line feeds is unchanged.
function parseApplePrivateKey(raw: string): Parsed<string> {
  if (raw.length > APPLE_PRIVATE_KEY_MAX_LENGTH) {
    return INVALID;
  }
  const pem = raw.replaceAll('\\n', '\n').trim();
  return pem.startsWith(PEM_HEADER) && pem.endsWith(PEM_FOOTER)
    ? { kind: 'ok', value: pem }
    : INVALID;
}

// Comma-separated ids, trimmed, empty items dropped; an empty list is unset. The raw value is kept.
function parseGoogleClientIds(raw: string): Parsed<string> {
  if (raw.length > GOOGLE_CLIENT_IDS_MAX_LENGTH) {
    return INVALID;
  }
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0) {
    return UNSET;
  }
  return items.every((item) => GOOGLE_CLIENT_ID_PATTERN.test(item))
    ? { kind: 'ok', value: raw }
    : INVALID;
}

function isResendApiKey(value: string): boolean {
  return RESEND_API_KEY_PATTERN.test(value);
}

function isEmailFrom(value: string): boolean {
  return value.length <= EMAIL_FROM_MAX_LENGTH && EMAIL_FROM_PATTERN.test(value);
}

function inReportOrder(variables: ReadonlySet<OwnerVariable>): readonly ApiOwnerInputVariable[] {
  return Object.freeze(API_OWNER_INPUTS.filter((row) => variables.has(row.variable)));
}

// Runs a parse step; an EnvError adds its names to `problems` and gives null.
function collect<T>(problems: Set<string>, step: () => T): T | null {
  try {
    return step();
  } catch (error) {
    if (error instanceof EnvError) {
      for (const name of error.variables) {
        problems.add(name);
      }
      return null;
    }
    throw error;
  }
}

type OwnerValues = {
  RESEND_API_KEY: string | null;
  EMAIL_FROM: string | null;
  ADMIN_EMAILS: readonly string[] | null;
  REVIEW_SIGNIN_EMAILS: string | null;
  REVIEW_SIGNIN_CODE: string | null;
  APPLE_TEAM_ID: string | null;
  APPLE_KEY_ID: string | null;
  APPLE_PRIVATE_KEY: string | null;
  APPLE_BUNDLE_ID: string | null;
  APPLE_SERVICES_ID: string | null;
  GOOGLE_CLIENT_IDS: string | null;
  /** Whether REVIEW_SIGNIN_EMAILS holds anything, and its parsed addresses, for the start checks. */
  reviewEmailsSet: boolean;
  reviewAddresses: readonly string[];
  missing: readonly ApiOwnerInputVariable[];
  invalid: readonly ApiOwnerInputVariable[];
};

function valueOf<T>(parsed: Parsed<T>): T | null {
  return parsed.kind === 'ok' ? parsed.value : null;
}

// The owner inputs (D-416): null when unset; RESEND_API_KEY, EMAIL_FROM and ADMIN_EMAILS required
// in staging and production (D-557), every other one optional everywhere; the key and the sender
// together; and a malformed value treated as unset in local and ci (reported as invalid) and
// refused in staging and production.
function parseOwnerInputs(
  appEnv: ApiEnv['APP_ENV'],
  source: Source,
  problems: Set<string>,
): OwnerValues {
  const isDeployed = appEnv === 'staging' || appEnv === 'production';
  const read = <T>(name: OwnerVariable, parse: (raw: string) => Parsed<T>): Parsed<T> => {
    const raw = source[name];
    return raw === undefined ? UNSET : parse(raw);
  };
  const rawKey = source.RESEND_API_KEY;
  const rawFrom = source.EMAIL_FROM;
  const parsed = {
    RESEND_API_KEY: read('RESEND_API_KEY', (raw) =>
      isResendApiKey(raw) ? { kind: 'ok', value: raw } : INVALID,
    ),
    EMAIL_FROM: read('EMAIL_FROM', (raw) =>
      isEmailFrom(raw) ? { kind: 'ok', value: raw } : INVALID,
    ),
    ADMIN_EMAILS: read('ADMIN_EMAILS', parseEmailList),
    REVIEW_SIGNIN_EMAILS: read('REVIEW_SIGNIN_EMAILS', parseEmailList),
    REVIEW_SIGNIN_CODE: read('REVIEW_SIGNIN_CODE', matching(REVIEW_SIGNIN_CODE_PATTERN)),
    APPLE_TEAM_ID: read('APPLE_TEAM_ID', matching(APPLE_ID_PATTERN)),
    APPLE_KEY_ID: read('APPLE_KEY_ID', matching(APPLE_ID_PATTERN)),
    APPLE_PRIVATE_KEY: read('APPLE_PRIVATE_KEY', parseApplePrivateKey),
    APPLE_BUNDLE_ID: read('APPLE_BUNDLE_ID', matching(APPLE_CLIENT_ID_PATTERN)),
    APPLE_SERVICES_ID: read('APPLE_SERVICES_ID', matching(APPLE_CLIENT_ID_PATTERN)),
    GOOGLE_CLIENT_IDS: read('GOOGLE_CLIENT_IDS', parseGoogleClientIds),
  } satisfies Record<OwnerVariable, Parsed<unknown>>;

  const unset = new Set<OwnerVariable>();
  const invalid = new Set<OwnerVariable>();
  for (const row of API_OWNER_INPUTS) {
    const kind = parsed[row.variable].kind;
    if (kind === 'unset') unset.add(row.variable);
    if (kind === 'invalid') invalid.add(row.variable);
  }

  const missingRequired = [...unset].filter((variable) => REQUIRED_WHEN_DEPLOYED.has(variable));
  if (isDeployed && missingRequired.length > 0) {
    // A deployed service needs these owner inputs (D-557); each missing one is named alone.
    for (const variable of missingRequired) {
      problems.add(variable);
    }
  } else if ((rawKey === undefined) !== (rawFrom === undefined)) {
    // The pairing refusal reads only whether each is set, before any pattern.
    problems.add('RESEND_API_KEY');
    problems.add('EMAIL_FROM');
  }

  if (isDeployed) {
    for (const variable of invalid) {
      problems.add(variable);
    }
  }

  // RESEND_API_KEY and EMAIL_FROM are one input: a malformed half leaves both unset in local and ci.
  const pairUsable = !invalid.has('RESEND_API_KEY') && !invalid.has('EMAIL_FROM');
  const reviewEmails = parsed.REVIEW_SIGNIN_EMAILS;
  // Each variable reported missing is one a deployed service may run without.
  const reportedMissing = isDeployed
    ? new Set([...unset].filter((variable) => !REQUIRED_WHEN_DEPLOYED.has(variable)))
    : unset;
  return {
    RESEND_API_KEY: pairUsable ? valueOf(parsed.RESEND_API_KEY) : null,
    EMAIL_FROM: pairUsable ? valueOf(parsed.EMAIL_FROM) : null,
    ADMIN_EMAILS: valueOf(parsed.ADMIN_EMAILS),
    REVIEW_SIGNIN_EMAILS: reviewEmails.kind === 'ok' ? (source.REVIEW_SIGNIN_EMAILS ?? null) : null,
    REVIEW_SIGNIN_CODE: valueOf(parsed.REVIEW_SIGNIN_CODE),
    APPLE_TEAM_ID: valueOf(parsed.APPLE_TEAM_ID),
    APPLE_KEY_ID: valueOf(parsed.APPLE_KEY_ID),
    APPLE_PRIVATE_KEY: valueOf(parsed.APPLE_PRIVATE_KEY),
    APPLE_BUNDLE_ID: valueOf(parsed.APPLE_BUNDLE_ID),
    APPLE_SERVICES_ID: valueOf(parsed.APPLE_SERVICES_ID),
    GOOGLE_CLIENT_IDS: valueOf(parsed.GOOGLE_CLIENT_IDS),
    reviewEmailsSet: reviewEmails.kind !== 'unset',
    reviewAddresses: reviewEmails.kind === 'ok' ? reviewEmails.value : Object.freeze([]),
    missing: inReportOrder(reportedMissing),
    invalid: isDeployed ? Object.freeze([]) : inReportOrder(invalid),
  };
}

/**
 * The names the review sign-in start checks refuse, in order (L-review-signin, CTL-21, D-476):
 * `REVIEW_SIGNIN_EMAILS` set without a six-digit `REVIEW_SIGNIN_CODE`, in every environment; a
 * review address that is also in `ADMIN_EMAILS`, in every environment; and with
 * `APP_ENV=production` only, a review address whose host is not `mailHost()`. While the brand has
 * no domain, `mailHost()` throws and every review address fails, naming OI-domain too.
 */
export function checkReviewSignIn(input: {
  appEnv: ApiEnv['APP_ENV'];
  reviewEmailsSet: boolean;
  reviewCode: string | undefined;
  reviewAddresses: readonly string[];
  adminEmails: readonly string[] | null;
  mailHostOf?: () => string;
}): string[] {
  const refused: string[] = [];
  if (input.reviewEmailsSet && !REVIEW_SIGNIN_CODE_PATTERN.test(input.reviewCode ?? '')) {
    refused.push('REVIEW_SIGNIN_EMAILS', 'REVIEW_SIGNIN_CODE');
  }
  const admins = new Set(input.adminEmails ?? []);
  if (input.reviewAddresses.some((address) => admins.has(address))) {
    refused.push('REVIEW_SIGNIN_EMAILS', 'ADMIN_EMAILS');
  }
  if (input.appEnv === 'production' && input.reviewAddresses.length > 0) {
    let host: string | null;
    try {
      host = (input.mailHostOf ?? mailHost)().toLowerCase();
    } catch (error) {
      if (!(error instanceof BrandValueMissingError)) {
        throw error;
      }
      host = null;
    }
    if (host === null) {
      refused.push('REVIEW_SIGNIN_EMAILS', 'OI-domain');
    } else if (
      input.reviewAddresses.some((address) => address.slice(address.lastIndexOf('@') + 1) !== host)
    ) {
      refused.push('REVIEW_SIGNIN_EMAILS');
    }
  }
  return [...new Set(refused)];
}

// A deployed service serves its origin over https only (CTL-01, D-807); local and ci may use http.
function isHttpsOnDeployed(appEnv: ApiEnv['APP_ENV'], publicUrl: string): boolean {
  if (appEnv !== 'staging' && appEnv !== 'production') {
    return true;
  }
  try {
    return new URL(publicUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The variable a deployed service refuses when `PUBLIC_URL`'s host differs from the brand
 * variant's host, or null. Local and CI processes, and a variant whose host the
 * owner has not given yet, are never refused.
 */
export function checkPublicUrlHost(
  appEnv: ApiEnv['APP_ENV'],
  publicUrl: string,
  variantHost: string | null,
): string | null {
  if (appEnv !== 'staging' && appEnv !== 'production') {
    return null;
  }
  if (variantHost === null) {
    return null;
  }
  let host: string;
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    return 'PUBLIC_URL';
  }
  return host === variantHost.toLowerCase() ? null : 'PUBLIC_URL';
}

/**
 * Parses the API's environment. Throws EnvError naming each bad variable,
 * never a value. `source` defaults to the process environment, read only here.
 */
export function loadEnv(
  options: { defaultWebDistDir: string },
  source: Source = process.env,
): ApiEnv {
  // An empty value counts as unset.
  const values: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') {
      values[name] = value;
    }
  }

  const problems = new Set<string>();
  for (const name of Object.keys(values)) {
    if (name.startsWith(REFUSED_PREFIX) || REFUSED_NAMES.has(name)) {
      problems.add(name);
    }
  }
  if (source[RESEND_DEBUG] !== undefined) {
    problems.add(RESEND_DEBUG);
  }
  const appEnvResult = collect(problems, () => parseEnv(AppEnvSchema, values));
  if (appEnvResult === null || problems.size > 0) {
    throw new EnvError([...problems].sort());
  }
  const appEnv = appEnvResult.APP_ENV;

  const infra = collect(problems, () =>
    parseEnv(buildApiEnvSchema(options.defaultWebDistDir), values),
  );
  const owner = parseOwnerInputs(appEnv, values, problems);
  const variant = variantForAppEnv(appEnv);

  if (infra !== null) {
    if (infra.ENABLE_DEV_ROUTES && appEnv === 'production') {
      problems.add('ENABLE_DEV_ROUTES');
    }
    // Unset is allowed in local and ci only (D-240).
    if (infra.CLIENT_IP_HEADER === null && (appEnv === 'staging' || appEnv === 'production')) {
      problems.add('CLIENT_IP_HEADER');
    }
    if (!isHttpsOnDeployed(appEnv, infra.PUBLIC_URL)) {
      problems.add('PUBLIC_URL');
    }
    const badHost = checkPublicUrlHost(appEnv, infra.PUBLIC_URL, brandVariant(variant).host);
    if (badHost !== null) {
      problems.add(badHost);
    }
  }
  for (const name of checkReviewSignIn({
    appEnv,
    reviewEmailsSet: owner.reviewEmailsSet,
    reviewCode: values.REVIEW_SIGNIN_CODE,
    reviewAddresses: owner.reviewAddresses,
    adminEmails: owner.ADMIN_EMAILS,
  })) {
    problems.add(name);
  }
  if (infra === null || problems.size > 0) {
    throw new EnvError([...problems].sort());
  }

  const https = infra.PUBLIC_URL.startsWith('https://');
  return Object.freeze({
    ...infra,
    APP_ENV: appEnv,
    RESEND_API_KEY: owner.RESEND_API_KEY,
    EMAIL_FROM: owner.EMAIL_FROM,
    ADMIN_EMAILS: owner.ADMIN_EMAILS,
    REVIEW_SIGNIN_EMAILS: owner.REVIEW_SIGNIN_EMAILS,
    REVIEW_SIGNIN_CODE: owner.REVIEW_SIGNIN_CODE,
    APPLE_TEAM_ID: owner.APPLE_TEAM_ID,
    APPLE_KEY_ID: owner.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: owner.APPLE_PRIVATE_KEY,
    APPLE_BUNDLE_ID: owner.APPLE_BUNDLE_ID,
    APPLE_SERVICES_ID: owner.APPLE_SERVICES_ID,
    GOOGLE_CLIENT_IDS: owner.GOOGLE_CLIENT_IDS,
    ownerInputReport: Object.freeze({ missing: owner.missing, invalid: owner.invalid }),
    SESSION_COOKIE_NAME: https ? '__Host-os_session' : 'os_session',
    sessionCookieSecure: https,
    devRoutes: infra.ENABLE_DEV_ROUTES,
    captureMail: (appEnv === 'local' || appEnv === 'ci') && owner.RESEND_API_KEY === null,
    isIndexable: appEnv === 'production',
    mapUrlsFromRequestOrigin: appEnv === 'local',
    redirectHttp: appEnv === 'staging' || appEnv === 'production',
    strictResponses: infra.NODE_ENV === 'test',
    variant,
  });
}

/** The owner-input variables that are unset, in API_OWNER_INPUTS order. */
export function missingOwnerInputs(env: ApiEnv): readonly ApiOwnerInputVariable[] {
  return env.ownerInputReport.missing;
}

/**
 * Writes one `warn` line per unset owner input (`env.input_missing`) and one per malformed one
 * (`env.input_invalid`), each with the variable's name and its owner input, never a value.
 */
export function logMissingOwnerInputs(env: ApiEnv, logger: Logger): void {
  for (const row of missingOwnerInputs(env)) {
    logger.warn('env.input_missing', { variable: row.variable, ownerInput: row.ownerInput });
  }
  for (const row of env.ownerInputReport.invalid) {
    logger.warn('env.input_invalid', { variable: row.variable, ownerInput: row.ownerInput });
  }
}
