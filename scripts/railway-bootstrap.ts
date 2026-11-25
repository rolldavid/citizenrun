// OPS-bootstrap: what the infrastructure file cannot do (D-020, D-131). Run by hand, never in CI:
//   pnpm exec tsx scripts/railway-bootstrap.ts --env staging|production [--only <step>]
//     [--db-service <service>] [--rotate <KEY>] [--dry-run]
// Every secret travels on standard input, never in an argument, and is never printed.
import { spawn } from 'node:child_process';
import {
  createHash,
  createHmac,
  createPublicKey,
  pbkdf2Sync,
  randomBytes as cryptoRandomBytes,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { BRAND } from '@citizenrun/shared';
import type { BrandVariant } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { z } from 'zod';
import { mediaCorsRules } from './lib/cors.ts';
import { repoRoot } from './lib/repo-root.ts';

export const STEP_NAMES = [
  'preflight',
  'environment',
  'apply',
  'generate-secrets',
  'seal',
  'owner-values',
  'database',
  'bucket-cors',
  'usage-limits',
  'service-config-fallbacks',
  'volume-backups',
  'tokens',
  'redeploy',
  'report',
] as const;

export type StepName = (typeof STEP_NAMES)[number];

type EnvName = 'staging' | 'production';
type RotateKey = 'APP_SECRET' | 'RESEND_API_KEY' | 'BACKUP_PUBLIC_KEY';

export type BootstrapArgs = {
  env: EnvName;
  only: StepName | null;
  dbService: string;
  rotate: RotateKey | null;
  dryRun: boolean;
};

const USAGE =
  'pnpm exec tsx scripts/railway-bootstrap.ts --env staging|production [--only <step>] [--db-service <service>] [--rotate <KEY>] [--dry-run]';

/** A command-line mistake; the script prints one usage line and exits 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** The owner inputs file is not valid; the message names keys, never values. */
export class InputsFileError extends Error {
  override name = 'InputsFileError';
}

/** A failure whose message is safe to print: it names keys, services and markers only. */
class StepError extends Error {
  override name = 'StepError';
}

const ROTATE_KEYS: readonly RotateKey[] = ['APP_SECRET', 'RESEND_API_KEY', 'BACKUP_PUBLIC_KEY'];

function isStepName(value: string): value is StepName {
  return (STEP_NAMES as readonly string[]).includes(value);
}

function isRotateKey(value: string): value is RotateKey {
  return (ROTATE_KEYS as readonly string[]).includes(value);
}

/** Parses the command line; throws UsageError for an unknown flag, step or key, or a missing `--env`. */
export function parseBootstrapArgs(argv: readonly string[]): BootstrapArgs {
  let env: EnvName | null = null;
  let only: StepName | null = null;
  let dbService: string | null = null;
  let rotate: RotateKey | null = null;
  let dryRun = false;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? '';
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    if (seen.has(flag)) {
      throw new UsageError(`${flag} is given twice`);
    }
    seen.add(flag);
    if (flag === '--dry-run') {
      if (eq !== -1) {
        throw new UsageError('--dry-run takes no value');
      }
      dryRun = true;
      continue;
    }
    if (!['--env', '--only', '--db-service', '--rotate'].includes(flag)) {
      throw new UsageError(`unknown argument ${flag.startsWith('--') ? flag : 'given'}`);
    }
    let value: string | undefined;
    if (eq === -1) {
      index += 1;
      value = argv[index];
    } else {
      value = raw.slice(eq + 1);
    }
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new UsageError(`${flag} needs a value`);
    }
    switch (flag) {
      case '--env':
        if (value !== 'staging' && value !== 'production') {
          throw new UsageError('--env must be staging or production');
        }
        env = value;
        break;
      case '--only':
        if (!isStepName(value)) {
          throw new UsageError('--only names no step of this script');
        }
        only = value;
        break;
      case '--db-service':
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
          throw new UsageError('--db-service must be a service name');
        }
        dbService = value;
        break;
      default:
        if (!isRotateKey(value)) {
          throw new UsageError('--rotate takes APP_SECRET, RESEND_API_KEY or BACKUP_PUBLIC_KEY');
        }
        rotate = value;
    }
  }
  if (env === null) {
    throw new UsageError('--env is required');
  }
  return { env, only, dbService: dbService ?? 'postgres', rotate, dryRun };
}

// ---------------------------------------------------------------------------------------------
// The owner inputs file (PC9-18).

/** Every key of the inputs file, its owner input and whether this version writes it anywhere. */
export const INPUT_KEYS = {
  RAILWAY_PROJECT_ID: { ownerInput: 'OI-railway', setByThisVersion: true },
  RAILWAY_WORKSPACE: { ownerInput: 'OI-railway', setByThisVersion: true },
  MAIL_HOST: { ownerInput: 'OI-domain', setByThisVersion: true },
  ADMIN_EMAILS: { ownerInput: 'OI-admin-emails', setByThisVersion: true },
  RESEND_API_KEY: { ownerInput: 'OI-resend', setByThisVersion: true },
  BACKUP_PUBLIC_KEY_FILE: { ownerInput: 'OI-backup-key', setByThisVersion: true },
  CLAIMS_EMAIL: { ownerInput: 'OI-admin-emails', setByThisVersion: false },
  APPLE_TEAM_ID: { ownerInput: 'OI-apple-developer', setByThisVersion: false },
  APPLE_KEY_ID: { ownerInput: 'OI-apple-identifiers', setByThisVersion: false },
  APPLE_PRIVATE_KEY_FILE: { ownerInput: 'OI-apple-identifiers', setByThisVersion: false },
  GOOGLE_CLIENT_IDS: { ownerInput: 'OI-google-oauth', setByThisVersion: false },
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: { ownerInput: 'OI-google-oauth', setByThisVersion: false },
  REVIEW_SIGNIN_EMAILS: { ownerInput: 'OI-store-submission', setByThisVersion: false },
  REVIEW_SIGNIN_CODE: { ownerInput: 'OI-store-submission', setByThisVersion: false },
  APP_SECRET_PREVIOUS: { ownerInput: 'rotation', setByThisVersion: false },
  GEO_API_KEY: { ownerInput: 'OI-geoapify', setByThisVersion: false },
  FEC_API_KEY: { ownerInput: 'OI-datagov-key', setByThisVersion: false },
  ANTHROPIC_PIPELINE_API_KEY: { ownerInput: 'OI-anthropic-workspaces', setByThisVersion: false },
  ANTHROPIC_SCREENING_API_KEY: { ownerInput: 'OI-anthropic-workspaces', setByThisVersion: false },
  RESEND_WEBHOOK_SECRET: { ownerInput: 'OI-resend-webhook', setByThisVersion: false },
  EXPO_ACCESS_TOKEN: { ownerInput: 'OI-expo-push', setByThisVersion: false },
  ANDROID_CERT_FINGERPRINTS: { ownerInput: 'OI-play-fingerprint', setByThisVersion: false },
  APP_STORE_URL: { ownerInput: 'OI-store-records', setByThisVersion: false },
  PLAY_STORE_URL: { ownerInput: 'OI-store-records', setByThisVersion: false },
} as const satisfies Record<string, { ownerInput: string; setByThisVersion: boolean }>;

type InputKey = keyof typeof INPUT_KEYS;

function isInputKey(value: string): value is InputKey {
  return Object.hasOwn(INPUT_KEYS, value);
}

const PRINTABLE_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

function isAddress(value: string): boolean {
  const at = value.indexOf('@');
  return (
    value.length <= 254 &&
    at > 0 &&
    at === value.lastIndexOf('@') &&
    at < value.length - 1 &&
    !/\s/.test(value)
  );
}

const oneLine = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/[\r\n]/.test(value));

const REVIEW_PAIR_MESSAGE = 'REVIEW_SIGNIN_EMAILS and REVIEW_SIGNIN_CODE must be given together';

export const InputsFileSchema = z
  .strictObject({
    RAILWAY_PROJECT_ID: z.string().regex(UUID).optional(),
    // The workspace's id or name, passed to `railway init --workspace` (D-831).
    RAILWAY_WORKSPACE: oneLine.optional(),
    MAIL_HOST: z.string().regex(HOST).optional(),
    ADMIN_EMAILS: z
      .string()
      .max(5200)
      .refine((value) => {
        const list = value.split(',').map((item) => item.trim());
        return list.length >= 1 && list.length <= 20 && list.every(isAddress);
      })
      .optional(),
    RESEND_API_KEY: z.string().min(1).max(512).regex(/^\S+$/).optional(),
    BACKUP_PUBLIC_KEY_FILE: oneLine.optional(),
    CLAIMS_EMAIL: z.string().refine(isAddress).optional(),
    APPLE_TEAM_ID: oneLine.optional(),
    APPLE_KEY_ID: oneLine.optional(),
    APPLE_PRIVATE_KEY_FILE: oneLine.optional(),
    GOOGLE_CLIENT_IDS: oneLine.optional(),
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: oneLine.optional(),
    REVIEW_SIGNIN_EMAILS: oneLine.optional(),
    REVIEW_SIGNIN_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    APP_SECRET_PREVIOUS: z
      .string()
      .regex(/^[0-9a-f]{64}$/i)
      .optional(),
    GEO_API_KEY: oneLine.optional(),
    FEC_API_KEY: oneLine.optional(),
    ANTHROPIC_PIPELINE_API_KEY: oneLine.optional(),
    ANTHROPIC_SCREENING_API_KEY: oneLine.optional(),
    RESEND_WEBHOOK_SECRET: oneLine.optional(),
    EXPO_ACCESS_TOKEN: oneLine.optional(),
    ANDROID_CERT_FINGERPRINTS: oneLine.optional(),
    APP_STORE_URL: oneLine.optional(),
    PLAY_STORE_URL: oneLine.optional(),
  })
  .superRefine((inputs, ctx) => {
    if ((inputs.REVIEW_SIGNIN_EMAILS === undefined) !== (inputs.REVIEW_SIGNIN_CODE === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['REVIEW_SIGNIN_EMAILS'],
        message: REVIEW_PAIR_MESSAGE,
      });
    }
  });

