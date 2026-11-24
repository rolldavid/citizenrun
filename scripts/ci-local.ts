// The CI jobs on this machine, standing in for GitHub Actions until the repository is pushed
// (D-416, D-558):
//   pnpm ci:local [--nightly] [--job <name>[,<name>...]] [--base <ref>] [--update-snapshots]
//     [--keep-going] [--durations]
// It uses no secret and no cloud account. Every job runs at the host's own architecture.
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { run } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';

type Env = Readonly<Record<string, string | undefined>>;

export type JobContext = {
  readonly root: string;
  readonly base: string;
  readonly updateSnapshots: boolean;
  /** The parent's environment plus TZ=UTC; every child process gets it. */
  readonly env: Env;
};

export type CiJob = {
  readonly name: string;
  readonly workflow: 'ci' | 'nightly';
  readonly needsPgDump17: boolean;
  readonly run: (ctx: JobContext) => Promise<void>;
};

export type CiLocalArgs = {
  nightly: boolean;
  jobs: readonly string[] | null;
  base: string;
  updateSnapshots: boolean;
  keepGoing: boolean;
  durations: boolean;
};

/** A command-line mistake; the script prints the message and exits 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** A job step that failed; the message is printed and the job fails. */
class JobFailure extends Error {
  override name = 'JobFailure';
}

const USAGE =
  'pnpm ci:local [--nightly] [--job <name>[,<name>...]] [--base <ref>] [--update-snapshots] [--keep-going] [--durations]';

export const NO_LOCAL_FORM = ['bucket-smoke'] as const;

const BUCKET_SMOKE_MESSAGE =
  'bucket-smoke has no local form: it runs on GitHub once staging exists (OI-railway, OI-github-actions)';

const PG_DUMP_MESSAGE = 'pg_dump 17 must be first on PATH (postgresql-client-17; RB-local-dev)';

// Fixed names of the local images job: one images run at a time on a machine.
const COMPOSE_NETWORK = 'citizenrun_default';
const CI_DATABASE = 'citizenrun_ci';
const CI_DATABASE_URL = `postgresql://citizenrun:citizenrun@postgres:5432/${CI_DATABASE}`;
const API_CONTAINER = 'citizenrun-ci-api';
const API_HOST_PORT = 18080;
const BACKUP_BUCKET = 'ci-backups';
const SERVICES = ['api', 'worker', 'backup'] as const;
// The fixed, public, local-only object store keys of docker-compose.yml.
const STORE_KEY_ID = 'osdev';
const STORE_SECRET = 'osdev-secret-key';

/** Runs a command without a shell, its output streamed through; a non-zero exit fails the job. */
async function step(
  ctx: JobContext,
  command: string,
  args: readonly string[],
  extraEnv: Env = {},
): Promise<void> {
  const result = await run(command, args, {
    cwd: ctx.root,
    env: { ...ctx.env, ...extraEnv },
    inherit: true,
  });
  if (result.code !== 0) {
    throw new JobFailure(`${command} ${args.join(' ')} exited ${String(result.code)}`);
  }
}

/** Runs a command and returns its standard output; a non-zero exit fails the job. */
async function capture(ctx: JobContext, command: string, args: readonly string[]): Promise<string> {
  const result = await run(command, args, { cwd: ctx.root, env: ctx.env });
  if (result.code !== 0) {
    process.stderr.write(result.stderr);
    throw new JobFailure(`${command} ${args.join(' ')} exited ${String(result.code)}`);
  }
  return result.stdout;
}

/** Runs a command whose failure does not matter (clean-up of a previous run). */
async function attempt(ctx: JobContext, command: string, args: readonly string[]): Promise<void> {
  try {
    await run(command, args, { cwd: ctx.root, env: ctx.env });
  } catch {
    // The command is missing or could not start: nothing to clean up.
  }
}

// ---------------------------------------------------------------------------------------------
// gitleaks

const GitleaksAssetSchema = z.strictObject({ url: z.string(), sha256: z.string() });
const GitleaksPinSchema = z.strictObject({
  version: z.string(),
  assets: z.strictObject({
    'linux-x64': GitleaksAssetSchema,
    'darwin-arm64': GitleaksAssetSchema,
    'darwin-x64': GitleaksAssetSchema,
  }),
});

