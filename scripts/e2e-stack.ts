// The built stack on port 8080, from the production web export and service bundles:
//   tsx scripts/e2e-stack.ts [--up] [--build] [--stand-in]
// Without --stand-in it is the seeded end-to-end stack on citizenrun_e2e, which it drops and
// seeds at every start; with --stand-in it is the local stand-in for staging on
// citizenrun_standin, which it creates once and never drops, truncates or seeds (D-559, TC-55).
// Importing this file starts nothing.
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createS3Client, ensureBucket } from '@citizenrun/shared/storage';
import { z } from 'zod';
import { mediaCorsRules } from './lib/cors.ts';
import { run } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';

export type StackMode = 'seeded' | 'standIn';
export type StackArgs = { up: boolean; build: boolean; mode: StackMode };
type Role = 'api' | 'worker';
type Env = Readonly<Record<string, string | undefined>>;

const USAGE = 'usage: tsx scripts/e2e-stack.ts [--up] [--build] [--stand-in]';

/** The stack's one origin; the seeded stack and the stand-in both use it, one at a time. */
const ORIGIN = 'http://localhost:8080';
const READY_URL = `${ORIGIN}/readyz`;
const READY_POLL_MS = 500;
const READY_LIMIT_MS = 120_000;

/** The compose stack's Postgres and object store, as the integration harness defaults to them. */
const DEFAULT_SERVER_URL = 'postgres://citizenrun:citizenrun@localhost:5432/postgres';
const DEFAULT_STORE_ENDPOINT = 'http://localhost:8333';
/** Hosts the stack may reach its Postgres and store on: this machine or a compose network. */
const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  'postgres',
  'host.docker.internal',
]);
const LOCAL_STORE_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  'seaweedfs',
  'host.docker.internal',
]);
/** The compose store's public development constants. */
const STORE = { region: 'us-east-1', accessKeyId: 'osdev', secretAccessKey: 'osdev-secret-key' };
/** The local APP_SECRET of the .env.example files, a public constant the API and worker share. */
const LOCAL_APP_SECRET = '0'.repeat(64);

/** The only variables of the calling shell a child receives; no owner value is among them. */
const PASSED_THROUGH = ['PATH', 'HOME', 'TMPDIR', 'TZ', 'LANG', 'NODE_OPTIONS'] as const;

/** Where the seeded stack writes the facts journeys read (TC-33); git-ignored. */
const SEED_FACTS_FILE = 'apps/mobile/e2e/.stack/seed-facts.json';

/**
 * The seed facts of one statement each: each key's value is the one JSON value its statement
 * returns on the seeded database, read after the seed (TC-33). The facts below are read by
 * `readSeedFacts` instead, because two of them take the first one's district.
 */
export const SEED_FACTS: readonly { key: string; sql: string }[] = [];

/**
 * The statements of the Durham County facts (TC-33). `$1` of the second and third is the
 * `district_id` the first one returns, bound as a parameter. `officeWithDeadline` derives each
 * office's next fileable election from `elections` by L-target-election rules 1 and 2, as the API
 * does while `offices.next_election_id` is empty: a runoff is never fileable (D-758).
 */
export const SEED_FACT_QUERIES = {
  durhamPoint: `
    select d.id as district_id, st_y(d.label_point) as lat, st_x(d.label_point) as lng
    from districts d
    where d.source_key = 'tiger:county:37063' and d.retired_at is null and d.label_point is not null`,
  officeWithDeadline: `
    select o.slug
    from offices o
    join districts d on d.id = o.district_id
    join jurisdictions oj on oj.id = o.jurisdiction_id
    cross join districts dc
    cross join lateral (
      select (now() at time zone coalesce(oj.timezone, 'America/New_York'))::date as today
    ) t
    cross join lateral (
      select e.filing_deadline
      from elections e
      where e.office_id = o.id and e.retired_at is null
        and e.kind not in ('primary_runoff', 'general_runoff')
        and (e.filing_deadline >= t.today
          or (e.filing_deadline is null and e.election_date > t.today))
      order by coalesce(e.filing_deadline, e.election_date), e.election_date,
        array_position(array['primary', 'general', 'special', 'primary_runoff', 'general_runoff'], e.kind),
        coalesce(e.party, ''), e.id
      limit 1
    ) ne
    where dc.id = $1
      and o.retired_at is null and d.label_point is not null
      and st_covers(dc.geom, d.label_point)
      and ne.filing_deadline is not null
    order by ne.filing_deadline, o.slug limit 1`,
  officeNotKnown: `
    select o.slug
    from offices o join districts d on d.id = o.district_id, districts dc
    where dc.id = $1 and o.retired_at is null and d.label_point is not null
      and st_covers(dc.geom, d.label_point)
      and o.pay_annual_cents is null and o.pay_amount_cents is null
      and o.pay_kind is distinct from 'none'
    order by o.slug limit 1`,
} as const;