export type Inputs = z.infer<typeof InputsFileSchema>;

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Parses `.env.railway.<env>`; throws InputsFileError naming keys (or a line number), never values. */
export function parseInputsFile(text: string): Inputs {
  const values: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match === null) {
      throw new InputsFileError(`inputs file line ${String(index + 1)} is not KEY=value`);
    }
    const key = match[1] ?? '';
    if (!isInputKey(key)) {
      // Only a name shaped like a key is printed: a wrapped or swapped line could hold a value.
      throw new InputsFileError(
        PRINTABLE_KEY.test(key)
          ? `inputs file: unknown key ${key}`
          : `inputs file line ${String(index + 1)} has an unknown key`,
      );
    }
    if (Object.hasOwn(values, key)) {
      throw new InputsFileError(`inputs file: ${key} is given twice`);
    }
    values[key] = unquote((match[2] ?? '').trim());
  }
  const parsed = InputsFileSchema.safeParse(values);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      if (issue.message === REVIEW_PAIR_MESSAGE) {
        return REVIEW_PAIR_MESSAGE;
      }
      return `${String(issue.path[0] ?? 'a key')} is not valid`;
    });
    throw new InputsFileError(`inputs file: ${[...new Set(problems)].join('; ')}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers.

/** The SCRAM-SHA-256 StoredKey and ServerKey of a password (RFC 7677; PC9-02). */
export function scramKeys(
  password: string,
  salt: Buffer,
  iterations: number,
): { storedKey: Buffer; serverKey: Buffer } {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  return {
    storedKey: createHash('sha256').update(clientKey).digest(),
    serverKey: createHmac('sha256', salted).update('Server Key').digest(),
  };
}

/** A PostgreSQL SCRAM-SHA-256 verifier; 16 random salt bytes and 4096 iterations by default. */
export function scramVerifier(password: string, salt?: Buffer, iterations?: number): string {
  const saltBytes = salt ?? cryptoRandomBytes(16);
  const rounds = iterations ?? 4096;
  const { storedKey, serverKey } = scramKeys(password, saltBytes, rounds);
  return `SCRAM-SHA-256$${String(rounds)}:${saltBytes.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

type DbRole = 'api' | 'worker' | 'backup' | 'admin';

const ROLE_MARKERS: Record<DbRole, string> = {
  api: '{{API_VERIFIER}}',
  worker: '{{WORKER_VERIFIER}}',
  backup: '{{BACKUP_VERIFIER}}',
  admin: '{{ADMIN_VERIFIER}}',
};

const ROLE_NAMES: Record<DbRole, string> = {
  api: 'app_api',
  worker: 'app_worker',
  backup: 'app_backup',
  admin: 'app_admin',
};

const ROLE_PASSWORD_KEYS: Record<DbRole, string> = {
  api: 'API_DB_PASSWORD',
  worker: 'WORKER_DB_PASSWORD',
  backup: 'BACKUP_DB_PASSWORD',
  admin: 'ADMIN_DB_PASSWORD',
};

const DB_ROLES: readonly DbRole[] = ['api', 'worker', 'backup', 'admin'];

function fillSomeMarkers(sql: string, verifiers: Partial<Record<DbRole, string>>): string {
  let out = sql;
  for (const role of DB_ROLES) {
    const value = verifiers[role];
    if (value === undefined) {
      continue;
    }
    const marker = ROLE_MARKERS[role];
    if (!out.includes(marker)) {
      throw new StepError(`roles.sql has no ${marker}`);
    }
    if (/['\\\r\n]/.test(value) || value.includes('{{')) {
      throw new StepError(`the value for ${marker} contains a character it must not contain`);
    }
    out = out.split(marker).join(value);
  }
  if (out.includes('{{')) {
    throw new StepError('roles.sql still holds a {{ marker after replacement');
  }
  return out;
}

/** Replaces the four verifier markers of roles.sql; throws naming the marker, never the value. */
export function fillRoleMarkers(
  sql: string,
  verifiers: { api: string; worker: string; backup: string; admin: string },
): string {
  return fillSomeMarkers(sql, verifiers);
}

/** Removes ` password '{{<ROLE>_VERIFIER}}'` from each named role's `alter role` line. */
export function stripRolePasswords(sql: string, roles: readonly DbRole[]): string {
  let out = sql;
  for (const role of roles) {
    out = out.split(` password '${ROLE_MARKERS[role]}'`).join('');
  }
  return out;
}

/** The sender of every email: `<display name> <login@<mail host>>` (PC9-11). */
export function composeEmailFrom(displayName: string, mailHost: string): string {
  return `${displayName} <login@${mailHost}>`;
}

/** The origins the media bucket's CORS rule allows (D-143, D-798). */
export function mediaCorsOrigins(env: EnvName, host: string, adminHost: string | null): string[] {
  const origins = [`https://${host}`];
  if (adminHost !== null) {
    origins.push(`https://${adminHost}`);
  }
  if (env === 'staging') {
    origins.push('http://localhost:8081');
  }
  return origins;
}

/** The variables a person seals in the dashboard once they are set (OPS-vars). */
export const SEALED = [
  { service: 'postgres', key: 'POSTGRES_PASSWORD' },
  { service: 'postgres', key: 'API_DB_PASSWORD' },
  { service: 'postgres', key: 'WORKER_DB_PASSWORD' },
  { service: 'postgres', key: 'BACKUP_DB_PASSWORD' },
  { service: 'postgres', key: 'ADMIN_DB_PASSWORD' },
  { service: 'api', key: 'APP_SECRET' },
  { service: 'api', key: 'RESEND_API_KEY' },
  { service: 'worker', key: 'APP_SECRET' },
  { service: 'worker', key: 'RESEND_API_KEY' },
  { service: 'admin', key: 'APP_SECRET' },
  { service: 'admin', key: 'RESEND_API_KEY' },
] as const;

export const ENV_NAMES = {
  staging: { tokenSecret: 'RAILWAY_TOKEN_STAGING', readyVariable: 'RAILWAY_STAGING_READY' },
  production: {
    tokenSecret: 'RAILWAY_TOKEN_PRODUCTION',
    readyVariable: 'RAILWAY_PRODUCTION_READY',
  },
} as const;

/** Fields OPS-check-iac-fields moved out of railway.ts; step 10 sets each with the CLI. */
export const IAC_FIELD_FALLBACKS: readonly { service: string; path: string; value: string }[] = [];

// ---------------------------------------------------------------------------------------------
// Running.

export type BucketCredentials = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type BootstrapIo = {
  readonly repoRoot: string;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out: (line: string) => void;
  readonly prompt?: (question: string, options: { hidden: boolean }) => Promise<string | null>;
  readonly randomBytes?: (size: number) => Buffer;
  readonly createS3?: (credentials: BucketCredentials) => S3Client;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
};

type Tool = 'railway' | 'gh';
type CliResult = { code: number; stdout: string; stderr: string };
type Outcome = 'ok' | 'skip' | 'owner-check' | 'fail';

type Ctx = {
  readonly args: BootstrapArgs;
  readonly io: BootstrapIo;
  readonly variant: BrandVariant;
  readonly prompt: (question: string, options: { hidden: boolean }) => Promise<string | null>;
  readonly randomBytes: (size: number) => Buffer;
  readonly createS3: (credentials: BucketCredentials) => S3Client;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  inputs: Inputs;
  publicKeyPem: string | null;
  /** Values generated in this run, by variable name (one APP_SECRET for the three services). */
  readonly generated: Map<string, string>;
  /** Values set on Railway in this run, by `<service>/<KEY>`. */
  readonly setInRun: Map<string, string>;
  readonly ownerChecks: string[];
  corsVerified: boolean;
  limitsVerified: boolean;
  readyVariableSet: boolean;
  /** Set by the first run's `environment` step: the project was created and the run ends. */
  stopRun: boolean;
  /** What to do before running again, set by a step that fails and knows the likely cause. */
  failHint: string | null;
  /** The command to run next after a run that did not fail, when one is needed (D-840). */
  nextNote: string | null;
};

class StepPrinter {
  failed = false;
  private readonly ctx: Ctx;
  private readonly step: StepName;

  constructor(ctx: Ctx, step: StepName) {
    this.ctx = ctx;
    this.step = step;
  }

  line(outcome: Outcome, detail: string): void {
    if (outcome === 'fail') {
      this.failed = true;
    }
    if (outcome === 'owner-check') {
      this.ctx.ownerChecks.push(detail);
    }
    this.ctx.io.out(`${this.step} ${outcome} ${detail}`);
  }
}

/** The command that runs the bootstrap again for this environment, with `--only <step>` when given. */
function bootstrapCommand(ctx: Ctx, only: StepName | null): string {
  const parts = ['pnpm exec tsx scripts/railway-bootstrap.ts', '--env', ctx.args.env];
  if (only !== null) {
    parts.push('--only', only);
  }
  if (ctx.args.dbService !== 'postgres') {
    parts.push('--db-service', ctx.args.dbService);
  }
  if (ctx.args.dryRun) {
    parts.push('--dry-run');
  }
  return parts.join(' ');
}

// The CLI refuses `redeploy` while the newest deployment is still building or deploying.
function waitHint(ctx: Ctx, service: string): string {
  return `wait until pnpm exec railway deployment list --service ${service} --environment ${ctx.args.env} shows no ${service} deployment building or deploying (the CLI refuses a redeploy until then)`;
}

function plainEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

function spawnTool(
  ctx: Ctx,
  tool: Tool,
  args: readonly string[],
  stdin?: string,
): Promise<CliResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(tool, args, {
      shell: false,
      cwd: ctx.io.repoRoot,
      env: plainEnv(ctx.io.env),
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', () => {
      resolvePromise({ code: 127, stdout: '', stderr: '' });
    });
    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    if (stdin !== undefined && child.stdin !== null) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin);
    }
  });
}