export type GitleaksPin = z.infer<typeof GitleaksPinSchema>;

/** The `scripts/gitleaks.json` entry for a host platform and architecture. */
export function gitleaksAssetFor(
  platform: string,
  arch: string,
): 'linux-x64' | 'darwin-arm64' | 'darwin-x64' {
  if (platform === 'linux' && arch === 'x64') {
    return 'linux-x64';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'darwin-x64';
  }
  throw new Error(`no gitleaks asset for ${platform}-${arch}`);
}

export function readGitleaksPin(root: string): GitleaksPin {
  return GitleaksPinSchema.parse(
    JSON.parse(readFileSync(join(root, 'scripts/gitleaks.json'), 'utf8')),
  );
}

/** The path of the pinned gitleaks binary, downloaded and checked by SHA-256 on first use. */
async function gitleaksBinary(ctx: JobContext): Promise<string> {
  const pin = readGitleaksPin(ctx.root);
  const asset = pin.assets[gitleaksAssetFor(process.platform, process.arch)];
  const dir = join(ctx.root, 'node_modules/.cache/gitleaks', pin.version);
  const binary = join(dir, 'gitleaks');
  if (existsSync(binary)) {
    return binary;
  }
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, 'gitleaks.tar.gz');
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new JobFailure(`gitleaks download answered ${String(response.status)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256) {
    rmSync(dir, { recursive: true, force: true });
    throw new JobFailure(`gitleaks ${pin.version}: SHA-256 mismatch, download deleted`);
  }
  writeFileSync(archive, bytes);
  try {
    await step(ctx, 'tar', ['-xzf', archive, '-C', dir, 'gitleaks']);
  } finally {
    rmSync(archive, { force: true });
  }
  return binary;
}

// ---------------------------------------------------------------------------------------------
// The images job: three builds, the API smoke and the backup smoke on the compose network.

const ImagesSchema = z.object({ awscli: z.string() });

function awscliImage(root: string): string {
  return ImagesSchema.parse(JSON.parse(readFileSync(join(root, 'docker/images.json'), 'utf8')))
    .awscli;
}

function hostUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new JobFailure('the images job needs a POSIX host user');
  }
  return `${String(uid)}:${String(gid)}`;
}

async function psql(ctx: JobContext, ...statements: readonly string[]): Promise<void> {
  await step(ctx, 'docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'citizenrun',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    ...statements.flatMap((statement) => ['-c', statement]),
  ]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiSmoke(ctx: JobContext): Promise<void> {
  await step(ctx, 'docker', [
    'run',
    '--rm',
    '--network',
    COMPOSE_NETWORK,
    '-e',
    `DATABASE_URL=${CI_DATABASE_URL}`,
    'citizenrun-api:local',
    'node',
    'packages/db/dist/migrate.js',
  ]);
  await attempt(ctx, 'docker', ['rm', '-f', API_CONTAINER]);
  try {
    const env = {
      APP_ENV: 'ci',
      LOG_LEVEL: 'info',
      PORT: '8080',
      DATABASE_URL: CI_DATABASE_URL,
      PUBLIC_URL: `http://localhost:${String(API_HOST_PORT)}`,
      MEDIA_BUCKET: 'media',
      MEDIA_ENDPOINT: 'http://seaweedfs:8333',
      MEDIA_REGION: 'us-east-1',
      MEDIA_ACCESS_KEY_ID: STORE_KEY_ID,
      MEDIA_SECRET_ACCESS_KEY: STORE_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
    };
    await step(ctx, 'docker', [
      'run',
      '-d',
      '--name',
      API_CONTAINER,
      '--network',
      COMPOSE_NETWORK,
      '-p',
      `127.0.0.1:${String(API_HOST_PORT)}:8080`,
      ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      'citizenrun-api:local',
    ]);
    const origin = `http://127.0.0.1:${String(API_HOST_PORT)}`;
    let ready: unknown = null;
    for (let second = 0; second < 60 && ready === null; second += 1) {
      try {
        const response = await fetch(`${origin}/readyz`);
        if (response.ok) {
          ready = await response.json();
          break;
        }
      } catch {
        // Not listening yet.
      }
      await sleep(1000);
    }
    if (ready === null) {
      throw new JobFailure('api smoke: /readyz did not answer 200 within 60 seconds');
    }
    const db = z.object({ db: z.string() }).safeParse(ready);
    if (!db.success || db.data.db !== 'ok') {
      throw new JobFailure(`api smoke: /readyz answered ${JSON.stringify(ready)}`);
    }
    const shell = await fetch(`${origin}/`);
    const body = await shell.text();
    if (shell.status !== 200) {
      throw new JobFailure(`api smoke: / answered ${String(shell.status)}`);
    }
    if (!/^no-cache/i.test(shell.headers.get('cache-control') ?? '')) {
      throw new JobFailure('api smoke: / has no Cache-Control: no-cache');
    }
    if (!body.includes('<style id="os-shell">')) {
      throw new JobFailure('api smoke: / is not the web shell');
    }
    console.log('api smoke: migrated, /readyz db ok, / serves the shell');
  } finally {
    await attempt(ctx, 'docker', ['logs', API_CONTAINER]);
    await attempt(ctx, 'docker', ['rm', '-f', API_CONTAINER]);
  }
}