export type SeedFactKey = keyof typeof SEED_FACT_QUERIES;

/** What each statement needs, named when it finds no row. */
const SEED_FACT_NEEDS: Readonly<Record<SeedFactKey, string>> = {
  durhamPoint: 'the Durham County district with a label point',
  officeWithDeadline:
    'an office in Durham County whose next fileable election has a filing deadline today or later',
  officeNotKnown: 'an office in Durham County with no pay amount and pay kind other than none',
};

/** Runs one fact's statement with its parameters; resolves with its rows as JSON objects. */
export type SeedFactQuery = (
  key: SeedFactKey,
  params: readonly string[],
) => Promise<readonly Record<string, unknown>[]>;

export type DurhamSeedFacts = {
  durhamPoint: { lat: number; lng: number };
  officeWithDeadline: string;
  officeNotKnown: string;
};

/** The first row of a fact's rows; a fact with no row stops the stack, naming what it needs. */
function firstRow(
  key: SeedFactKey,
  rows: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const row = rows[0];
  if (row === undefined) {
    throw stackError(`seed fact ${key} not found: ${SEED_FACT_NEEDS[key]}`);
  }
  return row;
}

function columnOf(key: SeedFactKey, row: Record<string, unknown>, column: string): unknown {
  const value = row[column];
  if (value === undefined || value === null) {
    throw stackError(`seed fact ${key} has no ${column}`);
  }
  return value;
}

function stringColumn(key: SeedFactKey, row: Record<string, unknown>, column: string): string {
  const value = columnOf(key, row, column);
  if (typeof value !== 'string' || value === '') {
    throw stackError(`seed fact ${key}: ${column} is not a string`);
  }
  return value;
}

function numberColumn(key: SeedFactKey, row: Record<string, unknown>, column: string): number {
  const value = columnOf(key, row, column);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw stackError(`seed fact ${key}: ${column} is not a number`);
  }
  return value;
}

/**
 * Reads the Durham County facts: the district's label point first, then the two offices, each
 * bound to that district. Throws `seed fact <key> not found: <what it needs>` for a fact with no
 * row, so a journey never runs against a missing value. The district id is not a fact.
 */
export async function readSeedFacts(query: SeedFactQuery): Promise<DurhamSeedFacts> {
  const district = firstRow('durhamPoint', await query('durhamPoint', []));
  const districtId = stringColumn('durhamPoint', district, 'district_id');
  const durhamPoint = {
    lat: numberColumn('durhamPoint', district, 'lat'),
    lng: numberColumn('durhamPoint', district, 'lng'),
  };
  const withDeadline = firstRow(
    'officeWithDeadline',
    await query('officeWithDeadline', [districtId]),
  );
  const notKnown = firstRow('officeNotKnown', await query('officeNotKnown', [districtId]));
  return {
    durhamPoint,
    officeWithDeadline: stringColumn('officeWithDeadline', withDeadline, 'slug'),
    officeNotKnown: stringColumn('officeNotKnown', notKnown, 'slug'),
  };
}

/**
 * The psql script of one fact: the statement prepared with its parameters as `$1` and on, then run
 * with the values psql holds as the variables `p1` and on, which it quotes as literals itself; the
 * rows come back as one JSON array.
 */
