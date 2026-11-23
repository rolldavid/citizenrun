import { EnvError, parseEnv } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';

/** One owner-input variable the worker reads and the owner input that provides it (D-416). */
export type WorkerOwnerInputVariable = {
  variable: 'RESEND_API_KEY' | 'EMAIL_FROM' | 'ADMIN_EMAILS';
  ownerInput: 'OI-resend' | 'OI-admin-emails';
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
  S3_FORCE_PATH_STYLE: boolean;
  RAILWAY_GIT_COMMIT_SHA: string | null;
  RESEND_API_KEY: string | null;
  EMAIL_FROM: string | null;
  ADMIN_EMAILS: readonly string[] | null;
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
  S3_FORCE_PATH_STYLE: booleanFlag,
  // Set by Railway on every deployment; null when unset.
  RAILWAY_GIT_COMMIT_SHA: z
    .string()
    .regex(COMMIT_SHA_PATTERN)
    .optional()
    .transform((value) => value ?? null),
});

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
  missing: readonly WorkerOwnerInputVariable[];
  invalid: readonly WorkerOwnerInputVariable[];
};

// The owner inputs (D-416): null when unset in local and ci, required in staging and
// production (D-557), the key and the sender together, and a malformed value treated as unset in
// local and ci (reported as invalid) and refused in staging and production.
function parseOwnerInputs(
  appEnv: WorkerEnv['APP_ENV'],
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
  const appEnvResult = collect(problems, () => parseEnv(AppEnvSchema, values));
  if (appEnvResult === null) {
    throw new EnvError([...problems].sort());
  }
  const appEnv = appEnvResult.APP_ENV;

  const infra = collect(problems, () => parseEnv(WorkerEnvSchema, values));
  const owner = parseOwnerInputs(appEnv, values, problems);
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