/** The one way this script runs a CLI: no shell, `io.env`, and in a dry run no mutating call. */
async function cli(
  ctx: Ctx,
  tool: Tool,
  args: readonly string[],
  options: { stdin?: string; mutating: boolean },
): Promise<CliResult> {
  const mutating = options.mutating || (tool === 'railway' && args[0] === 'ssh');
  if (ctx.args.dryRun && mutating) {
    const suffix = options.stdin === undefined ? '' : ' (stdin <redacted>)';
    ctx.io.out(`dry-run ${tool} ${args.join(' ')}${suffix}`);
    return { code: 0, stdout: '', stderr: '' };
  }
  return spawnTool(ctx, tool, args, options.stdin);
}

function parseJson<T>(schema: z.ZodType<T>, text: string): T | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Lenient shapes of the CLI's JSON: extra fields are ignored, a changed shape is "unexpected output".
const NamedArray = z.array(z.looseObject({ name: z.string() }));
const VariableEntries = z.array(
  z.looseObject({ name: z.string().optional(), key: z.string().optional(), value: z.unknown() }),
);
const VariableMap = z.record(z.string(), z.unknown());
const DeploymentList = z.array(
  z.looseObject({
    status: z.string(),
    id: z.string().optional(),
    createdAt: z.string().optional(),
  }),
);
const ProjectCreated = z.looseObject({
  id: z.string().optional(),
  projectId: z.string().optional(),
  project: z.looseObject({ id: z.string() }).optional(),
});
const LooseRecord = z.record(z.string(), z.unknown());

/** Names listed on a service, each with its readable value or null when withheld (sealed). */
type VariableList = Map<string, string | null>;

function readable(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function toVariableList(text: string): VariableList | null {
  const entries = parseJson(VariableEntries, text);
  if (entries !== null) {
    const list: VariableList = new Map();
    for (const entry of entries) {
      const name = entry.name ?? entry.key;
      if (name === undefined) {
        return null;
      }
      list.set(name, readable(entry.value));
    }
    return list;
  }
  const map = parseJson(VariableMap, text);
  if (map === null) {
    return null;
  }
  return new Map(Object.entries(map).map(([name, value]) => [name, readable(value)]));
}

async function readVariables(
  ctx: Ctx,
  out: StepPrinter,
  service: string,
): Promise<VariableList | null> {
  const args = ['variable', 'list', '--service', service, '--environment', ctx.args.env, '--json'];
  const result = await cli(ctx, 'railway', args, { mutating: false });
  if (result.code !== 0) {
    out.line('fail', `variable list --service ${service}: exit ${String(result.code)}`);
    return null;
  }
  const list = toVariableList(result.stdout);
  if (list === null) {
    out.line('fail', `variable list --service ${service}: unexpected output`);
  }
  return list;
}

async function setVariable(
  ctx: Ctx,
  out: StepPrinter,
  service: string,
  key: string,
  value: string,
): Promise<boolean> {
  const args = [
    'variable',
    'set',
    key,
    '--stdin',
    '--service',
    service,
    '--environment',
    ctx.args.env,
    '--skip-deploys',
  ];
  const result = await cli(ctx, 'railway', args, { stdin: value, mutating: true });
  if (result.code !== 0) {
    out.line('fail', `variable set ${key} on ${service}: exit ${String(result.code)}`);
    return false;
  }
  ctx.setInRun.set(`${service}/${key}`, value);
  return true;
}

type Deployment = { status: string; id: string | null; createdAt: string | null };

async function readDeployments(
  ctx: Ctx,
  service: string,
  extra: readonly string[] = [],
): Promise<Deployment[] | null> {
  const args = [
    'deployment',
    'list',
    '--service',
    service,
    '--environment',
    ctx.args.env,
    '--json',
    ...extra,
  ];
  const result = await cli(ctx, 'railway', args, { mutating: false });
  if (result.code !== 0) {
    return null;
  }
  const list = parseJson(DeploymentList, result.stdout);
  if (list === null) {
    return null;
  }
  return list.map((item) => ({
    status: item.status.toUpperCase(),
    id: item.id ?? null,
    createdAt: item.createdAt ?? null,
  }));
}

/** The newest deployment: by `createdAt` when every entry has one, otherwise the first listed. */
function newest(list: readonly Deployment[]): Deployment | null {
  if (list.length === 0) {
    return null;
  }
  if (list.every((item) => item.createdAt !== null)) {
    return (
      [...list].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0] ?? null
    );
  }
  return list[0] ?? null;
}

// A deployment made after `than`: a later `createdAt`, else another id; with neither, assumed so.
function isNewer(deployment: Deployment, than: Deployment): boolean {
  if (deployment.createdAt !== null && than.createdAt !== null) {
    return deployment.createdAt > than.createdAt;
  }
  if (deployment.id !== null && than.id !== null) {
    return deployment.id !== than.id;
  }
  return true;
}

function secretsFilePath(ctx: Ctx): string {
  return join(ctx.io.home, '.config', BRAND.slug, `secrets-${ctx.args.env}.json`);
}

function readSecretsFile(ctx: Ctx): Record<string, string> {
  const path = secretsFilePath(ctx);
  if (!existsSync(path)) {
    return {};
  }
  const parsed = parseJson(z.record(z.string(), z.string()), readFileSync(path, 'utf8'));
  if (parsed === null) {
    throw new StepError('the generated-secrets file cannot be read');
  }
  return parsed;
}