export function seedFactScript(sql: string, paramCount: number): string {
  const args = Array.from({ length: paramCount }, (_, index) => `:'p${String(index + 1)}'`);
  return [
    `prepare seed_fact as select coalesce(json_agg(q), '[]'::json) from (${sql}\n) q;`,
    `execute seed_fact${args.length === 0 ? '' : `(${args.join(', ')})`};`,
    '',
  ].join('\n');
}

const BUILT_FILES = [
  'apps/mobile/dist/index.html',
  'apps/api/dist/server.js',
  'apps/worker/dist/main.js',
];

/** A command-line mistake. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** Parses `--up`, `--build` and `--stand-in`; any other argument throws UsageError. */
export function parseStackArgs(argv: readonly string[]): StackArgs {
  const args: StackArgs = { up: false, build: false, mode: 'seeded' };
  for (const arg of argv) {
    if (arg === '--up') {
      args.up = true;
    } else if (arg === '--build') {
      args.build = true;
    } else if (arg === '--stand-in') {
      args.mode = 'standIn';
    } else {
      throw new UsageError(`unknown argument ${arg}; ${USAGE}`);
    }
  }
  return args;
}

export function stackDatabaseName(mode: StackMode): string {
  return mode === 'seeded' ? 'citizenrun_e2e' : 'citizenrun_standin';
}

/** The stand-in's worker reads the pipeline's home `data` bucket, and is the only one that does (D-589). */
export function stackBuckets(mode: StackMode): {
  media: string;
  data: string;
  backups: string;
  legal: string;
} {
  return mode === 'seeded'
    ? { media: 'e2e-media', data: 'e2e-data', backups: 'e2e-backups', legal: 'e2e-legal' }
    : { media: 'standin-media', data: 'data', backups: 'standin-backups', legal: 'standin-legal' };
}

/** The review sign-in addresses of TC-32: the perf account and fifty load accounts. */
export function reviewSignInEmails(): string {
  const load = Array.from(
    { length: 50 },
    (_, index) => `load_${String(index + 1).padStart(2, '0')}@example.test`,
  );
  return ['perf_01@example.test', ...load].join(',');
}

/** Six digits, leading zeros kept; made at each start of the stand-in, never an owner value. */
export function makeReviewCode(randomIntFn: (min: number, max: number) => number): string {
  return String(randomIntFn(0, 1_000_000)).padStart(6, '0');
}

function stackError(message: string): Error {
  return new Error(`e2e-stack: ${message}`);
}

/**
 * The superuser URL of the Postgres server the stack uses: `TEST_DATABASE_URL` when set (a job
 * container reaches the server as `postgres`), else the compose stack on localhost:5432.
 */
export function stackServerUrl(base: Env): URL {
  const raw = base.TEST_DATABASE_URL;
  const value = raw === undefined || raw === '' ? DEFAULT_SERVER_URL : raw;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw stackError('TEST_DATABASE_URL is not a URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw stackError('TEST_DATABASE_URL is not a postgres URL');
  }
  if (!LOCAL_DATABASE_HOSTS.has(url.hostname)) {
    throw stackError(`TEST_DATABASE_URL names a host the stack does not use (${url.hostname})`);
  }
  return url;
}

/** The object store's endpoint: `TEST_S3_ENDPOINT` when set, else the compose store on localhost:8333. */
export function stackStoreEndpoint(base: Env): string {
  const raw = base.TEST_S3_ENDPOINT;
  const value = raw === undefined || raw === '' ? DEFAULT_STORE_ENDPOINT : raw;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw stackError('TEST_S3_ENDPOINT is not a URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !LOCAL_STORE_HOSTS.has(url.hostname)
  ) {
    throw stackError(`TEST_S3_ENDPOINT names a store the stack does not use (${url.hostname})`);
  }
  return url.origin;
}