async function backupSmoke(ctx: JobContext): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'ci-local-backup-'));
  const user = hostUser();
  const awscli = awscliImage(ctx.root);
  const aws = (args: readonly string[]): string[] => [
    'run',
    '--rm',
    '--network',
    COMPOSE_NETWORK,
    '--user',
    user,
    '-e',
    'HOME=/tmp',
    '-v',
    `${folder}:/work`,
    '-w',
    '/work',
    '-e',
    `AWS_ACCESS_KEY_ID=${STORE_KEY_ID}`,
    '-e',
    `AWS_SECRET_ACCESS_KEY=${STORE_SECRET}`,
    '-e',
    'AWS_DEFAULT_REGION=us-east-1',
    awscli,
    '--endpoint-url',
    'http://seaweedfs:8333',
    ...args,
  ];
  try {
    const key = join(folder, 'key.pem');
    const pub = join(folder, 'pub.pem');
    await step(ctx, 'openssl', [
      'genpkey',
      '-algorithm',
      'RSA',
      '-pkeyopt',
      'rsa_keygen_bits:4096',
      '-out',
      key,
    ]);
    await step(ctx, 'openssl', ['pkey', '-in', key, '-pubout', '-out', pub]);
    await attempt(ctx, 'docker', aws(['s3', 'rb', `s3://${BACKUP_BUCKET}`, '--force']));
    await step(ctx, 'docker', aws(['s3api', 'create-bucket', '--bucket', BACKUP_BUCKET]));
    const env = {
      APP_ENV: 'ci',
      DATABASE_URL: CI_DATABASE_URL,
      BACKUPS_BUCKET: BACKUP_BUCKET,
      BACKUPS_ENDPOINT: 'http://seaweedfs:8333',
      BACKUPS_REGION: 'us-east-1',
      BACKUPS_ACCESS_KEY_ID: STORE_KEY_ID,
      BACKUPS_SECRET_ACCESS_KEY: STORE_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
      BACKUP_PUBLIC_KEY: readFileSync(pub, 'utf8'),
    };
    // The values reach the container through its environment, never on the command line.
    await step(
      ctx,
      'docker',
      [
        'run',
        '--rm',
        '--network',
        COMPOSE_NETWORK,
        ...Object.keys(env).flatMap((name) => ['-e', name]),
        'citizenrun-backup:local',
      ],
      env,
    );
    const object = (
      await capture(
        ctx,
        'docker',
        aws([
          's3api',
          'list-objects-v2',
          '--bucket',
          BACKUP_BUCKET,
          '--prefix',
          'pg/',
          '--query',
          "Contents[?ends_with(Key, '.dump.enc')].Key | [0]",
          '--output',
          'text',
        ]),
      )
    ).trim();
    if (!/^pg\/\d{4}\/\d{2}\/[^/]+\.dump\.enc$/.test(object)) {
      throw new JobFailure(`backup smoke: no dump object under pg/ (found "${object}")`);
    }
    await step(
      ctx,
      'docker',
      aws(['s3', 'cp', `s3://${BACKUP_BUCKET}/${object}`, 'backup.dump.enc']),
    );
    await step(ctx, 'pnpm', [
      '--filter',
      '@citizenrun/worker',
      'exec',
      'tsx',
      'src/backup/decrypt.ts',
      '--in',
      join(folder, 'backup.dump.enc'),
      '--out',
      join(folder, 'backup.dump'),
      '--key',
      key,
    ]);
    const list = await capture(ctx, 'docker', [
      'run',
      '--rm',
      '--user',
      user,
      '-v',
      `${folder}:/data`,
      'citizenrun-backup:local',
      'pg_restore',
      '--list',
      '/data/backup.dump',
    ]);
    if (!list.includes(' TABLE DATA ')) {
      throw new JobFailure('backup smoke: pg_restore --list shows no TABLE DATA line');
    }
    console.log('backup smoke: encrypted dump written, decrypted and listed');
  } finally {
    await attempt(ctx, 'docker', aws(['s3', 'rb', `s3://${BACKUP_BUCKET}`, '--force']));
    rmSync(folder, { recursive: true, force: true });
  }
}

