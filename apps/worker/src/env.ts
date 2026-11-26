import { EnvError, parseEnv } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';

/** One owner-input variable the worker reads and the owner input that provides it (D-416). */
export type WorkerOwnerInputVariable = {
  variable:
    | 'RESEND_API_KEY'
    | 'EMAIL_FROM'
    | 'ADMIN_EMAILS'
    | 'APPLE_TEAM_ID'
    | 'APPLE_KEY_ID'
    | 'APPLE_PRIVATE_KEY';
  ownerInput: 'OI-resend' | 'OI-admin-emails' | 'OI-apple-identifiers';
};

/** The worker's validated environment and the named values derived from it. */
export type WorkerEnv = Readonly<{
  NODE_ENV: 'production' | 'development' | 'test';
  APP_ENV: 'local' | 'ci' | 'staging' | 'production';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DATABASE_URL: string;
  PUBLIC_URL: string;
  BACKUPS_BUCKET: string;
  BACKUPS_ENDPOINT: string;
  BACKUPS_REGION: string;
  BACKUPS_ACCESS_KEY_ID: string;
  BACKUPS_SECRET_ACCESS_KEY: string;
  MEDIA_BUCKET: string;
  MEDIA_ENDPOINT: string;
  MEDIA_REGION: string;
  MEDIA_ACCESS_KEY_ID: string;
  MEDIA_SECRET_ACCESS_KEY: string;
  /** The `data` bucket the pipeline publishes bundles to; the worker reads it and writes its index file. */
  DATA_BUCKET: string;
  DATA_ENDPOINT: string;
  DATA_REGION: string;
  DATA_ACCESS_KEY_ID: string;
  DATA_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
  /** 64 lower-case hex characters, the same value as the API's (D-244). */
  APP_SECRET: string;
  /** The secret in force before the last rotation, or null (no rotation). */
  APP_SECRET_PREVIOUS: string | null;
  /** J-cost.check's monthly email line. */
  EMAIL_MONTHLY_QUOTA: number;
  /** J-cost.check's daily email line; 0 turns the line off. */
  EMAIL_DAILY_QUOTA: number;
  RAILWAY_GIT_COMMIT_SHA: string | null;
  RESEND_API_KEY: string | null;
  EMAIL_FROM: string | null;
  ADMIN_EMAILS: readonly string[] | null;
  APPLE_TEAM_ID: string | null;
  APPLE_KEY_ID: string | null;
  /** The PKCS#8 PEM with its line feeds restored, or null. */
  APPLE_PRIVATE_KEY: string | null;
  /** What loadEnv found for the owner inputs, for the start-up report. */
  ownerInputReport: Readonly<{
    missing: readonly WorkerOwnerInputVariable[];
    invalid: readonly WorkerOwnerInputVariable[];
  }>;
  /** Named values derived from APP_ENV here and nowhere else. */
  captureMail: boolean;
  envLabel: 'local' | 'ci' | 'staging' | 'production';
}>;