function writeSecretsFile(ctx: Ctx, values: ReadonlyMap<string, string>): void {
  const path = secretsFilePath(ctx);
  const folder = dirname(path);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const merged = { ...readSecretsFile(ctx), ...Object.fromEntries(values) };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function resolveKeyPath(ctx: Ctx, path: string): string {
  if (path.startsWith('~/')) {
    return join(ctx.io.home, path.slice(2));
  }
  return resolve(ctx.io.repoRoot, path);
}

// ---------------------------------------------------------------------------------------------
// Steps.

async function preflight(ctx: Ctx): Promise<boolean> {
  const out = new StepPrinter(ctx, 'preflight');
  const env = ctx.io.env;
  if (env.RAILWAY_TOKEN !== undefined && env.RAILWAY_API_TOKEN !== undefined) {
    out.line('fail', 'RAILWAY_TOKEN and RAILWAY_API_TOKEN are both set; unset RAILWAY_TOKEN');
    return false;
  }
  if (env.RAILWAY_API_TOKEN === undefined && !ctx.args.dryRun) {
    out.line('fail', 'RAILWAY_API_TOKEN is not set (OI-railway)');
  }
  const version = await cli(ctx, 'railway', ['--version'], { mutating: false });
  if (version.code !== 0 || !version.stdout.includes('5.74.0')) {
    out.line('fail', 'the railway CLI is not 5.74.0');
  }
  const whoami = await cli(ctx, 'railway', ['whoami'], { mutating: false });
  if (whoami.code !== 0) {
    // A workspace or project token cannot run the CLI's `me` query (D-831).
    const hint =
      env.RAILWAY_API_TOKEN === undefined
        ? ''
        : '; RAILWAY_API_TOKEN may be a workspace or project token: use an account token created with "No workspace"';
    out.line('fail', `railway whoami: exit ${String(whoami.code)} (OI-railway)${hint}`);
  }
  const gh = await cli(ctx, 'gh', ['auth', 'status'], { mutating: false });
  if (gh.code !== 0) {
    out.line('fail', `gh auth status: exit ${String(gh.code)} (OI-github-actions)`);
  }
  if (brandRepository() === null) {
    out.line('fail', 'brand.json: github.repository is not set');
  }
  if (ctx.variant.host === null) {
    out.line('fail', `brand.json: variants.${ctx.args.env}.host is not set (OI-domain)`);
  }
  if (ctx.variant.adminHost === null) {
    out.line('fail', `brand.json: variants.${ctx.args.env}.adminHost is not set (OI-domain)`);
  }
  const inputsPath = join(ctx.io.repoRoot, `.env.railway.${ctx.args.env}`);
  if (existsSync(inputsPath)) {
    try {
      ctx.inputs = parseInputsFile(readFileSync(inputsPath, 'utf8'));
    } catch (error) {
      if (!(error instanceof InputsFileError)) {
        throw error;
      }
      out.line('fail', error.message);
    }
  } else {
    out.line('skip', `no inputs file .env.railway.${ctx.args.env}`);
  }
  const keyFile = ctx.inputs.BACKUP_PUBLIC_KEY_FILE;
  if (keyFile !== undefined) {
    const pem = readPublicKey(resolveKeyPath(ctx, keyFile));
    if (pem === null) {
      out.line('fail', 'BACKUP_PUBLIC_KEY_FILE (OI-backup-key) is not an RSA 4096 public key file');
    } else {
      ctx.publicKeyPem = pem;
    }
  }
  for (const key of Object.keys(ctx.inputs)) {
    if (isInputKey(key) && !INPUT_KEYS[key].setByThisVersion) {
      out.line(
        'skip',
        `${key} (${INPUT_KEYS[key].ownerInput}): not set by this version of the bootstrap`,
      );
    }
  }
  if (!out.failed) {
    out.line('ok', `ready for ${ctx.args.env}${ctx.args.dryRun ? ' (dry run)' : ''}`);
  }
  return !out.failed;
}

/** `github.repository` of brand.json, read as the nullable value the owner may not have given. */
function brandRepository(): string | null {
  return BRAND.github.repository;
}

/** The PEM text of an RSA 4096 public key file, or null; a private key file is refused. */
function readPublicKey(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  if (!text.includes('-----BEGIN PUBLIC KEY-----') || text.includes('PRIVATE KEY')) {
    return null;
  }
  try {
    const key = createPublicKey(text);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 4096) {
      return null;
    }
  } catch {
    return null;
  }
  return text;
}

const REQUIRED_TO_CREATE = [
  'MAIL_HOST',
  'ADMIN_EMAILS',
  'RESEND_API_KEY',
  'BACKUP_PUBLIC_KEY_FILE',
] as const;

/** Environment entries from a list, `{ environments: [...] }` or `{ environments: { edges: [{ node }] } }`. */
function environmentsOf(value: unknown): Record<string, unknown>[] | null {
  let list: unknown = value;
  const outer = LooseRecord.safeParse(value);
  if (!Array.isArray(value) && outer.success) {
    list = outer.data.environments ?? outer.data.edges;
    const inner = LooseRecord.safeParse(list);
    if (!Array.isArray(list) && inner.success) {
      list = inner.data.edges;
    }
  }
  if (!Array.isArray(list)) {
    return null;
  }
  const entries: Record<string, unknown>[] = [];
  for (const item of list) {
    const record = LooseRecord.safeParse(item);
    if (!record.success) {
      return null;
    }
    const node = LooseRecord.safeParse(record.data.node);
    entries.push(node.success ? node.data : record.data);
  }
  return entries;
}

function nameOf(environment: Record<string, unknown>): string | null {
  return typeof environment.name === 'string' ? environment.name : null;
}

/** How many services an environment entry holds, or null when the entry does not say. */
function serviceCount(environment: Record<string, unknown>): number | null {
  for (const field of ['serviceInstances', 'services']) {
    const value = environment[field];
    if (Array.isArray(value)) {
      return value.length;
    }
    const record = LooseRecord.safeParse(value);
    if (record.success && Array.isArray(record.data.edges)) {
      return record.data.edges.length;
    }
  }
  return null;
}

/** How many services `railway status` shows in one environment, or null when it does not say. */
async function statusServiceCount(
  ctx: Ctx,
  projectId: string,
  environment: string,
): Promise<number | null> {
  const status = await cli(
    ctx,
    'railway',
    ['status', '--project', projectId, '--environment', environment, '--json'],
    { mutating: false },
  );
  if (status.code !== 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    return null;
  }
  const environments = environmentsOf(parsed);
  const found = environments?.find((item) => nameOf(item) === environment);
  return found === undefined ? null : serviceCount(found);
}

async function productionServiceCount(
  ctx: Ctx,
  fromList: Record<string, unknown>,
  projectId: string,
): Promise<number | null> {
  return serviceCount(fromList) ?? statusServiceCount(ctx, projectId, 'production');
}

async function stepEnvironment(ctx: Ctx, out: StepPrinter): Promise<void> {
  const env = ctx.args.env;
  const projectId = ctx.inputs.RAILWAY_PROJECT_ID;
  if (projectId === undefined) {
    const workspace = ctx.inputs.RAILWAY_WORKSPACE;
    const init = await cli(
      ctx,
      'railway',
      [
        'init',
        '--name',
        BRAND.slug,
        ...(workspace === undefined ? [] : ['--workspace', workspace]),
        '--json',
      ],
      { mutating: true },
    );
    if (ctx.args.dryRun) {
      out.line(
        'ok',
        `dry-run: no project created; RAILWAY_PROJECT_ID is not in .env.railway.${env}`,
      );
      ctx.stopRun = true;
      return;
    }
    if (init.code !== 0) {
      const hint =
        workspace === undefined && /--workspace/.test(init.stderr)
          ? ': the account has more than one workspace; set RAILWAY_WORKSPACE in the inputs file'
          : '';
      out.line('fail', `railway init: exit ${String(init.code)}${hint}`);
      return;
    }
    const created = parseJson(ProjectCreated, init.stdout);
    const id = created?.id ?? created?.projectId ?? created?.project?.id;
    if (id === undefined || !UUID.test(id)) {
      out.line('fail', 'railway init: unexpected output');
      return;
    }
    out.line(
      'ok',
      `project created; add RAILWAY_PROJECT_ID=${id} to .env.railway.${env} and run again`,
    );
    ctx.stopRun = true;
    return;
  }
  // Linked by environment name: outside a terminal the CLI refuses a plain link once the project
  // holds two environments. The plain link answers while the project holds only one, which is the
  // case when the environment this run creates does not exist yet.
  const byName = await cli(ctx, 'railway', ['link', '--project', projectId, '--environment', env], {
    mutating: false,
  });
  if (byName.code !== 0) {
    const plain = await cli(ctx, 'railway', ['link', '--project', projectId], { mutating: false });
    if (plain.code !== 0) {
      out.line('fail', `railway link: exit ${String(plain.code)} (OI-railway)`);
      return;
    }
  }
  const listResult = await cli(ctx, 'railway', ['environment', 'list', '--json'], {
    mutating: false,
  });
  let listValue: unknown = null;
  try {
    listValue = JSON.parse(listResult.stdout);
  } catch {
    listValue = null;
  }
  const environments = listResult.code === 0 ? environmentsOf(listValue) : null;
  if (environments === null || environments.some((item) => nameOf(item) === null)) {
    out.line('fail', 'environment list: unexpected output');
    return;
  }
  if (environments.some((item) => nameOf(item) === env)) {
    out.line('ok', `${env} exists`);
    return;
  }
  const missing = REQUIRED_TO_CREATE.filter((key) => ctx.inputs[key] === undefined);
  if (missing.length > 0) {
    const named = missing.map((key) => `${key} (${INPUT_KEYS[key].ownerInput})`).join(', ');
    out.line('fail', `environment not created: missing ${named}`);
    return;
  }
  const created = await cli(ctx, 'railway', ['environment', 'new', env], { mutating: true });
  if (created.code !== 0) {
    out.line('fail', `environment new ${env}: exit ${String(created.code)}`);
    return;
  }
  out.line('ok', ctx.args.dryRun ? `dry-run: ${env} not created` : `created ${env}`);
  if (env !== 'staging') {
    return;
  }
  const production = environments.find((item) => nameOf(item) === 'production');
  if (production === undefined) {
    return;
  }
  const count = await productionServiceCount(ctx, production, projectId);
  if (count === null) {
    out.line('owner-check', 'delete the empty default environment production');
    return;
  }
  if (count > 0) {
    out.line('skip', 'production holds services and stays');
    return;
  }
  const deleted = await cli(ctx, 'railway', ['environment', 'delete', 'production', '--yes'], {
    mutating: true,
  });
  if (deleted.code !== 0) {
    out.line('fail', `environment delete production: exit ${String(deleted.code)}`);
    return;
  }
  out.line(
    'ok',
    ctx.args.dryRun
      ? 'dry-run: the empty default environment production not deleted'
      : 'deleted the empty default environment production',
  );
  return;
}