// Docker Desktop keeps its engine's disk inside a file on the host volume. When that volume
// fills during a build, the engine's store fails with input/output errors and stays broken
// until space is freed and Docker is restarted, so the jobs that build images stop first.
const GIB = 1024 ** 3;
export const MIN_FREE_BYTES_FOR_IMAGES = 5 * GIB;

/** The bytes an unprivileged process may still write on the volume that holds `path`. */
export function availableBytes(path: string): number {
  const stats = statfsSync(path);
  return stats.bavail * stats.bsize;
}

/** The message that stops a job building images on a nearly full volume, or null. */
export function freeSpaceFailure(
  available: number,
  required: number = MIN_FREE_BYTES_FOR_IMAGES,
): string | null {
  if (available >= required) {
    return null;
  }
  const gib = (bytes: number): string => (bytes / GIB).toFixed(1);
  return (
    `only ${gib(available)} GiB free on the host volume; building images needs at least ` +
    `${gib(required)} GiB, or the Docker engine's store can fail with input/output errors. ` +
    'Free space on the host, then run the job again.'
  );
}

function requireFreeSpace(ctx: JobContext): void {
  const failure = freeSpaceFailure(availableBytes(ctx.root));
  if (failure !== null) {
    throw new JobFailure(failure);
  }
}

async function imagesJob(ctx: JobContext): Promise<void> {
  requireFreeSpace(ctx);
  for (const service of SERVICES) {
    await step(ctx, 'docker', [
      'build',
      '-f',
      `docker/${service}.Dockerfile`,
      '-t',
      `citizenrun-${service}:local`,
      '.',
    ]);
  }
  await psql(
    ctx,
    `drop database if exists ${CI_DATABASE} with (force)`,
    `create database ${CI_DATABASE}`,
  );
  try {
    await apiSmoke(ctx);
    await backupSmoke(ctx);
  } finally {
    await psql(ctx, `drop database if exists ${CI_DATABASE} with (force)`);
  }
}

// ---------------------------------------------------------------------------------------------
// The other jobs

async function e2eJob(ctx: JobContext): Promise<void> {
  if (!existsSync(join(ctx.root, 'docker/e2e.Dockerfile'))) {
    throw new JobFailure('docker/e2e.Dockerfile is missing');
  }
  requireFreeSpace(ctx);
  await step(ctx, 'docker', [
    'build',
    '-f',
    'docker/e2e.Dockerfile',
    '-t',
    'citizenrun-e2e:local',
    '.',
  ]);
  const mounts = [
    'apps/mobile/e2e/web/__screenshots__',
    'apps/mobile/test-results',
    'apps/mobile/playwright-report',
  ];
  for (const mount of mounts) {
    mkdirSync(join(ctx.root, mount), { recursive: true });
  }
  const command = ctx.updateSnapshots
    ? ['pnpm', '--filter', '@citizenrun/mobile', 'exec', 'playwright', 'test', '--update-snapshots']
    : ['pnpm', 'e2e:web'];
  try {
    await step(ctx, 'docker', [
      'run',
      '--rm',
      '--network',
      COMPOSE_NETWORK,
      '-e',
      'TEST_DATABASE_URL=postgres://citizenrun:citizenrun@postgres:5432/postgres',
      '-e',
      'TEST_S3_ENDPOINT=http://seaweedfs:8333',
      ...mounts.flatMap((mount) => ['-v', `${join(ctx.root, mount)}:/app/${mount}`]),
      'citizenrun-e2e:local',
      ...command,
    ]);
  } finally {
    if (existsSync(join(ctx.root, 'apps/mobile/test-results/results.json'))) {
      await step(ctx, 'pnpm', [
        'exec',
        'tsx',
        'scripts/flake-report.ts',
        '--report',
        'apps/mobile/test-results/results.json',
      ]);
    }
  }
}