/** The owner-input variables of the worker, in report order. */
export const WORKER_OWNER_INPUTS: readonly WorkerOwnerInputVariable[] = Object.freeze([
  Object.freeze({ variable: 'RESEND_API_KEY', ownerInput: 'OI-resend' } as const),
  Object.freeze({ variable: 'EMAIL_FROM', ownerInput: 'OI-resend' } as const),
  Object.freeze({ variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' } as const),
  Object.freeze({ variable: 'APPLE_TEAM_ID', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'APPLE_KEY_ID', ownerInput: 'OI-apple-identifiers' } as const),
  Object.freeze({ variable: 'APPLE_PRIVATE_KEY', ownerInput: 'OI-apple-identifiers' } as const),
]);

// The owner inputs a deployed worker cannot start without (D-557); the Apple ones are optional.
const REQUIRED_WHEN_DEPLOYED: ReadonlySet<string> = new Set([
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'ADMIN_EMAILS',
]);

type OwnerVariable = WorkerOwnerInputVariable['variable'];
type Source = Readonly<Record<string, string | undefined>>;

// Bounds on raw values: every string has a maximum length.
const MAX_URL_LENGTH = 2048;
const MAX_BUCKET_VALUE_LENGTH = 200;
const MAX_ADMIN_EMAIL_LENGTH = 254;
const MAX_ADMIN_EMAILS = 50;
// The longest list of MAX_ADMIN_EMAILS well-formed items with their commas.
const MAX_ADMIN_EMAILS_RAW_LENGTH = MAX_ADMIN_EMAILS * (MAX_ADMIN_EMAIL_LENGTH + 1);

const RESEND_API_KEY_PATTERN = /^re_[A-Za-z0-9_-]{10,200}$/;
const EMAIL_FROM_MAX_LENGTH = 320;
const EMAIL_FROM_PATTERN = /^([^<>\r\n]{1,100} <[^\s@<>]+@[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+)$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const APP_SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;
const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/;
const APPLE_PRIVATE_KEY_MAX_LENGTH = 8192;
const PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
const PEM_FOOTER = '-----END PRIVATE KEY-----';
const EMAIL_QUOTA_MAX = 10_000_000;
const DEFAULT_EMAIL_MONTHLY_QUOTA = 3000;
const DEFAULT_EMAIL_DAILY_QUOTA = 100;

// Refused at any value, the empty one included: with it set, the email provider's library prints
// the provider's raw error text outside the logger (D-807).
const RESEND_DEBUG = 'RESEND_DEBUG';

const AppEnvSchema = z.object({ APP_ENV: z.enum(['local', 'ci', 'staging', 'production']) });

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

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

const bucketValue = z.string().min(1).max(MAX_BUCKET_VALUE_LENGTH);

// 64 hex characters, stored lower-case.
const appSecret = z
  .string()
  .regex(APP_SECRET_PATTERN)
  .transform((value) => value.toLowerCase());

// A whole number from 0 to 10,000,000, written in decimal digits.
function emailQuota(fallback: number) {
  return z
    .string()
    .regex(/^[0-9]{1,8}$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(EMAIL_QUOTA_MAX))
    .default(fallback);
}

const WorkerEnvSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
  PUBLIC_URL: originUrl,
  BACKUPS_BUCKET: bucketValue,
  BACKUPS_ENDPOINT: urlWithProtocol(['http:', 'https:']),
  BACKUPS_REGION: bucketValue,
  BACKUPS_ACCESS_KEY_ID: bucketValue,
  BACKUPS_SECRET_ACCESS_KEY: bucketValue,
  // The same parsers as the API's media set.
  MEDIA_BUCKET: bucketValue,
  MEDIA_ENDPOINT: urlWithProtocol(['http:', 'https:']),
  MEDIA_REGION: bucketValue,
  MEDIA_ACCESS_KEY_ID: bucketValue,
  MEDIA_SECRET_ACCESS_KEY: bucketValue,
  // Infrastructure values, required everywhere: never an owner input (D-589).
  DATA_BUCKET: bucketValue,
  DATA_ENDPOINT: urlWithProtocol(['http:', 'https:']),
  DATA_REGION: bucketValue,
  DATA_ACCESS_KEY_ID: bucketValue,
  DATA_SECRET_ACCESS_KEY: bucketValue,
  S3_FORCE_PATH_STYLE: booleanFlag,
  APP_SECRET: appSecret,
  APP_SECRET_PREVIOUS: appSecret.optional().transform((value) => value ?? null),
  EMAIL_MONTHLY_QUOTA: emailQuota(DEFAULT_EMAIL_MONTHLY_QUOTA),
  EMAIL_DAILY_QUOTA: emailQuota(DEFAULT_EMAIL_DAILY_QUOTA),
  // Set by Railway on every deployment; null when unset.
  RAILWAY_GIT_COMMIT_SHA: z
    .string()
    .regex(COMMIT_SHA_PATTERN)
    .optional()
    .transform((value) => value ?? null),
});

const AdminEmailSchema = z.email().max(MAX_ADMIN_EMAIL_LENGTH);

type Parsed<T> = { kind: 'unset' } | { kind: 'invalid' } | { kind: 'ok'; value: T };

const UNSET = Object.freeze({ kind: 'unset' } as const);
const INVALID = Object.freeze({ kind: 'invalid' } as const);

// Trimmed and lower-cased items, empty items dropped; an empty result is unset.
function parseAdminEmails(raw: string): Parsed<readonly string[]> {
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

function matching(test: (raw: string) => boolean): (raw: string) => Parsed<string> {
  return (raw) => (test(raw) ? { kind: 'ok', value: raw } : INVALID);
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

function isResendApiKey(value: string): boolean {
  return RESEND_API_KEY_PATTERN.test(value);
}

function isEmailFrom(value: string): boolean {
  return value.length <= EMAIL_FROM_MAX_LENGTH && EMAIL_FROM_PATTERN.test(value);
}

function isAppleId(value: string): boolean {
  return APPLE_ID_PATTERN.test(value);
}

function inReportOrder(variables: ReadonlySet<OwnerVariable>): readonly WorkerOwnerInputVariable[] {
  return Object.freeze(WORKER_OWNER_INPUTS.filter((row) => variables.has(row.variable)));
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
  APPLE_TEAM_ID: string | null;
  APPLE_KEY_ID: string | null;
  APPLE_PRIVATE_KEY: string | null;
  missing: readonly WorkerOwnerInputVariable[];
  invalid: readonly WorkerOwnerInputVariable[];
};

function valueOf<T>(parsed: Parsed<T>): T | null {
  return parsed.kind === 'ok' ? parsed.value : null;
}

// The owner inputs (D-416): null when unset; RESEND_API_KEY, EMAIL_FROM and ADMIN_EMAILS required
// in staging and production (D-557), the Apple ones optional everywhere; the key and the sender
// together; and a malformed value treated as unset in local and ci (reported as invalid) and
// refused in staging and production. The worker reads no other Apple variable (D-423).
function parseOwnerInputs(
  appEnv: WorkerEnv['APP_ENV'],
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
    RESEND_API_KEY: read('RESEND_API_KEY', matching(isResendApiKey)),
    EMAIL_FROM: read('EMAIL_FROM', matching(isEmailFrom)),
    ADMIN_EMAILS: read('ADMIN_EMAILS', parseAdminEmails),
    APPLE_TEAM_ID: read('APPLE_TEAM_ID', matching(isAppleId)),
    APPLE_KEY_ID: read('APPLE_KEY_ID', matching(isAppleId)),
    APPLE_PRIVATE_KEY: read('APPLE_PRIVATE_KEY', parseApplePrivateKey),
  } satisfies Record<OwnerVariable, Parsed<unknown>>;

  const unset = new Set<OwnerVariable>();
  const invalid = new Set<OwnerVariable>();
  for (const row of WORKER_OWNER_INPUTS) {
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
  // Each variable reported missing is one a deployed service may run without.
  const reportedMissing = isDeployed
    ? new Set([...unset].filter((variable) => !REQUIRED_WHEN_DEPLOYED.has(variable)))
    : unset;
  return {
    RESEND_API_KEY: pairUsable ? valueOf(parsed.RESEND_API_KEY) : null,
    EMAIL_FROM: pairUsable ? valueOf(parsed.EMAIL_FROM) : null,
    ADMIN_EMAILS: valueOf(parsed.ADMIN_EMAILS),
    APPLE_TEAM_ID: valueOf(parsed.APPLE_TEAM_ID),
    APPLE_KEY_ID: valueOf(parsed.APPLE_KEY_ID),
    APPLE_PRIVATE_KEY: valueOf(parsed.APPLE_PRIVATE_KEY),
    missing: inReportOrder(reportedMissing),
    invalid: isDeployed ? Object.freeze([]) : inReportOrder(invalid),
  };
}

// A deployed service serves its origin over https only (CTL-01, D-807); local and ci may use http.
function isHttpsOnDeployed(appEnv: WorkerEnv['APP_ENV'], publicUrl: string): boolean {
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
 * Parses the worker's environment. Throws EnvError naming each bad variable, never a value.
 * `source` defaults to the process environment, read only here. Unknown variables are ignored.
 */
export function loadEnv(source: Source = process.env): WorkerEnv {
  // An empty value counts as unset.
  const values: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') {
      values[name] = value;
    }
  }

  const problems = new Set<string>();
  if (source[RESEND_DEBUG] !== undefined) {
    problems.add(RESEND_DEBUG);
  }
  const appEnvResult = collect(problems, () => parseEnv(AppEnvSchema, values));
  if (appEnvResult === null || problems.size > 0) {
    throw new EnvError([...problems].sort());
  }
  const appEnv = appEnvResult.APP_ENV;

  const infra = collect(problems, () => parseEnv(WorkerEnvSchema, values));
  const owner = parseOwnerInputs(appEnv, values, problems);
  if (infra !== null && !isHttpsOnDeployed(appEnv, infra.PUBLIC_URL)) {
    problems.add('PUBLIC_URL');
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
    APPLE_TEAM_ID: owner.APPLE_TEAM_ID,
    APPLE_KEY_ID: owner.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: owner.APPLE_PRIVATE_KEY,
    ownerInputReport: Object.freeze({ missing: owner.missing, invalid: owner.invalid }),
    captureMail: (appEnv === 'local' || appEnv === 'ci') && owner.RESEND_API_KEY === null,
    envLabel: appEnv,
  });
}

/** The owner-input variables that are unset, in WORKER_OWNER_INPUTS order. */
export function missingOwnerInputs(env: WorkerEnv): readonly WorkerOwnerInputVariable[] {
  return env.ownerInputReport.missing;
}

/**
 * Writes one `warn` line per unset owner input (`env.input_missing`) and one per malformed one
 * (`env.input_invalid`), each with the variable's name and its owner input, never a value.
 */
export function logMissingOwnerInputs(env: WorkerEnv, logger: Logger): void {
  for (const row of missingOwnerInputs(env)) {
    logger.warn('env.input_missing', { variable: row.variable, ownerInput: row.ownerInput });
  }
  for (const row of env.ownerInputReport.invalid) {
    logger.warn('env.input_invalid', { variable: row.variable, ownerInput: row.ownerInput });
  }
}