/**
 * Applies the file. The apply that creates a service leaves its `source.checkSuites` false, and a
 * second apply sets it (D-848), so a first apply that created a service, or one whose effect on
 * the service count cannot be read, is followed by a second.
 */
async function stepApply(ctx: Ctx, out: StepPrinter): Promise<void> {
  const env = ctx.args.env;
  const projectId = ctx.inputs.RAILWAY_PROJECT_ID;
  const count = async (): Promise<number | null> =>
    projectId === undefined || ctx.args.dryRun ? null : statusServiceCount(ctx, projectId, env);
  const apply = (): Promise<CliResult> =>
    cli(ctx, 'railway', ['config', 'apply', '--environment', env, '--yes'], { mutating: true });

  const before = await count();
  const first = await apply();
  if (first.code !== 0) {
    out.line('fail', `config apply: exit ${String(first.code)}`);
    return;
  }
  if (ctx.args.dryRun) {
    out.line('ok', 'dry-run: config not applied');
    return;
  }
  const after = await count();
  if (before !== null && after !== null && after <= before) {
    out.line('ok', 'config applied');
    return;
  }
  const second = await apply();
  if (second.code !== 0) {
    out.line('fail', `config apply (second): exit ${String(second.code)}`);
    return;
  }
  const why =
    before === null || after === null
      ? 'the service count could not be read'
      : `the first apply created ${String(after - before)} service(s)`;
  out.line('ok', `config applied twice: ${why}`);
}

const POSTGRES_SECRETS = [
  'POSTGRES_PASSWORD',
  'API_DB_PASSWORD',
  'WORKER_DB_PASSWORD',
  'BACKUP_DB_PASSWORD',
  'ADMIN_DB_PASSWORD',
] as const;
const APP_SERVICES = ['api', 'worker', 'admin'] as const;

async function stepGenerateSecrets(ctx: Ctx, out: StepPrinter): Promise<void> {
  const lists = new Map<string, VariableList>();
  for (const service of ['postgres', ...APP_SERVICES]) {
    const list = await readVariables(ctx, out, service);
    if (list === null) {
      return;
    }
    lists.set(service, list);
  }
  const listed = (service: string, key: string): boolean => lists.get(service)?.has(key) === true;
  if (ctx.args.rotate === 'APP_SECRET') {
    if (!APP_SERVICES.every((service) => listed(service, 'APP_SECRET_PREVIOUS'))) {
      out.line('fail', '--rotate APP_SECRET needs APP_SECRET_PREVIOUS on api, worker and admin');
      return;
    }
  }
  const absent: { service: string; key: string }[] = POSTGRES_SECRETS.filter(
    (key) => !listed('postgres', key),
  ).map((key) => ({ service: 'postgres', key }));
  const secretOn = APP_SERVICES.filter((service) => listed(service, 'APP_SECRET'));
  const secretOff = APP_SERVICES.filter((service) => !listed(service, 'APP_SECRET'));
  for (const service of secretOff) {
    absent.push({ service, key: 'APP_SECRET' });
  }
  if (absent.length > 0) {
    const history = await readDeployments(ctx, 'api', ['--limit', '1000']);
    if (history === null) {
      out.line('fail', 'deployment list --service api: unexpected output');
      return;
    }
    const first = absent[0];
    if (first !== undefined && history.some((item) => item.status === 'SUCCESS')) {
      out.line(
        'fail',
        `${first.key} is not listed on ${first.service} but api has deployed; refusing to generate (RB-infra)`,
      );
      return;
    }
  }
  const [missingOne] = secretOff;
  if (secretOn.length > 0 && missingOne !== undefined) {
    out.line(
      'fail',
      `APP_SECRET is on ${secretOn.join(' and ')} but not on ${missingOne}: set it from the password manager (RB-infra)`,
    );
    return;
  }
  const values = new Map<string, string>();
  for (const key of POSTGRES_SECRETS) {
    if (!listed('postgres', key)) {
      values.set(key, ctx.randomBytes(32).toString('base64url'));
    }
  }
  if (secretOn.length === 0 || ctx.args.rotate === 'APP_SECRET') {
    values.set('APP_SECRET', ctx.randomBytes(32).toString('hex'));
  }
  for (const key of POSTGRES_SECRETS) {
    if (listed('postgres', key)) {
      out.line('skip', `${key} on postgres present`);
    }
  }
  if (!values.has('APP_SECRET')) {
    out.line('skip', 'APP_SECRET on api, worker and admin present');
  }
  if (values.size === 0) {
    return;
  }
  // The record is written before anything is set, so a value Railway holds is never lost.
  if (!ctx.args.dryRun) {
    writeSecretsFile(ctx, values);
  }
  for (const [key, value] of values) {
    ctx.generated.set(key, value);
    const services = key === 'APP_SECRET' ? APP_SERVICES : (['postgres'] as const);
    for (const service of services) {
      if (!(await setVariable(ctx, out, service, key, value))) {
        return;
      }
    }
    out.line('ok', `generated ${key} on ${services.join(', ')}`);
  }
}

function knownValue(ctx: Ctx, service: string, key: string): string | null {
  const setNow = ctx.setInRun.get(`${service}/${key}`);
  if (setNow !== undefined) {
    return setNow;
  }
  if (key === 'RESEND_API_KEY') {
    return ctx.inputs.RESEND_API_KEY ?? null;
  }
  return ctx.generated.get(key) ?? readSecretsFile(ctx)[key] ?? null;
}

async function stepSeal(ctx: Ctx, out: StepPrinter): Promise<void> {
  const services = [...new Set(SEALED.map((row) => row.service))];
  const lists = new Map<string, VariableList>();
  for (const service of services) {
    const list = await readVariables(ctx, out, service);
    if (list === null) {
      return;
    }
    lists.set(service, list);
  }
  const rows = SEALED.filter(
    (row) =>
      lists.get(row.service)?.has(row.key) === true ||
      ctx.setInRun.has(`${row.service}/${row.key}`),
  );
  if (rows.length === 0) {
    out.line('skip', 'no sealed variable is set');
    return;
  }
  ctx.io.out(`seal variables ${rows.map((row) => `${row.service}/${row.key}`).join(' ')}`);
  const answer = ctx.args.dryRun
    ? null
    : await ctx.prompt(
        "Seal these variables in the dashboard (service, Variables, the variable's menu, Seal). Done? [y/N]",
        { hidden: false },
      );
  if (answer?.trim().toLowerCase() !== 'y') {
    for (const row of rows) {
      out.line('owner-check', `seal ${row.service}/${row.key}`);
    }
    return;
  }
  const after = new Map<string, VariableList>();
  for (const service of services) {
    const list = await readVariables(ctx, out, service);
    if (list === null) {
      return;
    }
    after.set(service, list);
  }
  for (const row of rows) {
    const shown = after.get(row.service)?.get(row.key) ?? null;
    const known = knownValue(ctx, row.service, row.key);
    // A value still returned is sealed only when it differs from the one known; with nothing to
    // compare it with, the owner checks it (D-831).
    if (shown !== null && (known === null || shown === known)) {
      out.line('owner-check', `seal ${row.service}/${row.key}`);
    } else {
      out.line('ok', `sealed ${row.service}/${row.key}`);
    }
  }
}

type OwnerValue = {
  key: RotateKey | 'EMAIL_FROM' | 'ADMIN_EMAILS';
  services: readonly string[];
  input: InputKey;
  sealed: boolean;
  value: string | null;
};

async function stepOwnerValues(ctx: Ctx, out: StepPrinter): Promise<void> {
  const inputs = ctx.inputs;
  const rows: OwnerValue[] = [
    {
      key: 'RESEND_API_KEY',
      services: APP_SERVICES,
      input: 'RESEND_API_KEY',
      sealed: true,
      value: inputs.RESEND_API_KEY ?? null,
    },
    {
      key: 'EMAIL_FROM',
      services: APP_SERVICES,
      input: 'MAIL_HOST',
      sealed: false,
      value:
        inputs.MAIL_HOST === undefined
          ? null
          : composeEmailFrom(ctx.variant.displayName, inputs.MAIL_HOST),
    },
    {
      key: 'ADMIN_EMAILS',
      services: APP_SERVICES,
      input: 'ADMIN_EMAILS',
      sealed: false,
      value: inputs.ADMIN_EMAILS ?? null,
    },
    {
      key: 'BACKUP_PUBLIC_KEY',
      services: ['backup'],
      input: 'BACKUP_PUBLIC_KEY_FILE',
      sealed: false,
      value: inputs.BACKUP_PUBLIC_KEY_FILE === undefined ? null : ctx.publicKeyPem,
    },
  ];
  const lists = new Map<string, VariableList>();
  for (const row of rows) {
    if (row.value === null) {
      out.line('skip', `${row.key} (${INPUT_KEYS[row.input].ownerInput})`);
      continue;
    }
    for (const service of row.services) {
      let list = lists.get(service);
      if (list === undefined) {
        const read = await readVariables(ctx, out, service);
        if (read === null) {
          return;
        }
        list = read;
        lists.set(service, list);
      }
      const rotating = ctx.args.rotate === row.key;
      if (list.has(row.key)) {
        const current = list.get(row.key) ?? null;
        if (current === row.value) {
          out.line('skip', `${row.key} unchanged on ${service}`);
          continue;
        }
        if ((current === null || row.sealed) && !rotating) {
          out.line(
            'skip',
            `${row.key} on ${service} is kept; pass --rotate ${row.key} to replace it`,
          );
          continue;
        }
      }
      if (!(await setVariable(ctx, out, service, row.key, row.value))) {
        return;
      }
      out.line('ok', `set ${row.key} on ${service}`);
      if (row.sealed) {
        // The seal step runs before this one, so a sealed value set here is left to seal.
        out.line('owner-check', `seal ${service}/${row.key}`);
      }
    }
  }
}