async function pnpmSteps(ctx: JobContext, commands: readonly (readonly string[])[]): Promise<void> {
  for (const args of commands) {
    await step(ctx, 'pnpm', args);
  }
}

export const CI_JOBS: readonly CiJob[] = [
  {
    name: 'static',
    workflow: 'ci',
    needsPgDump17: false,
    run: (ctx) =>
      pnpmSteps(ctx, [
        ['lint'],
        ['typecheck'],
        ['check:gen'],
        ['check:db'],
        ['check:i18n'],
        ['check:licenses'],
        ['--filter', '@citizenrun/mobile', 'run', 'doctor'],
        ['exec', 'tsx', 'scripts/check-workflows.ts'],
      ]),
  },
  {
    name: 'unit',
    workflow: 'ci',
    needsPgDump17: false,
    run: (ctx) => pnpmSteps(ctx, [['test']]),
  },
  {
    name: 'integration',
    workflow: 'ci',
    needsPgDump17: true,
    run: (ctx) => pnpmSteps(ctx, [['test:integration']]),
  },
  {
    name: 'web',
    workflow: 'ci',
    needsPgDump17: false,
    run: async (ctx) => {
      await pnpmSteps(ctx, [['build:web'], ['check:bundle']]);
      const gitleaks = await gitleaksBinary(ctx);
      await step(ctx, gitleaks, [
        'dir',
        '--redact',
        '--no-banner',
        '--config',
        '.gitleaks.toml',
        'apps/mobile/dist',
      ]);
    },
  },
  { name: 'images', workflow: 'ci', needsPgDump17: true, run: imagesJob },
  { name: 'e2e', workflow: 'ci', needsPgDump17: false, run: e2eJob },
  {
    name: 'audit',
    workflow: 'ci',
    needsPgDump17: false,
    run: (ctx) => pnpmSteps(ctx, [['audit', '--prod', '--audit-level=high']]),
  },
  {
    name: 'secrets',
    workflow: 'ci',
    needsPgDump17: false,
    run: async (ctx) => {
      const gitleaks = await gitleaksBinary(ctx);
      await step(ctx, gitleaks, [
        'git',
        '--redact',
        '--no-banner',
        '--config',
        '.gitleaks.toml',
        `--log-opts=${ciRange(ctx.base)}`,
      ]);
    },
  },
];

