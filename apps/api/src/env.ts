import { isAbsolute } from 'node:path';
import { EnvError, brandVariant, parseEnv, variantForAppEnv } from '@citizenrun/shared';
import type { BrandVariantName, Logger } from '@citizenrun/shared';
import { z } from 'zod';

/** One owner-input variable the API reads and the owner input that provides it (D-416). */
export type ApiOwnerInputVariable = {
  variable: 'RESEND_API_KEY' | 'EMAIL_FROM' | 'ADMIN_EMAILS';
  ownerInput: 'OI-resend' | 'OI-admin-emails';
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
  CLIENT_IP_HEADER: string | null;
  RESEND_API_KEY: string | null;
  EMAIL_FROM: string | null;
  ADMIN_EMAILS: readonly string[] | null;
  /** What loadEnv found for the owner inputs, for the start-up report. */
  ownerInputReport: Readonly<{
    missing: readonly ApiOwnerInputVariable[];
    invalid: readonly ApiOwnerInputVariable[];
  }>;
  /** Named values derived from APP_ENV and NODE_ENV here and nowhere else. */
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
]);

type OwnerVariable = ApiOwnerInputVariable['variable'];
type Source = Readonly<Record<string, string | undefined>>;

// Variables the API must never hold: the legal bucket (INV-53) and the AI key and budget (INV-16).
const REFUSED_PREFIX = 'LEGAL_';
const REFUSED_NAMES: ReadonlySet<string> = new Set(['ANTHROPIC_API_KEY', 'AI_BUDGET_USD']);

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
    // Optional for now: unset, the rate limiter uses the socket's address.
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

type AdminEmailsResult =
  { kind: 'unset' } | { kind: 'invalid' } | { kind: 'ok'; value: readonly string[] };

// Trimmed and lower-cased items, empty items dropped; an empty result is unset.
function parseAdminEmails(raw: string): AdminEmailsResult {
  if (raw.length > MAX_ADMIN_EMAILS_RAW_LENGTH) {
    return { kind: 'invalid' };
  }
  const items = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  if (items.length === 0) {
    return { kind: 'unset' };
  }
  if (items.length > MAX_ADMIN_EMAILS) {
    return { kind: 'invalid' };
  }
  if (!items.every((item) => AdminEmailSchema.safeParse(item).success)) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', value: Object.freeze(items) };
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
  missing: readonly ApiOwnerInputVariable[];
  invalid: readonly ApiOwnerInputVariable[];
};

// The owner inputs (D-416): null when unset in local and ci, required in staging and
// production, the key and the sender together, and a malformed value treated as unset in local and
// ci (reported as invalid) and refused in staging and production.
function parseOwnerInputs(
  appEnv: ApiEnv['APP_ENV'],
  source: Source,
  problems: Set<string>,
): OwnerValues {
  const isDeployed = appEnv === 'staging' || appEnv === 'production';
  const rawKey = source.RESEND_API_KEY;
  const rawFrom = source.EMAIL_FROM;
  const rawAdmins = source.ADMIN_EMAILS;
  const admins =
    rawAdmins === undefined ? ({ kind: 'unset' } as const) : parseAdminEmails(rawAdmins);

  const unset = new Set<OwnerVariable>();
  if (rawKey === undefined) unset.add('RESEND_API_KEY');
  if (rawFrom === undefined) unset.add('EMAIL_FROM');
  if (admins.kind === 'unset') unset.add('ADMIN_EMAILS');

  if (isDeployed && unset.size > 0) {
    // A deployed service needs every owner input (D-557); each missing one is named alone.
    for (const variable of unset) {
      problems.add(variable);
    }
  } else if ((rawKey === undefined) !== (rawFrom === undefined)) {
    // The pairing refusal reads only whether each is set, before any pattern.
    problems.add('RESEND_API_KEY');
    problems.add('EMAIL_FROM');
  }

  const invalid = new Set<OwnerVariable>();
  if (rawKey !== undefined && !isResendApiKey(rawKey)) invalid.add('RESEND_API_KEY');
  if (rawFrom !== undefined && !isEmailFrom(rawFrom)) invalid.add('EMAIL_FROM');
  if (admins.kind === 'invalid') invalid.add('ADMIN_EMAILS');

  if (isDeployed) {
    for (const variable of invalid) {
      problems.add(variable);
    }
  }

  // RESEND_API_KEY and EMAIL_FROM are one input: a malformed half leaves both unset in local and ci.
  const pairUsable = !invalid.has('RESEND_API_KEY') && !invalid.has('EMAIL_FROM');
  return {
    RESEND_API_KEY: pairUsable && rawKey !== undefined ? rawKey : null,
    EMAIL_FROM: pairUsable && rawFrom !== undefined ? rawFrom : null,
    ADMIN_EMAILS: admins.kind === 'ok' ? admins.value : null,
    missing: isDeployed ? Object.freeze([]) : inReportOrder(unset),
    invalid: isDeployed ? Object.freeze([]) : inReportOrder(invalid),
  };
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
    const badHost = checkPublicUrlHost(appEnv, infra.PUBLIC_URL, brandVariant(variant).host);
    if (badHost !== null) {
      problems.add(badHost);
    }
  }
  if (infra === null || problems.size > 0) {
    throw new EnvError([...problems].sort());
  }

  return Object.freeze({
    ...infra,
    APP_ENV: appEnv,
    RESEND_API_KEY: owner.RESEND_API_KEY,
    EMAIL_FROM: owner.EMAIL_FROM,
    ADMIN_EMAILS: owner.ADMIN_EMAILS,
    ownerInputReport: Object.freeze({ missing: owner.missing, invalid: owner.invalid }),
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