const ROLES_SQL = join('packages', 'db', 'sql', 'roles.sql');
const PSQL = ['psql', '-U', 'citizenrun', '-d', 'citizenrun', '-v', 'ON_ERROR_STOP=1', '-X', '-q'];
// The three checks run as one query on standard input: arguments to `railway ssh` reach a remote
// shell, which would split a quoted `-c` statement at its spaces.
const SETTINGS_QUERY =
  "select current_setting('shared_buffers'), current_setting('max_connections'), postgis_full_version();\n";

function sshArgs(ctx: Ctx, command: readonly string[]): string[] {
  return ['ssh', '--service', ctx.args.dbService, '--environment', ctx.args.env, '--', ...command];
}

// `railway ssh` at 5.74.0 names this command when no SSH key of the account is registered.
const SSH_KEY_MISSING = /ssh keys add/i;

type Readiness = 'ready' | 'down' | 'no-ssh-key';

async function pgIsReady(ctx: Ctx, out: StepPrinter): Promise<Readiness> {
  const args = sshArgs(ctx, ['pg_isready', '-U', 'citizenrun', '-d', 'citizenrun']);
  const result = await cli(ctx, 'railway', args, { mutating: true });
  if (result.code === 0) {
    return 'ready';
  }
  if (SSH_KEY_MISSING.test(result.stderr)) {
    out.line(
      'fail',
      'railway ssh has no registered SSH key: run pnpm exec railway ssh keys add in your terminal (RB-infra)',
    );
    return 'no-ssh-key';
  }
  return 'down';
}

async function waitForDatabase(ctx: Ctx, out: StepPrinter): Promise<boolean> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const readiness = await pgIsReady(ctx, out);
    if (readiness !== 'down') {
      return readiness === 'ready';
    }
    if (attempt < 30) {
      await ctx.sleep(10_000);
    }
  }
  out.line('fail', `pg_isready on ${ctx.args.dbService} did not answer after 30 tries`);
  return false;
}

/** Redeploys the database service, waits for the new deployment, then for `pg_isready` (D-831). */
async function redeployDatabase(ctx: Ctx, out: StepPrinter): Promise<boolean> {
  const service = ctx.args.dbService;
  const before = await readDeployments(ctx, service);
  if (before === null) {
    out.line('fail', `deployment list --service ${service}: unexpected output`);
    return false;
  }
  const redeploy = await cli(
    ctx,
    'railway',
    ['redeploy', '--service', service, '--environment', ctx.args.env, '--yes'],
    { mutating: true },
  );
  if (redeploy.code !== 0) {
    out.line('fail', `redeploy ${service}: exit ${String(redeploy.code)}`);
    ctx.failHint = waitHint(ctx, service);
    return false;
  }
  // The redeploy returns before the new instance runs; the old one may still answer (D-831).
  if (!(await waitForDeployment(ctx, out, service, newest(before)))) {
    return false;
  }
  return waitForDatabase(ctx, out);
}

/**
 * Waits until the database answers. A new environment's first apply starts the database before
 * step 4 sets its passwords, and a variable set with --skip-deploys reaches it only through a new
 * deployment, so when it does not answer and api has never deployed, it is redeployed once (D-840).
 */
async function startDatabase(ctx: Ctx, out: StepPrinter): Promise<boolean> {
  const service = ctx.args.dbService;
  const first = await pgIsReady(ctx, out);
  if (first !== 'down') {
    return first === 'ready';
  }
  const history = await readDeployments(ctx, 'api', ['--limit', '1000']);
  if (history === null) {
    out.line('fail', 'deployment list --service api: unexpected output');
    return false;
  }
  if (history.some((item) => item.status === 'SUCCESS')) {
    // A live environment's database is never restarted by this step.
    if (await waitForDatabase(ctx, out)) {
      return true;
    }
    ctx.failHint = `api has deployed, so the step does not redeploy ${service}: read pnpm exec railway logs --service ${service} --environment ${ctx.args.env}`;
    return false;
  }
  if (!(await redeployDatabase(ctx, out))) {
    return false;
  }
  out.line('ok', `${service} did not answer; redeployed with its variables, and it answers`);
  return true;
}

type Settings = { sharedBuffers: string; maxConnections: string; postgis: string };

async function readSettings(ctx: Ctx, out: StepPrinter): Promise<Settings | null> {
  const result = await cli(ctx, 'railway', sshArgs(ctx, [...PSQL, '-A', '-t']), {
    stdin: SETTINGS_QUERY,
    mutating: true,
  });
  const [sharedBuffers, maxConnections, ...rest] = result.stdout.trim().split('|');
  const postgis = rest.join('|');
  if (
    result.code !== 0 ||
    sharedBuffers === undefined ||
    maxConnections === undefined ||
    postgis === ''
  ) {
    out.line('fail', `settings query on ${ctx.args.dbService}: exit ${String(result.code)}`);
    return null;
  }
  return { sharedBuffers, maxConnections, postgis };
}

async function stepDatabase(ctx: Ctx, out: StepPrinter): Promise<void> {
  if (ctx.args.dryRun) {
    out.line(
      'skip',
      `dry-run: pg_isready, and a redeploy of ${ctx.args.dbService} on a new environment when it does not answer`,
    );
  } else if (!(await startDatabase(ctx, out))) {
    return;
  }
  const stored = readSecretsFile(ctx);
  const verifiers: Partial<Record<DbRole, string>> = {};
  const unknown: DbRole[] = [];
  for (const role of DB_ROLES) {
    const key = ROLE_PASSWORD_KEYS[role];
    const password = ctx.generated.get(key) ?? stored[key];
    if (password === undefined) {
      unknown.push(role);
    } else {
      verifiers[role] = scramVerifier(password);
    }
  }
  const template = readFileSync(join(ctx.io.repoRoot, ROLES_SQL), 'utf8');
  const sql = fillSomeMarkers(stripRolePasswords(template, unknown), verifiers);
  for (const role of unknown) {
    out.line('ok', `password kept for ${ROLE_NAMES[role]}`);
  }
  const applied = await cli(ctx, 'railway', sshArgs(ctx, PSQL), { stdin: sql, mutating: true });
  if (applied.code !== 0) {
    out.line('fail', `roles.sql on ${ctx.args.dbService}: exit ${String(applied.code)}`);
    return;
  }
  if (ctx.args.dryRun) {
    out.line('skip', 'dry-run: show shared_buffers, show max_connections, postgis_full_version()');
    return;
  }
  out.line('ok', `roles.sql applied on ${ctx.args.dbService}`);
  let settings = await readSettings(ctx, out);
  if (settings === null) {
    return;
  }
  if (settings.sharedBuffers !== '512MB') {
    if (!(await redeployDatabase(ctx, out))) {
      return;
    }
    settings = await readSettings(ctx, out);
    if (settings === null) {
      return;
    }
    if (settings.sharedBuffers !== '512MB') {
      out.line('fail', `shared_buffers is ${settings.sharedBuffers} after the redeploy, not 512MB`);
      return;
    }
  }
  out.line('ok', 'shared_buffers 512MB');
  if (settings.maxConnections !== '100') {
    out.line('fail', `max_connections is ${settings.maxConnections}, not 100`);
    return;
  }
  out.line('ok', 'max_connections 100');
  out.line('ok', `postgis_full_version ${settings.postgis}`);
}

function pick(record: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return null;
}

/** Bucket credentials from either the variable names (`ACCESS_KEY_ID`) or camel case. */
function toCredentials(text: string): BucketCredentials | null {
  const record = parseJson(LooseRecord, text);
  if (record === null) {
    return null;
  }
  const bucket = pick(record, ['BUCKET', 'bucketName', 'bucket']);
  const endpoint = pick(record, ['ENDPOINT', 'endpoint']);
  const region = pick(record, ['REGION', 'region']);
  const accessKeyId = pick(record, ['ACCESS_KEY_ID', 'accessKeyId']);
  const secretAccessKey = pick(record, ['SECRET_ACCESS_KEY', 'secretAccessKey']);
  if (
    bucket === null ||
    endpoint === null ||
    region === null ||
    accessKeyId === null ||
    secretAccessKey === null
  ) {
    return null;
  }
  return { bucket, endpoint, region, accessKeyId, secretAccessKey };
}