export const NIGHTLY_JOBS: readonly CiJob[] = [
  {
    name: 'verify',
    workflow: 'nightly',
    needsPgDump17: true,
    run: async (ctx) => {
      await step(ctx, 'pnpm', ['verify'], { TEST_SHUFFLE: '1' });
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Arguments and selection

/** Parses the command line; throws UsageError on an unknown option or a missing value. */
export function parseCiLocalArgs(argv: readonly string[]): CiLocalArgs {
  const args: CiLocalArgs = {
    nightly: false,
    jobs: null,
    base: 'main',
    updateSnapshots: false,
    keepGoing: false,
    durations: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--') || next === '') {
        throw new UsageError(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case '--nightly':
        args.nightly = true;
        break;
      case '--job':
        args.jobs = [
          ...(args.jobs ?? []),
          ...value()
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name !== ''),
        ];
        break;
      case '--base':
        args.base = value();
        break;
      case '--update-snapshots':
        args.updateSnapshots = true;
        break;
      case '--keep-going':
        args.keepGoing = true;
        break;
      case '--durations':
        args.durations = true;
        break;
      default:
        throw new UsageError(`unknown argument ${arg}`);
    }
  }
  return args;
}

/** The jobs to run, in the tables' order. Throws UsageError for a name with no local job. */
export function selectJobs(args: CiLocalArgs): CiJob[] {
  const pool = args.nightly ? NIGHTLY_JOBS : [...CI_JOBS, ...NIGHTLY_JOBS];
  if (args.jobs === null) {
    return [...(args.nightly ? NIGHTLY_JOBS : CI_JOBS)];
  }
  for (const name of args.jobs) {
    if ((NO_LOCAL_FORM as readonly string[]).includes(name)) {
      throw new UsageError(BUCKET_SMOKE_MESSAGE);
    }
    if (!pool.some((job) => job.name === name)) {
      const valid = pool.map((job) => job.name).join(', ');
      throw new UsageError(`unknown job ${name}; valid jobs: ${valid}`);
    }
  }
  return pool.filter((job) => args.jobs?.includes(job.name) === true);
}

/** The commit range the secrets job scans. */
export function ciRange(base: string): string {
  return `${base}..HEAD`;
}

/** The median of a non-empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median of an empty list');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] ?? 0) + upper) / 2;
}

// ---------------------------------------------------------------------------------------------
// The run record and the durations figure (BUD-ci-duration)

type JobRecord = { job: string; result: 'pass' | 'fail'; seconds: number };

const RunLineSchema = z.object({
  at: z.string(),
  head: z.string(),
  nightly: z.boolean(),
  jobs: z.array(
    z.object({ job: z.string(), result: z.enum(['pass', 'fail']), seconds: z.number() }),
  ),
});

export function runsFile(root: string): string {
  return join(root, 'node_modules/.cache/ci-local/runs.jsonl');
}

export type DurationFigure = { runs: number; medianSeconds: number | null };

export type DurationsReport = {
  environment: 'github' | 'local';
  machine: string;
  static: DurationFigure;
  unit: DurationFigure;
  budgetSeconds: 600;
  withinBudget: boolean;
};

const BUDGET_SECONDS = 600; // D-013: each of static and unit under 10 minutes
const DURATION_JOBS = ['static', 'unit'] as const;
type DurationJob = (typeof DURATION_JOBS)[number];

const GhRunsSchema = z.array(z.object({ databaseId: z.number() }));
const GhJobsSchema = z.object({
  jobs: z.array(
    z.object({ name: z.string(), startedAt: z.string(), completedAt: z.string().nullable() }),
  ),
});

async function ghOutput(args: readonly string[], env: Env): Promise<string | null> {
  try {
    const result = await run('gh', args, { env });
    return result.code === 0 ? result.stdout : null;
  } catch {
    return null; // gh is not installed
  }
}

/** The static and unit durations of the last successful ci.yml runs on main, or null. */
async function githubDurations(env: Env): Promise<Record<DurationJob, number[]> | null> {
  if ((await ghOutput(['auth', 'status'], env)) === null) {
    return null;
  }
  const listed = await ghOutput(
    [
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--branch',
      'main',
      '--status',
      'success',
      '--limit',
      '10',
      '--json',
      'databaseId',
    ],
    env,
  );
  const runs = listed === null ? null : GhRunsSchema.safeParse(JSON.parse(listed));
  if (runs === null || !runs.success || runs.data.length === 0) {
    return null;
  }
  const durations: Record<DurationJob, number[]> = { static: [], unit: [] };
  for (const { databaseId } of runs.data) {
    const viewed = await ghOutput(['run', 'view', String(databaseId), '--json', 'jobs'], env);
    const parsed = viewed === null ? null : GhJobsSchema.safeParse(JSON.parse(viewed));
    if (parsed === null || !parsed.success) {
      continue;
    }
    for (const name of DURATION_JOBS) {
      const job = parsed.data.jobs.find((entry) => entry.name === name);
      if (job?.completedAt != null) {
        const seconds = (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000;
        if (Number.isFinite(seconds) && seconds >= 0) {
          durations[name].push(seconds);
        }
      }
    }
  }
  return durations;
}

/** The last 10 passing durations of static and unit in the local run record. */
function localDurations(file: string): Record<DurationJob, number[]> {
  const durations: Record<DurationJob, number[]> = { static: [], unit: [] };
  if (!existsSync(file)) {
    return durations;
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = RunLineSchema.safeParse(value);
    if (!parsed.success) {
      continue;
    }
    for (const job of parsed.data.jobs) {
      if (job.result === 'pass' && (job.job === 'static' || job.job === 'unit')) {
        durations[job.job].push(job.seconds);
      }
    }
  }
  return { static: durations.static.slice(-10), unit: durations.unit.slice(-10) };
}

function figure(values: readonly number[]): DurationFigure {
  return { runs: values.length, medianSeconds: values.length === 0 ? null : median(values) };
}

/** BUD-ci-duration's figure: from GitHub when gh can read ci.yml runs on main, else local. */
export async function readDurations(options: {
  env: Env;
  runsFile: string;
  machine: string;
}): Promise<DurationsReport> {
  const github = await githubDurations(options.env);
  const durations = github ?? localDurations(options.runsFile);
  const staticFigure = figure(durations.static);
  const unitFigure = figure(durations.unit);
  const within = (value: number | null): boolean => value !== null && value <= BUDGET_SECONDS;
  return {
    environment: github === null ? 'local' : 'github',
    machine: options.machine,
    static: staticFigure,
    unit: unitFigure,
    budgetSeconds: BUDGET_SECONDS,
    withinBudget: within(staticFigure.medianSeconds) && within(unitFigure.medianSeconds),
  };
}

/** `<platform>-<arch>, <n> CPUs`, never the host name. */
export function machineLabel(): string {
  return `${process.platform}-${process.arch}, ${String(availableParallelism())} CPUs`;
}

// ---------------------------------------------------------------------------------------------
// Main

async function pgDumpIs17(env: Env): Promise<boolean> {
  try {
    const result = await run('pg_dump', ['--version'], { env });
    return result.code === 0 && result.stdout.includes(' 17.');
  } catch {
    return false;
  }
}

async function gitHead(root: string, env: Env): Promise<string> {
  try {
    const result = await run('git', ['rev-parse', 'HEAD'], { cwd: root, env });
    return result.stdout.trim();
  } catch {
    return '';
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let args: CiLocalArgs;
  let jobs: CiJob[];
  try {
    args = parseCiLocalArgs(argv);
    jobs = selectJobs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`ci-local: ${error.message}\nusage: ${USAGE}\n`);
      return 2;
    }
    throw error;
  }
  const root = repoRoot();
  const env: Env = { ...process.env, TZ: 'UTC' };

  if (args.durations) {
    const report = await readDurations({ env, runsFile: runsFile(root), machine: machineLabel() });
    console.log(JSON.stringify(report));
    return 0;
  }

  const ctx: JobContext = { root, base: args.base, updateSnapshots: args.updateSnapshots, env };
  const records: JobRecord[] = [];
  const compose = await run('docker', ['compose', 'up', '-d', '--wait'], {
    cwd: root,
    env,
    inherit: true,
  }).catch(() => ({ code: 1 }));
  if (compose.code !== 0) {
    process.stderr.write('ci-local: docker compose up -d --wait failed\n');
    return 1;
  }
  for (const job of jobs) {
    const started = performance.now();
    let result: 'pass' | 'fail' = 'pass';
    try {
      if (job.needsPgDump17 && !(await pgDumpIs17(env))) {
        throw new JobFailure(PG_DUMP_MESSAGE);
      }
      await job.run(ctx);
    } catch (error) {
      result = 'fail';
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${job.name}: ${message}\n`);
    }
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    records.push({ job: job.name, result, seconds });
    console.log(`${job.name} ${result} ${String(seconds)}s`);
    if (result === 'fail' && !args.keepGoing) {
      break;
    }
  }
  const file = runsFile(root);
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({
      at: new Date().toISOString(),
      head: await gitHead(root, env),
      nightly: args.nightly,
      jobs: records,
    })}\n`,
  );
  return records.some((record) => record.result === 'fail') ? 1 : 0;
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