/** The `DATABASE_URL` of the stack's own database on the server of `stackServerUrl`. */
export function stackDatabaseUrl(mode: StackMode, base: Env): string {
  const url = new URL(stackServerUrl(base).href);
  url.protocol = 'postgresql:';
  url.pathname = `/${stackDatabaseName(mode)}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

function bucketSet(prefix: string, bucket: string, endpoint: string): Record<string, string> {
  return {
    [`${prefix}_BUCKET`]: bucket,
    [`${prefix}_ENDPOINT`]: endpoint,
    [`${prefix}_REGION`]: STORE.region,
    [`${prefix}_ACCESS_KEY_ID`]: STORE.accessKeyId,
    [`${prefix}_SECRET_ACCESS_KEY`]: STORE.secretAccessKey,
  };
}

/** The variables of `base` a child may see. */
function passedThrough(base: Env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED_THROUGH) {
    const value = base[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

/**
 * A child's whole environment, built from nothing but the allow-listed variables of `base` and
 * the stack's own values, so no owner value exported in the shell reaches the API or the worker.
 * The `LEGAL_*` set goes to the worker only (D-025).
 */
export function stackEnv(input: {
  mode: StackMode;
  role: Role;
  base: Env;
  reviewCode: string | null;
}): Record<string, string> {
  const { mode, role, base, reviewCode } = input;
  const buckets = stackBuckets(mode);
  const endpoint = stackStoreEndpoint(base);
  const env: Record<string, string> = {
    ...passedThrough(base),
    NODE_ENV: 'production',
    APP_ENV: mode === 'seeded' ? 'ci' : 'local',
    PORT: '8080',
    PUBLIC_URL: ORIGIN,
    LOG_LEVEL: 'info',
    DATABASE_URL: stackDatabaseUrl(mode, base),
    S3_FORCE_PATH_STYLE: 'true',
    APP_SECRET: LOCAL_APP_SECRET,
    ADMIN_EMAILS: 'admin@example.test',
    ...bucketSet('MEDIA', buckets.media, endpoint),
  };
  if (role === 'api') {
    env.ENABLE_DEV_ROUTES = 'true';
    env.CLIENT_IP_HEADER = 'x-real-ip';
    if (mode === 'standIn' && reviewCode !== null) {
      env.REVIEW_SIGNIN_EMAILS = reviewSignInEmails();
      env.REVIEW_SIGNIN_CODE = reviewCode;
    }
    return env;
  }
  return {
    ...env,
    ...bucketSet('DATA', buckets.data, endpoint),
    ...bucketSet('BACKUPS', buckets.backups, endpoint),
    ...bucketSet('LEGAL', buckets.legal, endpoint),
  };
}

/**
 * The seed run's environment: the migration runner's, plus the seeded stack's media bucket on the
 * compose store, the bucket its API serves, where the seed writes its placeholder images.
 */
export function seedEnv(base: Env): Record<string, string> {
  return {
    ...passedThrough(base),
    DATABASE_URL: stackDatabaseUrl('seeded', base),
    APP_ENV: 'ci',
    NODE_ENV: 'production',
    ...bucketSet('MEDIA', stackBuckets('seeded').media, stackStoreEndpoint(base)),
    S3_FORCE_PATH_STYLE: 'true',
  };
}

/** Runs one statement with psql on the server's admin database, or on `database` when given; resolves with its output. */
async function psql(root: string, base: Env, sql: string, database?: string): Promise<string> {
  const result = await run(
    'psql',
    [
      database ?? stackServerUrl(base).href,
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { cwd: root, env: passedThrough(base) },
  );
  if (result.code !== 0) {
    throw stackError(`psql failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function prepareDatabase(root: string, mode: StackMode, base: Env): Promise<void> {
  const name = stackDatabaseName(mode);
  if (mode === 'seeded') {
    await psql(root, base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    console.log(`e2e-stack: DROP DATABASE ${name}`);
    await psql(root, base, `CREATE DATABASE ${name}`);
    console.log(`e2e-stack: CREATE DATABASE ${name}`);
    return;
  }
  const found = await psql(root, base, `SELECT 1 FROM pg_database WHERE datname = '${name}'`);
  if (found === '1') {
    console.log(`e2e-stack: database ${name} exists; kept as it is`);
    return;
  }
  await psql(root, base, `CREATE DATABASE ${name}`);
  console.log(`e2e-stack: CREATE DATABASE ${name}`);
}

/** Migrates, and for the seeded stack seeds, the stack's database. */
async function migrateAndSeed(root: string, mode: StackMode, base: Env): Promise<void> {
  const env = {
    ...passedThrough(base),
    DATABASE_URL: stackDatabaseUrl(mode, base),
    APP_ENV: mode === 'seeded' ? 'ci' : 'local',
    NODE_ENV: 'production',
  };
  const migrate = await run(process.execPath, ['packages/db/dist/migrate.js'], {
    cwd: root,
    env,
    inherit: true,
  });
  if (migrate.code !== 0) {
    throw stackError(`the migration runner exited ${String(migrate.code)}`);
  }
  if (mode === 'seeded') {
    const seed = await run('pnpm', ['--filter', '@citizenrun/db', 'run', 'seed'], {
      cwd: root,
      env: seedEnv(base),
      inherit: true,
    });
    if (seed.code !== 0) {
      throw stackError(`the seed exited ${String(seed.code)}`);
    }
  }
}

const SeedRowsSchema = z.array(z.record(z.string(), z.unknown()));

/** Runs one fact's statement on the seeded database through psql, its values bound by psql. */
function seededQuery(root: string, base: Env): SeedFactQuery {
  return async (key, params) => {
    const variables = params.flatMap((value, index) => ['-v', `p${String(index + 1)}=${value}`]);
    const result = await runWithInput(
      'psql',
      [
        stackDatabaseUrl('seeded', base),
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        ...variables,
        '-f',
        '-',
      ],
      seedFactScript(SEED_FACT_QUERIES[key], params.length),
      { cwd: root, env: passedThrough(base) },
    );
    if (result.code !== 0) {
      throw stackError(`psql failed on seed fact ${key}: ${result.stderr.trim()}`);
    }
    return SeedRowsSchema.parse(JSON.parse(result.stdout.trim()));
  };
}

/** Runs a command with `input` on its standard input; resolves with its exit code and output. */
function runWithInput(
  command: string,
  args: readonly string[],
  input: string,
  options: { cwd: string; env: Readonly<Record<string, string>> },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: options.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.end(input);
  });
}