const CorsRuleShape = z.looseObject({
  AllowedOrigins: z.array(z.string()).optional(),
  AllowedMethods: z.array(z.string()).optional(),
  AllowedHeaders: z.array(z.string()).optional(),
  ExposeHeaders: z.array(z.string()).optional(),
  MaxAgeSeconds: z.number().optional(),
});

/** CORS rules as comparable JSON: the five fields, each list sorted, the rules sorted. */
function canonicalCors(rules: unknown): string | null {
  const parsed = z.array(CorsRuleShape).safeParse(rules);
  if (!parsed.success) {
    return null;
  }
  const sorted = (list: readonly string[] | undefined): string[] => [...(list ?? [])].sort();
  return JSON.stringify(
    parsed.data
      .map((rule) =>
        JSON.stringify({
          AllowedOrigins: sorted(rule.AllowedOrigins),
          AllowedMethods: sorted(rule.AllowedMethods),
          AllowedHeaders: sorted(rule.AllowedHeaders),
          ExposeHeaders: sorted(rule.ExposeHeaders),
          MaxAgeSeconds: rule.MaxAgeSeconds ?? null,
        }),
      )
      .sort(),
  );
}

async function stepBucketCors(ctx: Ctx, out: StepPrinter): Promise<void> {
  const host = ctx.variant.host;
  if (host === null) {
    out.line('fail', `brand.json: variants.${ctx.args.env}.host is not set (OI-domain)`);
    return;
  }
  const result = await cli(
    ctx,
    'railway',
    ['bucket', 'credentials', '-b', 'media', '-e', ctx.args.env, '--json'],
    { mutating: false },
  );
  if (result.code !== 0) {
    out.line('fail', `bucket credentials -b media: exit ${String(result.code)}`);
    return;
  }
  const credentials = toCredentials(result.stdout);
  if (credentials === null) {
    out.line('fail', 'bucket credentials -b media: unexpected output');
    return;
  }
  const rules = mediaCorsRules(mediaCorsOrigins(ctx.args.env, host, ctx.variant.adminHost));
  if (ctx.args.dryRun) {
    ctx.io.out('dry-run s3 PutBucketCors media');
    out.line('skip', 'dry-run: GetBucketCors comparison');
    return;
  }
  const client = ctx.createS3(credentials);
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: credentials.bucket,
        CORSConfiguration: { CORSRules: rules.CORSRules },
      }),
    );
  } catch (error) {
    out.line('fail', `PutBucketCors on media: ${error instanceof Error ? error.name : 'error'}`);
    return;
  }
  let current: unknown;
  try {
    current = (await client.send(new GetBucketCorsCommand({ Bucket: credentials.bucket })))
      .CORSRules;
  } catch (error) {
    out.line('fail', `GetBucketCors on media: ${error instanceof Error ? error.name : 'error'}`);
    return;
  }
  const expected = canonicalCors(rules.CORSRules);
  if (expected === null || canonicalCors(current) !== expected) {
    out.line('fail', 'GetBucketCors on media does not return the rules set');
    return;
  }
  ctx.corsVerified = true;
  out.line('ok', 'media CORS set and verified');
}