/** Writes the seeded stack's facts file from SEED_FACTS and the Durham County facts. */
async function writeSeedFacts(root: string, base: Env): Promise<void> {
  const facts: Record<string, unknown> = {};
  for (const fact of SEED_FACTS) {
    const output = await psql(root, base, fact.sql, stackDatabaseUrl('seeded', base));
    const value: unknown = output === '' ? null : JSON.parse(output);
    facts[fact.key] = value;
  }
  Object.assign(facts, await readSeedFacts(seededQuery(root, base)));
  const file = join(root, SEED_FACTS_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(facts, null, 2)}\n`);
  console.log(`e2e-stack: wrote ${SEED_FACTS_FILE}`);
}

/** Creates the stack's four buckets when missing and sets the media bucket's CORS rule. */
async function prepareBuckets(mode: StackMode, base: Env): Promise<void> {
  const buckets = stackBuckets(mode);
  const client = createS3Client({
    endpoint: stackStoreEndpoint(base),
    region: STORE.region,
    accessKeyId: STORE.accessKeyId,
    secretAccessKey: STORE.secretAccessKey,
    forcePathStyle: true,
  });
  try {
    await ensureBucket(client, buckets.media, { cors: mediaCorsRules([ORIGIN]) });
    await ensureBucket(client, buckets.data);
    await ensureBucket(client, buckets.backups);
    await ensureBucket(client, buckets.legal);
  } finally {
    client.destroy();
  }
  console.log(
    `e2e-stack: buckets ${[buckets.media, buckets.data, buckets.backups, buckets.legal].join(', ')} ready`,
  );
}

/** Writes each line of a child's output with its prefix. */
function forward(child: ChildProcess, prefix: string): void {
  if (child.stdout !== null) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      process.stdout.write(`${prefix}${line}\n`);
    });
  }
  if (child.stderr !== null) {
    createInterface({ input: child.stderr }).on('line', (line) => {
      process.stderr.write(`${prefix}${line}\n`);
    });
  }
}

type Running = { child: ChildProcess; exited: Promise<number | null> };

function start(root: string, file: string, env: Record<string, string>, prefix: string): Running {
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forward(child, prefix);
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
    child.on('error', () => {
      resolve(null);
    });
  });
  return { child, exited };
}

function stop(running: Running): void {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill('SIGTERM');
  }
}

/** Polls the readiness route until it answers 200; false at the limit or when `stopped` says so. */
async function waitUntilReady(stopped: () => boolean): Promise<boolean> {
  const deadline = Date.now() + READY_LIMIT_MS;
  while (Date.now() < deadline && !stopped()) {
    try {
      const response = await fetch(READY_URL, { signal: AbortSignal.timeout(READY_POLL_MS * 4) });
      await response.body?.cancel();
      if (response.status === 200) {
        return true;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

/** Runs the stack until a signal or a child's exit; resolves with the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  let args: StackArgs;
  try {
    args = parseStackArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const root = repoRoot();
  const base = process.env;
  try {
    if (args.up) {
      const up = await run('docker', ['compose', 'up', '-d', '--wait'], {
        cwd: root,
        inherit: true,
      });
      if (up.code !== 0) {
        throw stackError('docker compose up failed');
      }
    }
    if (args.build) {
      for (const script of ['build:web', 'build:api', 'build:worker']) {
        const built = await run('pnpm', [script], { cwd: root, inherit: true });
        if (built.code !== 0) {
          throw stackError(`pnpm ${script} failed`);
        }
      }
    }
    const missing = BUILT_FILES.filter((path) => !existsSync(join(root, path)));
    if (missing.length > 0) {
      throw stackError(
        `missing ${missing.join(', ')}; run pnpm stack:local, or pnpm build:web, pnpm build:api and pnpm build:worker, first`,
      );
    }
    await prepareDatabase(root, args.mode, base);
    // The seed writes its placeholder images to the media bucket, so the buckets come first.
    await prepareBuckets(args.mode, base);
    await migrateAndSeed(root, args.mode, base);
    if (args.mode === 'seeded') {
      await writeSeedFacts(root, base);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'e2e-stack: failed');
    return 1;
  }

  const reviewCode = args.mode === 'standIn' ? makeReviewCode(randomInt) : null;
  const worker = start(
    root,
    'apps/worker/dist/main.js',
    stackEnv({ mode: args.mode, role: 'worker', base, reviewCode }),
    '[worker] ',
  );
  const api = start(
    root,
    'apps/api/dist/server.js',
    stackEnv({ mode: args.mode, role: 'api', base, reviewCode }),
    '[api] ',
  );

  let stopping = false;
  const stopBoth = (): void => {
    stopping = true;
    stop(worker);
    stop(api);
  };
  const bothExited = Promise.all([worker.exited, api.exited]);

  return new Promise<number>((resolve) => {
    const onSignal = (): void => {
      if (stopping) {
        return;
      }
      stopBoth();
      void bothExited.then(() => {
        resolve(0);
      });
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    // A child that exits by itself stops the other; the stack exits with that child's code.
    for (const running of [worker, api]) {
      void running.exited.then((code) => {
        if (stopping) {
          return;
        }
        stopBoth();
        void bothExited.then(() => {
          resolve(code ?? 1);
        });
      });
    }

    if (args.mode === 'standIn') {
      void waitUntilReady(() => stopping).then((ready) => {
        if (stopping) {
          return;
        }
        if (!ready) {
          console.error('e2e-stack: /readyz did not answer 200 within 120 seconds');
          stopBoth();
          void bothExited.then(() => {
            resolve(1);
          });
          return;
        }
        console.log(`PERF_BASE_URL=${ORIGIN}`);
        console.log(`PERF_REVIEW_CODE=${reviewCode ?? ''}`);
      });
    }
  });
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