// Workspace limits are whole dollars; the agent limit is in cents. A null limit is one not set.
const UsageLimitStatus = z.looseObject({
  workspaceUsage: z
    .looseObject({
      usageLimit: z
        .looseObject({
          softLimit: z.number().nullable(),
          hardLimit: z.number().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  agentUsage: z.looseObject({ hardLimitCents: z.number().nullable() }),
});

async function stepUsageLimits(ctx: Ctx, out: StepPrinter): Promise<void> {
  const commands = [
    ['usage', 'limit', 'set', '--target', 'workspace', '--soft', '80', '--hard', '110'],
    ['usage', 'limit', 'set', '--target', 'agent', '--hard', '0'],
  ];
  for (const args of commands) {
    const result = await cli(ctx, 'railway', args, { mutating: true });
    if (result.code !== 0) {
      out.line('fail', `usage limit set --target ${args[4] ?? ''}: exit ${String(result.code)}`);
      return;
    }
  }
  if (ctx.args.dryRun) {
    out.line('skip', 'dry-run: usage limit status');
    return;
  }
  const status = await cli(ctx, 'railway', ['usage', 'limit', 'status', '--json'], {
    mutating: false,
  });
  const limits = status.code === 0 ? parseJson(UsageLimitStatus, status.stdout) : null;
  if (limits === null) {
    out.line('fail', 'usage limit status: unexpected output');
    return;
  }
  const workspace = limits.workspaceUsage?.usageLimit ?? null;
  if (
    workspace?.softLimit !== 80 ||
    workspace.hardLimit !== 110 ||
    limits.agentUsage.hardLimitCents !== 0
  ) {
    out.line('fail', 'usage limit status does not show 80, 110 and the agent limit 0');
    return;
  }
  ctx.limitsVerified = true;
  out.line('ok', 'workspace soft 80 and hard 110, agent hard 0');
}

async function stepServiceConfigFallbacks(ctx: Ctx, out: StepPrinter): Promise<void> {
  if (IAC_FIELD_FALLBACKS.length === 0) {
    out.line('skip', 'no fallback field recorded');
    return;
  }
  for (const field of IAC_FIELD_FALLBACKS) {
    const result = await cli(
      ctx,
      'railway',
      [
        'environment',
        'edit',
        '--environment',
        ctx.args.env,
        '--service-config',
        field.service,
        field.path,
        field.value,
      ],
      { mutating: true },
    );
    if (result.code !== 0) {
      out.line(
        'fail',
        `environment edit ${field.service} ${field.path}: exit ${String(result.code)}`,
      );
      return;
    }
    out.line('ok', `set ${field.service} ${field.path}`);
  }
  if (ctx.args.dryRun) {
    out.line('skip', 'dry-run: config plan');
    return;
  }
  const plan = await cli(
    ctx,
    'railway',
    ['config', 'plan', '--environment', ctx.args.env, '--detailed-exit-code'],
    { mutating: false },
  );
  if (plan.code !== 0) {
    out.line('fail', `config plan: exit ${String(plan.code)}`);
    return;
  }
  out.line('ok', 'config plan shows no difference');
}

async function stepVolumeBackups(ctx: Ctx, out: StepPrinter): Promise<void> {
  const answer = ctx.args.dryRun
    ? null
    : await ctx.prompt(
        'Turn on the Daily and Weekly backup schedules of the postgres volume (service postgres, Volume, Backups). Done? [y/N]',
        { hidden: false },
      );
  if (answer?.trim().toLowerCase() === 'y') {
    out.line('ok', `volume backups on for ${ctx.args.env}`);
    return;
  }
  out.line('owner-check', `volume backups for ${ctx.args.env}`);
}

async function stepTokens(ctx: Ctx, out: StepPrinter): Promise<void> {
  const env = ctx.args.env;
  const { tokenSecret } = ENV_NAMES[env];
  const answer = ctx.args.dryRun
    ? null
    : await ctx.prompt(
        `Create a project token named github-actions-${env} scoped to ${env} (Project settings, Tokens) and paste it (empty to leave it for later):`,
        { hidden: true },
      );
  const token = answer?.trim() ?? '';
  if (token === '') {
    out.line('owner-check', `project token github-actions-${env}`);
    if (!ctx.args.dryRun) {
      ctx.nextNote = `when the owner has made the project token github-actions-${env}, run: ${bootstrapCommand(ctx, 'tokens')}, then: ${bootstrapCommand(ctx, 'redeploy')}`;
    }
    return;
  }
  const result = await cli(ctx, 'gh', ['secret', 'set', tokenSecret, '--env', env], {
    stdin: token,
    mutating: true,
  });
  if (result.code !== 0) {
    out.line('fail', `gh secret set ${tokenSecret}: exit ${String(result.code)}`);
    return;
  }
  out.line('ok', `${tokenSecret} set in the GitHub Environment ${env}`);
  if (ctx.args.only === 'tokens') {
    // Only step 13 sets the ready variable, so an owner step finished later is followed by it.
    ctx.nextNote = `run: ${bootstrapCommand(ctx, 'redeploy')} (step 13 sets ${ENV_NAMES[env].readyVariable})`;
  }
}

const FAILED_STATES = new Set(['FAILED', 'CRASHED', 'REMOVED']);

/**
 * Polls until the service's newest deployment is SUCCESS; with `after`, only a deployment newer
 * than that one counts, so a redeploy is not taken for done while the old deployment is listed.
 */
async function waitForDeployment(
  ctx: Ctx,
  out: StepPrinter,
  service: string,
  after: Deployment | null = null,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const list = await readDeployments(ctx, service);
    const found = list === null ? null : newest(list);
    const latest = found !== null && after !== null && !isNewer(found, after) ? null : found;
    if (latest?.status === 'SUCCESS') {
      return true;
    }
    if (latest !== null && FAILED_STATES.has(latest.status)) {
      out.line('fail', `${service} deployment ${latest.status}`);
      return false;
    }
    if (attempt < 90) {
      await ctx.sleep(10_000);
    }
  }
  out.line('fail', `${service} deployment not SUCCESS after 90 polls`);
  return false;
}

async function readyzAnswers(ctx: Ctx, host: string): Promise<boolean> {
  try {
    const response = await ctx.fetch(`https://${host}/readyz`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) {
      return false;
    }
    const body = parseJson(z.looseObject({ db: z.string() }), await response.text());
    return body?.db === 'ok';
  } catch {
    return false;
  }
}

async function stepRedeploy(ctx: Ctx, out: StepPrinter): Promise<void> {
  const env = ctx.args.env;
  const host = ctx.variant.host;
  if (host === null) {
    out.line('fail', `brand.json: variants.${env}.host is not set (OI-domain)`);
    return;
  }
  // The admin service is deployed from its own repository, never from here (D-801).
  for (const service of ['api', 'worker']) {
    const result = await cli(
      ctx,
      'railway',
      ['redeploy', '--service', service, '--environment', env, '--yes'],
      { mutating: true },
    );
    if (result.code !== 0) {
      out.line('fail', `redeploy ${service}: exit ${String(result.code)}`);
      ctx.failHint = waitHint(ctx, service);
      return;
    }
  }
  if (ctx.args.dryRun) {
    out.line('skip', 'dry-run: deployment poll and /readyz');
  } else {
    for (const service of ['api', 'worker']) {
      if (!(await waitForDeployment(ctx, out, service))) {
        return;
      }
    }
    if (!(await readyzAnswers(ctx, host))) {
      out.line('fail', `/readyz on ${env} does not answer 200 with db ok`);
      // The host answers only once its CNAME resolves and Railway has issued its certificate.
      ctx.failHint = `check that ${host} resolves to the CNAME target Railway shows for the api domain and that Railway shows its certificate (RB-infra item 15)`;
      return;
    }
    out.line('ok', 'api and worker deployed; /readyz answers db ok');
  }
  const { tokenSecret, readyVariable } = ENV_NAMES[env];
  const secrets = await cli(ctx, 'gh', ['secret', 'list', '--env', env, '--json', 'name'], {
    mutating: false,
  });
  const names = secrets.code === 0 ? parseJson(NamedArray, secrets.stdout) : null;
  if (names === null) {
    out.line('fail', `gh secret list --env ${env}: unexpected output`);
    return;
  }
  if (!names.some((item) => item.name === tokenSecret)) {
    out.line('owner-check', `${readyVariable} waits for the project token`);
    return;
  }
  const set = await cli(ctx, 'gh', ['variable', 'set', readyVariable, '--body', 'true'], {
    mutating: true,
  });
  if (set.code !== 0) {
    out.line('fail', `gh variable set ${readyVariable}: exit ${String(set.code)}`);
    return;
  }
  ctx.readyVariableSet = !ctx.args.dryRun;
  out.line('ok', ctx.args.dryRun ? `dry-run: ${readyVariable} not set` : `${readyVariable} set`);
}

async function stepReport(ctx: Ctx): Promise<void> {
  const out = (detail: string): void => {
    ctx.io.out(`report ${detail}`);
  };
  out(`environment ${ctx.args.env}`);
  for (const service of ['postgres', 'api', 'worker', 'backup', 'admin']) {
    const list = await readDeployments(ctx, service);
    const latest = list === null ? undefined : newest(list);
    const status = latest === undefined ? 'unknown' : (latest?.status ?? 'none');
    out(`service ${service} ${status}`);
  }
  out('buckets media data backups');
  out(`cors ${ctx.corsVerified ? 'verified' : 'not verified'}`);
  out(`limits ${ctx.limitsVerified ? 'verified' : 'not verified'}`);
  for (const check of ctx.ownerChecks) {
    out(`owner-check ${check}`);
  }
  for (const [key, row] of Object.entries(INPUT_KEYS)) {
    if (row.setByThisVersion && isInputKey(key) && ctx.inputs[key] === undefined) {
      out(`absent ${key} (${row.ownerInput})`);
    }
  }
  out(`ready-variable ${ctx.readyVariableSet ? 'set' : 'not set'}`);
}

type StepRunner = (ctx: Ctx, out: StepPrinter) => Promise<void>;

const STEPS: Record<Exclude<StepName, 'preflight' | 'report'>, StepRunner> = {
  environment: stepEnvironment,
  apply: stepApply,
  'generate-secrets': stepGenerateSecrets,
  seal: stepSeal,
  'owner-values': stepOwnerValues,
  database: stepDatabase,
  'bucket-cors': stepBucketCors,
  'usage-limits': stepUsageLimits,
  'service-config-fallbacks': stepServiceConfigFallbacks,
  'volume-backups': stepVolumeBackups,
  tokens: stepTokens,
  redeploy: stepRedeploy,
};

/** Runs one step; resolves true when it failed. An unexpected error prints its class name only. */
async function runStep(
  ctx: Ctx,
  step: Exclude<StepName, 'preflight' | 'report'>,
): Promise<boolean> {
  const out = new StepPrinter(ctx, step);
  try {
    await STEPS[step](ctx, out);
  } catch (error) {
    const detail =
      error instanceof StepError ? error.message : error instanceof Error ? error.name : 'error';
    out.line('fail', detail);
  }
  return out.failed;
}

function defaultPrompt(question: string, options: { hidden: boolean }): Promise<string | null> {
  return new Promise((resolvePromise) => {
    let muted = false;
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (!muted) {
          process.stdout.write(chunk);
        }
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
    let answered = false;
    rl.on('close', () => {
      if (!answered) {
        resolvePromise(null);
      }
    });
    rl.question(`${question} `, (answer) => {
      answered = true;
      if (options.hidden) {
        process.stdout.write('\n');
      }
      rl.close();
      resolvePromise(answer);
    });
    muted = options.hidden;
  });
}

/** Runs the bootstrap; resolves with the exit code: 0 done, 1 a step failed, 2 a usage error. */
export async function runBootstrap(argv: readonly string[], io: BootstrapIo): Promise<number> {
  let args: BootstrapArgs;
  try {
    args = parseBootstrapArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.out(`usage: ${error.message}; ${USAGE}`);
      return 2;
    }
    throw error;
  }
  const variant: BrandVariant = BRAND.variants[args.env];
  const ctx: Ctx = {
    args,
    io,
    variant,
    prompt: io.prompt ?? defaultPrompt,
    randomBytes: io.randomBytes ?? cryptoRandomBytes,
    createS3:
      io.createS3 ??
      ((credentials) =>
        createS3Client({
          endpoint: credentials.endpoint,
          region: credentials.region,
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          forcePathStyle: false,
        })),
    fetch: io.fetch ?? fetch,
    sleep:
      io.sleep ??
      ((ms) =>
        new Promise((resolvePromise) => {
          setTimeout(resolvePromise, ms);
        })),
    inputs: {},
    publicKeyPem: null,
    generated: new Map(),
    setInRun: new Map(),
    ownerChecks: [],
    corsVerified: false,
    limitsVerified: false,
    readyVariableSet: false,
    stopRun: false,
    failHint: null,
    nextNote: null,
  };
  if (!(await preflight(ctx))) {
    io.out(`next fix what each preflight line names; then run: ${rerunCommand(ctx, null)}`);
    return 1;
  }
  const selected: readonly StepName[] =
    args.only === null ? STEP_NAMES : args.only === 'preflight' ? [] : [args.only];
  let failedStep: StepName | null = null;
  for (const step of selected) {
    if (step === 'preflight' || step === 'report') {
      continue;
    }
    if (await runStep(ctx, step)) {
      failedStep = step;
      break;
    }
    if (ctx.stopRun) {
      return 0;
    }
  }
  if (selected.includes('report')) {
    await stepReport(ctx);
  }
  if (failedStep !== null) {
    const hint =
      ctx.failHint ??
      'run the command the fail line names by hand to read its message, and fix the cause';
    io.out(`next ${hint}; then run: ${rerunCommand(ctx, failedStep)}`);
    return 1;
  }
  if (ctx.nextNote !== null) {
    io.out(`next ${ctx.nextNote}`);
  }
  return 0;
}

/**
 * The command to run after a failure: the same `--only` step when one was given; `--only redeploy`
 * when the last step failed, since every step before it is done; otherwise the whole run, whose
 * steps each check their state first (D-840). A rotation is finished by its runbook instead.
 */
function rerunCommand(ctx: Ctx, failedStep: StepName | null): string {
  if (ctx.args.rotate !== null) {
    return `the step RB-rotate-secrets names for --rotate ${ctx.args.rotate}`;
  }
  if (ctx.args.only !== null) {
    return bootstrapCommand(ctx, ctx.args.only);
  }
  return bootstrapCommand(ctx, failedStep === 'redeploy' ? 'redeploy' : null);
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBootstrap(process.argv.slice(2), {
    repoRoot: repoRoot(),
    home: homedir(),
    env: process.env,
    out: (line) => {
      console.log(line);
    },
  });
}
